#!/usr/bin/env node
/**
 * bin/review-watch-availability.ts — Revisao READ-ONLY de `watch_availability`.
 *
 * Ferramenta de governanca humana: lista as ofertas de streaming candidatas a
 * exibicao (`display_allowed=false`, do fornecedor `streaming_availability`) e
 * mostra, por linha, se cada uma passaria nos guardrails de promocao — sem SQL
 * manual e sem NUNCA alterar o banco.
 *
 * NAO FAZ: chamar RapidAPI/rede; rodar ingestao/--sample/--apply; mutar dado
 * algum; tocar UI, home, ratings, screen_score ou SEO. So LE PostgreSQL.
 *
 * Uso (a partir da raiz):
 *   TSX="$(ls node_modules/.pnpm/tsx@*\/node_modules/tsx/dist/cli.mjs | head -1)"
 *   node "$TSX" services/streaming/bin/review-watch-availability.ts --kind=movie --country=BR --limit=20
 *   node "$TSX" services/streaming/bin/review-watch-availability.ts --kind=movie --entity-id=1 --country=BR
 *   node "$TSX" services/streaming/bin/review-watch-availability.ts --kind=movie --entity-id=1 --country=BR --report
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { disconnectPrisma, getPrismaClient } from '@screena/db/server'

import { parseReviewArgs } from '../src/promotion/args.js'
import {
  deepLinkHost,
  PROMOTION_PROVIDER_APIS,
  WITHHELD_OFFER_SOURCES,
  promotionDestination,
} from '../src/promotion/guardrails.js'
import { buildReviewJson, renderReviewReport, summaryLine } from '../src/promotion/report.js'
import { runReview } from '../src/promotion/run.js'

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

  const parsed = parseReviewArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`Argumentos invalidos: ${parsed.error}`)
    process.exitCode = 1
    return
  }
  const args = parsed.args

  if (!process.env.DATABASE_URL?.trim()) {
    console.error(
      'Bloqueado: a revisao le as ofertas do PostgreSQL. Defina DATABASE_URL (dev/staging/prod).',
    )
    process.exitCode = 1
    return
  }

  const prisma = getPrismaClient()
  try {
    const { createPrismaReviewStore } = await import('../src/persistence/watch-review-store.js')
    const store = createPrismaReviewStore(prisma)

    const result = await runReview(
      {
        kind: args.kind,
        country: args.country,
        entityId: args.entityId === null ? null : String(args.entityId),
        limit: args.limit,
        providerApis: PROMOTION_PROVIDER_APIS,
      },
      { store, now: () => new Date() },
    )

    if (args.json) {
      // JSON sanitizado (host do deep link, nunca a URL inteira): pipeavel.
      console.log(JSON.stringify(buildReviewJson(result), null, 2))
    } else {
      console.log(
        `Revisao · providers=${PROMOTION_PROVIDER_APIS.join('+')} · tipo=${args.kind ?? 'movie+tv'} · pais=${args.country}`,
      )
      for (const entry of result.evaluated) {
        const c = entry.candidate
        const decision = entry.eligible ? 'ELEGIVEL' : `rejeitada:${entry.reason}`
        console.log(
          `  #${c.id} ${c.entityType}#${c.entityId} "${c.title ?? '—'}" · ${c.offerType ?? '—'} · ` +
            `${deepLinkHost(promotionDestination(c))} · display_allowed=${c.displayAllowed} · ${decision}`,
        )
      }
      console.log(summaryLine(result.summary))
    }

    // DECISAO RETIDA NA CARA DO OPERADOR, no console, sem depender de `--report`.
    // Quem roda a revisao daqui a tres meses ve o motivo e o "por que" na mesma
    // tela — nao num arquivo em `.data/` que ele talvez nem gere.
    if (result.summary.byReason.some((entry) => entry.reason === 'withheld-by-decision')) {
      console.log('')
      console.log('  Origens RETIDAS por decisao humana (nao promova por id):')
      for (const held of WITHHELD_OFFER_SOURCES) {
        console.log(
          `    (${held.providerApi}, ${held.providerKey}) · ${held.decidedOn} · ${held.decidedBy}`,
        )
        console.log(`      ${held.reason}`)
      }
      console.log(
        '    Reverter = remover a linha de WITHHELD_OFFER_SOURCES numa PR, nunca promover por id.',
      )
    }

    if (args.report) {
      writeReport(renderReviewReport(result), `watch-availability-review-${args.kind ?? 'all'}-${args.country}.md`)
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
  console.error('Falha na revisao de disponibilidade:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
