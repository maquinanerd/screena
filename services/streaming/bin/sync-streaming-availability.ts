#!/usr/bin/env node
/**
 * bin/sync-streaming-availability.ts — Worker OFFLINE do Streaming Availability
 * (Movie of the Night, via RapidAPI). Worker-only — NUNCA no render.
 *
 * Fica em `services/streaming/bin`: EXCLUIDO do typecheck e do bundle de render.
 * Usa o core PURO em `../src/**` e adiciona so o IO: client HTTP, Prisma
 * (api_cache / api_sync_logs / watch_availability), sample e relatorio em
 * `.data/` (gitignored).
 *
 * O QUE FAZ:
 *  - Dry-run (default): seleciona as entidades e reporta o PLANO (que URLs
 *    SERIAM chamadas). ZERO rede, ZERO quota, ZERO escrita.
 *  - `--sample`: busca payload REAL, grava `api_cache` + `api_sync_logs` e
 *    escreve um sample SANITIZADO. NAO grava `watch_availability`.
 *  - `--apply`: idem, e faz o REPLACE TRANSACIONAL do snapshot de ofertas
 *    daquela entidade/pais para `provider_api = streaming_availability`.
 *
 * NAO FAZ: exibir nada publicamente; tocar `screen_score` nem `external_ratings`;
 * alterar slugs/canonical/redirects/UI; baixar imagem; criar migration; buscar
 * pessoa/temporada/episodio.
 *
 * ATRIBUICAO: os termos do provider exigem creditar "Streaming Availability API
 * by Movie of the Night" com link, sempre que o dado for EXIBIDO. Por isso toda
 * linha nasce `display_allowed = false` — exibir e uma etapa futura, com licenca
 * e atribuicao na UI.
 *
 * SEGREDO: `RAPIDAPI_STREAMING_AVAILABILITY_KEY` so em env var. Nunca impressa,
 * nunca em URL, relatorio, sample ou log.
 *
 * FAIL-CLOSED: aborta em producao; `--sample`/`--apply` exigem chave + DATABASE_URL.
 *
 * Uso (a partir da raiz):
 *   TSX="$(ls node_modules/.pnpm/tsx@*\/node_modules/tsx/dist/cli.mjs | head -1)"
 *   node "$TSX" services/streaming/bin/sync-streaming-availability.ts --kind=movie --country=BR --limit=5
 *   node "$TSX" services/streaming/bin/sync-streaming-availability.ts --kind=movie --country=BR --limit=5 --sample
 *   node "$TSX" services/streaming/bin/sync-streaming-availability.ts --kind=tv --country=BR --limit=5 --apply
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { sanitizePayload } from '@screena/rapidapi-core'
import {
  createStreamingAvailabilityClient,
  loadStreamingAvailabilityConfig,
  STREAMING_AVAILABILITY_KEY_ENV,
  STREAMING_AVAILABILITY_PROVIDER_API,
} from '@screena/streaming-availability-client'
import { disconnectPrisma, getPrismaClient } from '@screena/db/server'

import { parseStreamingArgs } from '../src/streaming-availability/args.js'
import {
  describeStreamingGateReason,
  evaluateStreamingGate,
} from '../src/streaming-availability/gate.js'
import {
  buildStreamingReport,
  renderStreamingReport,
  runMode,
  serializeStreamingReportJson,
} from '../src/streaming-availability/report.js'
import {
  runStreamingAvailabilitySync,
  STREAMING_SYNC_ENDPOINT,
} from '../src/streaming-availability/run.js'
import type { CachePort, SyncLogPort, WatchStorePort } from '../src/ports.js'

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

/** Portas inertes para o caminho sem escrita. */
const NOOP_CACHE: CachePort = { async write() {} }
const NOOP_SYNC_LOG: SyncLogPort = { async write() {} }
const NOOP_WATCH: WatchStorePort = {
  async replaceSnapshot() {
    return { deleted: 0, created: 0 }
  },
}

async function main(): Promise<void> {
  loadRepoEnv()

  const parsed = parseStreamingArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`Argumentos invalidos: ${parsed.error}`)
    process.exitCode = 1
    return
  }
  const args = parsed.args

  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
  const hasKey = Boolean(process.env[STREAMING_AVAILABILITY_KEY_ENV]?.trim())
  const hasDb = Boolean(process.env.DATABASE_URL?.trim())

  const gate = evaluateStreamingGate({
    isProd,
    apply: args.apply,
    sample: args.sample,
    hasKey,
    hasDb,
  })
  if (!gate.allowed && gate.reason !== null) {
    console.error(describeStreamingGateReason(gate.reason))
    process.exitCode = 1
    return
  }

  const touchesNetwork = args.apply || args.sample
  const mode = runMode(args)

  // Dry-run PURO ainda precisa do banco para SELECIONAR as entidades. Sem
  // DATABASE_URL nao ha o que planejar: reporta e sai sem simular sucesso.
  if (!touchesNetwork && !hasDb) {
    console.error(
      'Dry-run sem DATABASE_URL: nao ha como selecionar entidades. ' +
        'Defina DATABASE_URL (dev/staging) para ver o plano.',
    )
    process.exitCode = 1
    return
  }

  const prisma = getPrismaClient()
  const { createPrismaEntitySelect } = await import('../src/persistence/entity-select.js')
  const entities = createPrismaEntitySelect(prisma)

  let syncLog: SyncLogPort = NOOP_SYNC_LOG
  let cache: CachePort = NOOP_CACHE
  let watch: WatchStorePort = NOOP_WATCH
  let client: ReturnType<typeof createStreamingAvailabilityClient> | null = null
  let cacheTtlMs = 0
  let apiKey: string | null = null

  if (touchesNetwork) {
    const config = loadStreamingAvailabilityConfig(process.env)
    client = createStreamingAvailabilityClient(config)
    cacheTtlMs = config.cacheTtlMs
    apiKey = config.apiKey

    const { createPrismaCache } = await import('../src/persistence/cache.js')
    const { createPrismaSyncLog } = await import('../src/persistence/sync-log.js')
    cache = createPrismaCache(prisma, STREAMING_AVAILABILITY_PROVIDER_API)
    syncLog = createPrismaSyncLog(prisma, STREAMING_AVAILABILITY_PROVIDER_API)

    if (args.apply) {
      const { createPrismaWatchStore } = await import('../src/persistence/watch-store.js')
      watch = createPrismaWatchStore(prisma)
    }
  }

  // O core ja grava a linha AUTORITATIVA de `api_sync_logs` quando toca a rede.
  // Este flag impede que uma falha POSTERIOR (escrita de sample/relatorio em
  // disco) acrescente uma 2a linha `aborted` contraditoria para o mesmo ciclo.
  let mainLogWritten = false

  try {
    const activeClient = client
    const result = await runStreamingAvailabilitySync(
      {
        apply: args.apply,
        sample: args.sample,
        kind: args.kind,
        country: args.country,
        limit: args.limit,
        tmdbId: args.tmdbId,
        imdbId: args.imdbId,
        cacheTtlMs,
      },
      {
        fetchShow: (showId, country) => {
          if (activeClient === null) {
            return Promise.reject(new Error('dry-run nao busca payload'))
          }
          return activeClient.getShow({ showId, country })
        },
        cache,
        syncLog,
        entities,
        watch,
        now: () => new Date(),
        requestCount: () => activeClient?.getRequestCount() ?? 0,
      },
    )

    // A partir daqui o ciclo ja esta registrado em `api_sync_logs` (o core
    // gravou). Falhas de disco abaixo sao best-effort e nunca viram `aborted`.
    mainLogWritten = result.touchedNetwork

    if (args.sample && result.firstRawPayload !== null && apiKey !== null) {
      try {
        const sanitized = sanitizePayload(result.firstRawPayload, {
          secrets: [apiKey],
          maxArrayItems: 5,
        })
        const samplePath = path.join(
          dataDir(),
          `streaming-availability-sample-${args.kind}-${args.country}.json`,
        )
        mkdirSync(path.dirname(samplePath), { recursive: true })
        writeFileSync(samplePath, `${JSON.stringify(sanitized, null, 2)}\n`)
        console.log(`Sample sanitizado: ${samplePath}`)
      } catch (error) {
        console.warn(
          'Nao foi possivel escrever o sample:',
          error instanceof Error ? error.message : error,
        )
      }
    }

    const report = buildStreamingReport(result, {
      apply: args.apply,
      sample: args.sample,
      kind: args.kind,
      country: args.country,
      providerApi: STREAMING_AVAILABILITY_PROVIDER_API,
    })
    writeReport(report, args.report, mode, args.kind, args.country)

    console.log(
      `status=${result.status} · entidades=${result.counters.entitiesFetched}/${result.counters.entitiesSelected} · ` +
        `ofertas reconhecidas=${result.counters.offersRecognized} · ` +
        `gravadas=${result.counters.offersWritten} · quota=${result.quotaCost}`,
    )
    if (result.status === 'failed') process.exitCode = 1
  } catch (error) {
    // Todo sync externo gera log — inclusive o abortado por erro inesperado.
    // MAS so se a linha autoritativa ainda nao saiu: um ciclo que ja logou
    // `success` nunca pode ganhar uma 2a linha `aborted` contraditoria.
    try {
      if (!mainLogWritten) {
        await syncLog.write({
          endpoint: STREAMING_SYNC_ENDPOINT,
          status: 'aborted',
          errorCode: 'streaming_availability_unexpected_error',
        })
      }
    } catch (logError) {
      console.error(
        'Falha ao registrar log de abort:',
        logError instanceof Error ? logError.message : logError,
      )
    }
    process.exitCode = 1
    console.error(
      'Sync de disponibilidade abortado por erro inesperado:',
      error instanceof Error ? error.message : error,
    )
  } finally {
    await disconnectPrisma()
  }
}

/** Escreve o relatorio (best-effort). */
function writeReport(
  report: ReturnType<typeof buildStreamingReport>,
  explicitPath: string | null,
  mode: string,
  kind: string,
  country: string,
): void {
  try {
    const target =
      explicitPath === null
        ? path.join(dataDir(), `streaming-availability-report-${mode}-${kind}-${country}.md`)
        : path.isAbsolute(explicitPath)
          ? explicitPath
          : path.resolve(process.cwd(), explicitPath)

    mkdirSync(path.dirname(target), { recursive: true })
    const body = target.endsWith('.json')
      ? serializeStreamingReportJson(report)
      : renderStreamingReport(report)
    writeFileSync(target, `${body}\n`)
    console.log(`Relatorio: ${target}`)
  } catch (error) {
    console.warn(
      'Nao foi possivel escrever o relatorio:',
      error instanceof Error ? error.message : error,
    )
  }
}

main().catch((error: unknown) => {
  console.error(
    'Falha no sync de disponibilidade:',
    error instanceof Error ? error.message : error,
  )
  process.exitCode = 1
})
