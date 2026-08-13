#!/usr/bin/env node
/**
 * bin/promote-omdb-awards.ts — Promove o campo `Awards` de `api_cache` para
 * `entity_awards`.
 *
 * ZERO REDE. O literal ja esta guardado desde o primeiro sync de ratings; esta
 * execucao nao gasta um byte de cota da OMDb. `quota_cost = 0` em
 * `api_sync_logs` e a prova disso.
 *
 * Dry-run e o DEFAULT: sem `--apply` o comando le tudo, reconhece tudo e
 * RELATA, sem escrever uma linha.
 *
 * Uso (a partir da raiz do repo). NAO use `--`: medido no pnpm 9.15.4 deste
 * repositorio, o separador chega LITERAL como argumento e o parser o recusa.
 *
 *   # dry-run: mostra o que SERIA promovido e por que cada recusa aconteceu
 *   corepack pnpm --filter @screena/ratings awards:promote
 *
 *   # escrita real
 *   corepack pnpm --filter @screena/ratings awards:promote --apply
 *
 *   # so filmes, teto de 50, com relatorio em services/ratings/.data/
 *   corepack pnpm --filter @screena/ratings awards:promote --type=movie --limit=50 --apply --report
 *
 * Em producao, `--apply` exige `CINERIE_AWARDS_PROMOTION_AUTHORIZED=true`. O
 * dry-run roda sempre.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { OMDB_PROVIDER_API } from '@screena/omdb-client'
import { disconnectPrisma, getPrismaClient } from '@screena/db/server'

import {
  describeAwardsGateReason,
  evaluateAwardsGate,
  parseAwardsArgs,
} from '../src/awards/args.js'
import { rejectionsByReason, renderAwardsReport, summaryLine } from '../src/awards/report.js'
import { describeCreditResolution, runAwardsPromotion } from '../src/awards/run.js'

function repoRoot(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url)) // services/ratings/bin
  return path.resolve(dir, '..', '..', '..')
}

function loadRepoEnv(): void {
  const envPath = path.join(repoRoot(), '.env')
  if (typeof process.loadEnvFile === 'function' && existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
}

async function main(): Promise<void> {
  loadRepoEnv()

  const parsed = parseAwardsArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`Argumentos invalidos: ${parsed.error}`)
    process.exitCode = 1
    return
  }
  const args = parsed.args

  const gate = evaluateAwardsGate({
    isProd: process.env.NODE_ENV === 'production',
    apply: args.apply,
    hasDb: (process.env.DATABASE_URL ?? '').trim() !== '',
    promotionAuthorized: process.env.CINERIE_AWARDS_PROMOTION_AUTHORIZED === 'true',
  })
  if (!gate.allowed && gate.reason !== null) {
    console.error(describeAwardsGateReason(gate.reason))
    process.exitCode = 1
    return
  }

  const prisma = getPrismaClient()
  try {
    const { createPrismaAwardsCacheSource } = await import(
      '../src/persistence/awards-cache-source.js'
    )
    const { createPrismaAwardsCreditLookup } = await import(
      '../src/persistence/awards-credit-lookup.js'
    )
    const { createPrismaEntityAwards } = await import('../src/persistence/awards-store.js')
    const { createPrismaEntityLookup } = await import('../src/persistence/entity-lookup.js')
    const { createPrismaSyncLog } = await import('../src/persistence/sync-log.js')

    const result = await runAwardsPromotion(
      {
        apply: args.apply,
        limit: args.limit,
        providerApi: OMDB_PROVIDER_API,
        entityType: args.type,
      },
      {
        cache: createPrismaAwardsCacheSource(prisma, OMDB_PROVIDER_API),
        credit: createPrismaAwardsCreditLookup(prisma),
        entities: createPrismaEntityLookup(prisma),
        awards: createPrismaEntityAwards(prisma, { log: (line) => console.log(line) }),
        syncLog: createPrismaSyncLog(prisma, OMDB_PROVIDER_API),
        now: () => new Date(),
      },
    )

    console.log(
      `promocao de premiacao · ${args.apply ? '--apply (escrita real)' : 'DRY-RUN (nada escrito)'} · rede: nenhuma (cota gasta: 0)`,
    )
    console.log(`licenca: ${describeCreditResolution(result.creditResolution)}`)
    console.log(summaryLine(result))

    // NENHUMA RECUSA SOME. Titulo sem premio e fato, nao falha — mas some da
    // vista se ninguem o escrever. Cada motivo aparece com contagem, e o
    // literal bruto de um formato desconhecido aparece inteiro.
    for (const group of rejectionsByReason(result)) {
      console.log(`\n  ${group.reason} (${group.count}):`)
      for (const detail of group.details) console.log(`    - ${detail}`)
    }

    if (!args.apply && result.counters.recognized > 0) {
      console.log(
        `\nDry-run: ${result.counters.recognized} frase(s) reconhecida(s). Repita com --apply para gravar.`,
      )
    }

    // Escrita recusada pelo banco NUNCA passa por sucesso.
    const refused = result.rejections.filter((r) => r.reason === 'write-refused')
    if (refused.length > 0) {
      console.error(`\nRECUSADAS PELO BANCO (${refused.length}) — governanca incompleta:`)
      for (const rejection of refused) console.error(`  ${rejection.detail}`)
      process.exitCode = 1
    }

    if (result.counters.displayable === 0 && result.counters.written > 0) {
      console.log(
        '\nNenhuma linha ficou EXIBIVEL. Isso e esperado enquanto nao houver licenca de ' +
          'premiacao: o fato fica guardado e a faixa nao acende. Ver ' +
          'docs/legal/omdb-awards-source-provenance.md.',
      )
    }

    if (args.report) {
      const target = path.join(
        repoRoot(),
        'services',
        'ratings',
        '.data',
        `omdb-awards-${args.apply ? 'apply' : 'dry-run'}.md`,
      )
      try {
        mkdirSync(path.dirname(target), { recursive: true })
        writeFileSync(target, `${renderAwardsReport(result)}\n`)
        console.log(`\nRelatorio: ${target}`)
      } catch (error) {
        console.warn(
          'Nao foi possivel escrever o relatorio:',
          error instanceof Error ? error.message : error,
        )
      }
    }
  } finally {
    await disconnectPrisma()
  }
}

main().catch((error: unknown) => {
  console.error(
    'Falha na promocao de premiacao:',
    error instanceof Error ? error.message : error,
  )
  process.exitCode = 1
})
