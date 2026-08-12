#!/usr/bin/env node
/**
 * bin/reprocess-watch-providers.ts — Materializa `watch_availability` a partir
 * do bloco `watch/providers` JA ARQUIVADO em `tmdb_raw`.
 *
 * ZERO chamada ao TMDB, ZERO cota consumida. O dado de "onde assistir" ja foi
 * baixado a cada sync de detalhe (o sub-recurso esta em `MOVIE_APPEND`,
 * `TV_APPEND` e `TV_SEASON_APPEND`); faltava so transforma-lo em linhas
 * consultaveis. Um "reprocessamento" que refizesse fetch seria um sync
 * disfarcado, com custo de cota escondido.
 *
 * TRES MODOS:
 *   (sem flag)  DRY-RUN: le, reconhece e conta. NADA e escrito.
 *   --apply     grava as ofertas (sempre `display_allowed=false`, invariante 6).
 *   --sample    imprime a FORMA dos blocos `watch/providers` realmente
 *               presentes no banco (chaves, paises, buckets), sem valores
 *               sensiveis e sem escrever. Serve para confrontar a fixture de
 *               teste com bytes reais.
 *
 * FAIL-CLOSED: aborta em producao; exige `DATABASE_URL`. NAO exige token TMDB
 * (nao ha rede).
 *
 * Uso (a partir da raiz):
 *   node <tsx> services/ingestion/bin/reprocess-watch-providers.ts --sample
 *   node <tsx> services/ingestion/bin/reprocess-watch-providers.ts --kind=movie
 *   node <tsx> services/ingestion/bin/reprocess-watch-providers.ts --kind=tv --apply
 *   # flags: --kind=movie|tv (default movie) · --limit=N (default 100)
 *   #        --stale-days=N (default 1) · --apply · --sample
 */

import { disconnectPrisma, getPrismaClient } from '@screena/db/server'

import { normalizeWatchProviders } from '../src/normalizers/watch-providers.js'
import {
  createPrismaRawWatchSource,
  createPrismaTmdbWatchOfferStore,
  createPrismaWatchEntityResolver,
} from '../src/persistence/watch-providers-store.js'
import { createPrismaSyncLog } from '../src/persistence/sync-log.js'
import {
  deriveWatchReprocessStatus,
  runWatchProvidersReprocess,
} from '../src/watch-providers/run.js'
import type { WatchProvidersEntityType } from '../src/watch-providers/types.js'

const DAY_MS = 24 * 60 * 60 * 1000

function flagValue(argv: readonly string[], name: string): string | null {
  const prefix = `--${name}=`
  const hit = argv.find((arg) => arg.startsWith(prefix))
  return hit === undefined ? null : hit.slice(prefix.length)
}

function positiveInt(raw: string | null, fallback: number, name: string): number {
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} deve ser inteiro > 0; recebido ${JSON.stringify(raw)}`)
  }
  return value
}

/** Imprime a FORMA dos blocos reais, sem valor sensivel. Nao escreve nada. */
function renderSample(entityType: WatchProvidersEntityType, rows: readonly { tmdbId: number; payload: unknown }[]): string {
  const lines = [`AMOSTRA DA FORMA REAL DE watch/providers (${entityType}) — nada foi escrito`]
  let withBlock = 0
  const bucketTally = new Map<string, number>()
  const countryTally = new Map<string, number>()

  for (const row of rows) {
    const result = normalizeWatchProviders(entityType, row.tmdbId, row.payload)
    if (!result.recognized) continue
    withBlock += 1
    for (const country of result.countries) {
      countryTally.set(country, (countryTally.get(country) ?? 0) + 1)
    }
    for (const offer of result.offers) {
      bucketTally.set(offer.offerType, (bucketTally.get(offer.offerType) ?? 0) + 1)
    }
  }

  lines.push(`  linhas lidas de tmdb_raw       ${rows.length}`)
  lines.push(`  com bloco watch/providers      ${withBlock}`)
  lines.push(`  SEM bloco (arquivado antes)    ${rows.length - withBlock}`)
  lines.push(
    `  modalidades vistas             ${
      [...bucketTally.entries()].map(([k, v]) => `${k}=${v}`).join(' · ') || '(nenhuma)'
    }`,
  )
  const topCountries = [...countryTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  lines.push(
    `  paises mais frequentes         ${
      topCountries.map(([k, v]) => `${k}=${v}`).join(' · ') || '(nenhum)'
    }`,
  )
  return lines.join('\n')
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const sample = argv.includes('--sample')

  let kind: WatchProvidersEntityType
  let limit: number
  let staleDays: number
  try {
    const rawKind = flagValue(argv, 'kind') ?? 'movie'
    if (rawKind !== 'movie' && rawKind !== 'tv') {
      throw new Error(`--kind deve ser movie ou tv; recebido ${JSON.stringify(rawKind)}`)
    }
    kind = rawKind
    limit = positiveInt(flagValue(argv, 'limit'), 100, 'limit')
    staleDays = positiveInt(flagValue(argv, 'stale-days'), 1, 'stale-days')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
    return
  }

  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    console.error('BLOQUEADO: este worker nao roda em producao.')
    process.exitCode = 3
    return
  }
  if (typeof process.env.DATABASE_URL !== 'string' || process.env.DATABASE_URL.trim() === '') {
    console.error('BLOQUEADO: DATABASE_URL nao definida (a fonte e o banco, nao o TMDB).')
    process.exitCode = 3
    return
  }

  const prisma = getPrismaClient()
  try {
    const source = createPrismaRawWatchSource(prisma)

    if (sample) {
      const rows = await source.list(kind, limit)
      console.log(renderSample(kind, rows))
      return
    }

    const report = await runWatchProvidersReprocess({
      entityType: kind,
      source,
      resolver: createPrismaWatchEntityResolver(prisma),
      store: createPrismaTmdbWatchOfferStore(prisma),
      limit,
      staleAfterMs: staleDays * DAY_MS,
      now: () => new Date(),
      dryRun: !apply,
    })

    const status = deriveWatchReprocessStatus(report.counts)
    const c = report.counts

    console.log(`REPROCESSAMENTO watch/providers (${kind}) — ${apply ? 'APLICADO' : 'DRY-RUN'}`)
    console.log(`  status         ${status}`)
    console.log(`  escaneados     ${c.scanned}`)
    console.log(`  aplicados      ${c.applied}   (ofertas: +${c.offersUpserted} / revogadas ${c.offersRevoked})`)
    console.log(`  sem oferta     ${c.empty}      (payload reconhecido, o titulo nao tem oferta)`)
    console.log(`  nao reconhec.  ${c.unrecognized} (snapshot preservado — NAO e sucesso)`)
    console.log(`  nao promovido  ${c.unresolved}  (entidade ainda sem id interno)`)
    console.log(`  falhas         ${c.failed}`)

    if (Object.keys(report.rejections).length > 0) {
      console.log('  recusas por motivo:')
      for (const [reason, count] of Object.entries(report.rejections)) {
        console.log(`    ${reason}: ${count}`)
      }
    }
    if (report.failures.length > 0) {
      console.log('  falhas (amostra, com a CAUSA):')
      for (const failure of report.failures.slice(0, 10)) {
        console.log(`    ${kind}#${failure.tmdbId} [${failure.errorClass}] ${failure.message}`)
      }
    }
    if (report.providersSeen.length > 0) {
      console.log(`  provedores TMDB vistos (${report.providersSeen.length}) — insumo dos aliases:`)
      for (const provider of report.providersSeen.slice(0, 20)) {
        console.log(`    ${provider.providerKey.padStart(6)} ${provider.providerName} (${provider.offers})`)
      }
      console.log(
        '    Sem linha em watch_provider_aliases para (provider_api=tmdb, external_key=<id>),',
      )
      console.log('    a oferta e ingerida e auditavel mas o trigger nao a deixa exibir.')
    }
    console.log(`  paises         ${report.countriesSeen.join(', ') || '(nenhum)'}`)

    if (apply) {
      await createPrismaSyncLog(prisma).write({
        endpoint: 'reprocess-watch-providers',
        status,
        itemsProcessed: c.scanned,
        itemsUpdated: c.offersUpserted,
        durationMs: report.durationMs,
        // Arquivo ja em disco: nenhuma cota de API foi consumida.
        quotaCost: 0,
        errorCode: c.failed > 0 ? 'watch_reprocess_item_failed' : null,
      })
    }

    // O cron precisa VER a falha. Sair 0 num ciclo 100% falho e o buraco que
    // `sync-tmdb-raw` e `promote-tmdb-raw` ainda tem.
    if (status === 'failed') process.exitCode = 1
  } finally {
    await disconnectPrisma()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
