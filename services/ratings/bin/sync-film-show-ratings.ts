#!/usr/bin/env node
/**
 * bin/sync-film-show-ratings.ts — Worker OFFLINE do Film/Show Ratings (RapidAPI).
 * Worker-only — NUNCA no render.
 *
 * Fica em `services/ratings/bin`: EXCLUIDO do typecheck e do bundle de render.
 * Usa o core PURO em `../src/**` (typechecked + testado) e adiciona so o IO:
 * client HTTP, Prisma (api_cache / api_sync_logs / external_ratings), sample e
 * relatorio em `.data/` (gitignored).
 *
 * ENDPOINT: `GET /item/?id=<IMDb_ID>`. O plano Pro NAO libera `/popular/` (403),
 * entao o worker enriquece entidades locais JA existentes, uma por vez, por
 * identificador inequivoco (IMDb id). Nunca casa por titulo/ano.
 *
 * O QUE FAZ:
 *  - Dry-run (default): reporta o PLANO (endpoint + ids que SERIAM consultados).
 *    ZERO rede, ZERO DB, ZERO quota.
 *  - `--sample`: busca o(s) payload(s) REAL(is) de `/item/`, grava `api_cache` +
 *    `api_sync_logs` e escreve um sample SANITIZADO por id em `.data/`. NAO grava
 *    `external_ratings`.
 *  - `--apply`: idem, e grava `external_ratings` SO para o que tiver mapping
 *    inequivoco (fonte editorial + metrica + escala) e entidade local resolvida
 *    por IMDb id. Tudo o mais e recusado e contado no relatorio.
 *
 * SELECAO DE IDS:
 *  - `--id=tt...`: enriquece exatamente esse id.
 *  - sem `--id`: seleciona ate `--limit` (default 20) entidades locais do
 *    `--type` (movie/tv) que tenham IMDb id.
 *
 * NAO FAZ: exibir nada publicamente; tocar `screen_score` (nota editorial
 * PROPRIA da Cinerie, que jamais recebe dado de terceiro); alterar slugs,
 * canonical, redirects ou UI; baixar imagem; criar migration; chamar `/popular/`.
 *
 * SEGREDO: `RAPIDAPI_FILM_SHOW_RATINGS_KEY` so em env var. Nunca e impressa,
 * nunca entra em URL, relatorio, sample ou log.
 *
 * FAIL-CLOSED: aborta em producao; `--sample`/`--apply` exigem a chave E
 * `DATABASE_URL` (toda chamada externa grava `api_cache` + `api_sync_logs`);
 * `--apply` exige tambem `--type`; `--sample` sem `--id` exige `--type`.
 *
 * Uso (a partir da raiz). Resolva o cli do tsx e rode, como os demais bins:
 *   TSX="$(ls node_modules/.pnpm/tsx@*\/node_modules/tsx/dist/cli.mjs | head -1)"
 *   node "$TSX" services/ratings/bin/sync-film-show-ratings.ts --type=film --limit=20
 *   node "$TSX" services/ratings/bin/sync-film-show-ratings.ts --type=film --id=tt9603208 --sample
 *   node "$TSX" services/ratings/bin/sync-film-show-ratings.ts --type=film --limit=5 --sample
 *   node "$TSX" services/ratings/bin/sync-film-show-ratings.ts --type=film --limit=5 --apply
 *
 *   Flags de valor aceitam `--flag=valor` e `--flag valor`. Valor ausente, flag
 *   desconhecida ou valor invalido FALHAM com erro claro (nunca default silencioso).
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createFilmShowRatingsClient,
  loadFilmShowRatingsConfig,
  FILM_SHOW_RATINGS_ITEM_ENDPOINT,
  FILM_SHOW_RATINGS_KEY_ENV,
  FILM_SHOW_RATINGS_PROVIDER_API,
} from '@screena/film-show-ratings-client'
import { sanitizePayload } from '@screena/rapidapi-core'
import { disconnectPrisma, getPrismaClient } from '@screena/db/server'

import { parseFilmShowRatingsArgs } from '../src/film-show-ratings/args.js'
import { describeRatingsGateReason, evaluateRatingsGate } from '../src/film-show-ratings/gate.js'
import {
  buildItemRatingsReport,
  renderRatingsReport,
  runMode,
  serializeRatingsReportJson,
} from '../src/film-show-ratings/report.js'
import {
  DEFAULT_ITEM_CANDIDATE_LIMIT,
  runFilmShowRatingsItemSync,
} from '../src/film-show-ratings/run.js'
import type {
  CachePort,
  EntityCandidateSelectPort,
  EntityLookupPort,
  ExternalRatingsPort,
  SyncLogPort,
} from '../src/ports.js'

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

const dataDir = (): string => path.join(repoRoot(), 'services', 'ratings', '.data')

/** Portas inertes: usadas em dry-run puro, quando nao ha DB nem rede. */
const NOOP_CACHE: CachePort = { async write() {} }
const NOOP_SYNC_LOG: SyncLogPort = { async write() {} }
const NOOP_ENTITIES: EntityLookupPort = {
  async findByImdbId() {
    return null
  },
  async findByTmdbId() {
    return null
  },
}
const NOOP_CANDIDATES: EntityCandidateSelectPort = {
  async selectByType() {
    return []
  },
}
const NOOP_RATINGS: ExternalRatingsPort = {
  async upsert() {
    return { created: false, changed: false }
  },
}

async function main(): Promise<void> {
  loadRepoEnv()

  const parsed = parseFilmShowRatingsArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`Argumentos invalidos: ${parsed.error}`)
    process.exitCode = 1
    return
  }
  const args = parsed.args

  const isProd =
    process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
  const hasKey = Boolean(process.env[FILM_SHOW_RATINGS_KEY_ENV]?.trim())
  const hasDb = Boolean(process.env.DATABASE_URL?.trim())

  const gate = evaluateRatingsGate({
    isProd,
    apply: args.apply,
    sample: args.sample,
    hasKey,
    hasDb,
  })
  if (!gate.allowed && gate.reason !== null) {
    console.error(describeRatingsGateReason(gate.reason))
    process.exitCode = 1
    return
  }

  const touchesNetwork = args.apply || args.sample
  const mode = runMode(args)

  // Dry-run PURO: sem rede, sem DB, sem cliente HTTP, sem chave.
  if (!touchesNetwork) {
    const result = await runFilmShowRatingsItemSync(
      {
        apply: false,
        sample: false,
        type: args.type,
        id: args.id,
        limit: args.limit,
        providerApi: FILM_SHOW_RATINGS_PROVIDER_API,
        cacheTtlMs: 0,
      },
      {
        fetchItem: () => Promise.reject(new Error('dry-run nao busca payload')),
        cache: NOOP_CACHE,
        syncLog: NOOP_SYNC_LOG,
        entities: NOOP_ENTITIES,
        candidates: NOOP_CANDIDATES,
        ratings: NOOP_RATINGS,
        now: () => new Date(),
        requestCount: () => 0,
      },
    )
    const report = buildItemRatingsReport(result, {
      apply: false,
      sample: false,
      providerApi: FILM_SHOW_RATINGS_PROVIDER_API,
    })
    writeReport(report, args.report, mode, args.type)

    const target =
      args.id !== null
        ? `id=${args.id}`
        : args.type !== null
          ? `ate ${args.limit ?? DEFAULT_ITEM_CANDIDATE_LIMIT} candidato(s) ${args.type} local(is)`
          : '(informe --id=tt... ou --type=film|show)'
    console.log(
      `[dry-run] plano: GET ${result.endpoint}?id=<IMDb> · alvo: ${target} · ` +
        'nada foi chamado, nada foi gravado.',
    )
    return
  }

  // A partir daqui a rede sera tocada, e o gate ja garantiu chave + DATABASE_URL.
  const config = loadFilmShowRatingsConfig(process.env)
  const client = createFilmShowRatingsClient(config)
  const prisma = getPrismaClient()

  const { createPrismaCache } = await import('../src/persistence/cache.js')
  const { createPrismaSyncLog } = await import('../src/persistence/sync-log.js')
  const { createPrismaEntityLookup } = await import('../src/persistence/entity-lookup.js')
  const { createPrismaEntityCandidates } = await import('../src/persistence/entity-candidates.js')
  const { createPrismaExternalRatings } = await import(
    '../src/persistence/external-ratings-store.js'
  )

  const syncLog = createPrismaSyncLog(prisma, FILM_SHOW_RATINGS_PROVIDER_API)

  // O core ja grava a linha AUTORITATIVA de `api_sync_logs` quando toca a rede.
  // Este flag impede que uma falha POSTERIOR (escrita de sample/relatorio em
  // disco) acrescente uma 2a linha `aborted` contraditoria para o mesmo ciclo.
  let mainLogWritten = false

  try {
    const result = await runFilmShowRatingsItemSync(
      {
        apply: args.apply,
        sample: args.sample,
        type: args.type,
        id: args.id,
        limit: args.limit,
        providerApi: FILM_SHOW_RATINGS_PROVIDER_API,
        cacheTtlMs: config.cacheTtlMs,
      },
      {
        fetchItem: (id) => client.getItem(id),
        cache: createPrismaCache(prisma, FILM_SHOW_RATINGS_PROVIDER_API),
        syncLog,
        // Em `--sample` (sem `--apply`) o core nunca resolve nem grava entidade.
        entities: args.apply ? createPrismaEntityLookup(prisma) : NOOP_ENTITIES,
        // Candidatos locais so sao selecionados quando `--id` nao foi informado.
        candidates: args.id === null ? createPrismaEntityCandidates(prisma) : NOOP_CANDIDATES,
        ratings: args.apply ? createPrismaExternalRatings(prisma) : NOOP_RATINGS,
        now: () => new Date(),
        requestCount: () => client.getRequestCount(),
      },
    )

    // A partir daqui o ciclo ja esta registrado em `api_sync_logs` (o core
    // gravou). Falhas de disco abaixo sao best-effort e nunca viram `aborted`.
    mainLogWritten = result.touchedNetwork

    if (args.sample) {
      // Um sample sanitizado por id consultado: `...-item-<id>.json`.
      for (const item of result.items) {
        if (item.rawPayload === null) continue
        try {
          // Sanitizacao dupla: por nome de campo E por valor do segredo conhecido.
          const sanitized = sanitizePayload(item.rawPayload, {
            secrets: [config.apiKey],
            maxArrayItems: 5,
          })
          const samplePath = path.join(dataDir(), `film-show-ratings-sample-item-${item.id}.json`)
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
    }

    const report = buildItemRatingsReport(result, {
      apply: args.apply,
      sample: args.sample,
      providerApi: FILM_SHOW_RATINGS_PROVIDER_API,
    })
    writeReport(report, args.report, mode, args.type)

    if (result.idsQueried > 0 && result.counters.ratingsRecognized === 0) {
      console.log(
        'Nenhum rating reconhecido nos ids consultados. Inspecione o sample e, se ' +
          'necessario, estenda o reconhecedor (services/ratings/src/film-show-ratings/mapping.ts).',
      )
    }
    console.log(
      `status=${result.status} · ids=${result.idsQueried} · falhas=${result.idsFailed} · ` +
        `ratings reconhecidos=${result.counters.ratingsRecognized} · ` +
        `gravados=${result.counters.ratingsWritten} · sem entidade=${result.idsWithoutEntity} · ` +
        `quota=${result.quotaCost}`,
    )
    if (result.status === 'failed') process.exitCode = 1
  } catch (error) {
    // Todo sync externo gera log — inclusive o abortado por erro inesperado.
    // MAS so se a linha autoritativa ainda nao saiu: um ciclo que ja logou
    // `success` nunca pode ganhar uma 2a linha `aborted` contraditoria.
    try {
      if (!mainLogWritten) {
        await syncLog.write({
          endpoint: FILM_SHOW_RATINGS_ITEM_ENDPOINT,
          status: 'aborted',
          errorCode: 'film_show_ratings_unexpected_error',
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
      'Sync de ratings abortado por erro inesperado:',
      error instanceof Error ? error.message : error,
    )
  } finally {
    await disconnectPrisma()
  }
}

/** Escreve o relatorio (best-effort: uma falha de disco nunca invalida o sync). */
function writeReport(
  report: ReturnType<typeof buildItemRatingsReport>,
  explicitPath: string | null,
  mode: string,
  type: string | null,
): void {
  try {
    const target =
      explicitPath === null
        ? path.join(dataDir(), `film-show-ratings-report-${mode}-${type ?? 'all'}.md`)
        : path.isAbsolute(explicitPath)
          ? explicitPath
          : path.resolve(process.cwd(), explicitPath)

    mkdirSync(path.dirname(target), { recursive: true })
    const body = target.endsWith('.json')
      ? serializeRatingsReportJson(report)
      : renderRatingsReport(report)
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
  console.error('Falha no sync de ratings:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
