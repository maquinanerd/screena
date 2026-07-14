#!/usr/bin/env node
/**
 * bin/promote-watch-availability.ts — Promocao/reversao GOVERNADA de ofertas.
 *
 * Vira o gate `display_allowed` de ofertas ja gravadas do fornecedor
 * `streaming_availability` (pais BR), por SELECAO EXPLICITA de ids. Substitui o
 * SQL manual por um caminho com guardrails: sem `--confirm` e sempre dry-run;
 * com `--confirm` so as linhas elegiveis sao mutadas.
 *
 * NAO FAZ: chamar RapidAPI/rede; rodar ingestao/--sample/--apply; criar linha
 * nova; tocar outro provider; encostar em rating/screen_score/external_ratings;
 * mexer em UI/home/SEO. So LE e ATUALIZA `display_allowed` no PostgreSQL local.
 *
 * Uso (a partir da raiz):
 *   TSX="$(ls node_modules/.pnpm/tsx@*\/node_modules/tsx/dist/cli.mjs | head -1)"
 *   # dry-run (default): mostra o que SERIA promovido, nada muda
 *   node "$TSX" services/streaming/bin/promote-watch-availability.ts --ids=1,2,3 --country=BR
 *   # promocao real (so as elegiveis)
 *   node "$TSX" services/streaming/bin/promote-watch-availability.ts --ids=1,2,3 --country=BR --confirm
 *   # reversao (volta display_allowed=false)
 *   node "$TSX" services/streaming/bin/promote-watch-availability.ts --ids=1,2,3 --country=BR --revoke --confirm
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { STREAMING_AVAILABILITY_PROVIDER_API } from '@screena/streaming-availability-client'
import { disconnectPrisma, getPrismaClient } from '@screena/db/server'

import { parsePromoteArgs } from '../src/promotion/args.js'
import { renderPromotionReport, summaryLine } from '../src/promotion/report.js'
import { runPromotion } from '../src/promotion/run.js'

function repoRoot(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url)) // services/streaming/bin
  return path.resolve(dir, '..', '..', '..')
}

function loadRepoEnv(): void {
  const envPath = path.join(repoRoot(), '.env')
  if (typeof process.loadEnvFile === 'function' && existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
}

const dataDir = (): string => path.join(repoRoot(), 'services', 'streaming', '.data')

async function main(): Promise<void> {
  loadRepoEnv()

  const parsed = parsePromoteArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`Argumentos invalidos: ${parsed.error}`)
    process.exitCode = 1
    return
  }
  const args = parsed.args

  if (!process.env.DATABASE_URL?.trim()) {
    console.error('Bloqueado: a promocao le e atualiza o PostgreSQL. Defina DATABASE_URL.')
    process.exitCode = 1
    return
  }

  const prisma = getPrismaClient()
  try {
    const { createPrismaReviewStore } = await import('../src/persistence/watch-review-store.js')
    const { createPrismaSyncLog } = await import('../src/persistence/sync-log.js')
    const store = createPrismaReviewStore(prisma)
    const syncLog = createPrismaSyncLog(prisma, STREAMING_AVAILABILITY_PROVIDER_API)

    const result = await runPromotion(
      {
        ids: args.ids.map((id) => String(id)),
        country: args.country,
        confirm: args.confirm,
        revoke: args.revoke,
      },
      { store, syncLog, now: () => new Date() },
    )

    const action = result.mode === 'revoke' ? 'reversao' : 'promocao'
    console.log(
      `${action} · ${args.confirm ? '--confirm (mutacao real)' : 'DRY-RUN (nada muda)'} · pais=${args.country}`,
    )
    for (const entry of result.evaluated) {
      const c = entry.candidate
      const decision = entry.eligible ? 'ELEGIVEL' : `rejeitada:${entry.reason}`
      console.log(`  #${c.id} ${c.entityType}#${c.entityId} "${c.title ?? '—'}" · display_allowed=${c.displayAllowed} · ${decision}`)
    }
    if (result.idsMissing.length > 0) {
      console.warn(`  ids ausentes (nao existem): ${result.idsMissing.join(', ')}`)
    }
    console.log(summaryLine(result.summary))
    console.log(`linhas mutadas no banco: ${result.updated}`)

    if (!args.confirm && result.eligibleIds.length > 0) {
      console.log(
        `Dry-run: ${result.eligibleIds.length} elegivel(is). Repita com --confirm para aplicar (ids=${result.eligibleIds.join(',')}).`,
      )
    }
    if (args.confirm && result.updated < result.eligibleIds.length) {
      console.warn(
        `Atencao: ${result.eligibleIds.length} elegivel(is), mas ${result.updated} mutada(s). ` +
          'Alguma linha saiu do escopo entre a leitura e o update (provider/pais/estado).',
      )
    }

    if (args.report) {
      const mode = args.confirm ? 'confirm' : 'dry-run'
      writeReport(
        renderPromotionReport(result),
        `watch-availability-${result.mode}-${mode}-${args.country}.md`,
      )
    }
  } finally {
    await disconnectPrisma()
  }
}

/** Escreve o relatorio em `.data/` (gitignored), best-effort. */
function writeReport(body: string, filename: string): void {
  try {
    const target = path.join(dataDir(), filename)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, `${body}\n`)
    console.log(`Relatorio: ${target}`)
  } catch (error) {
    console.warn('Nao foi possivel escrever o relatorio:', error instanceof Error ? error.message : error)
  }
}

main().catch((error: unknown) => {
  console.error('Falha na promocao de disponibilidade:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
