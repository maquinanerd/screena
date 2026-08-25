#!/usr/bin/env node
/**
 * bin/sync-omdb-ratings.ts — Worker OFFLINE de ratings via OMDb.
 * Worker-only — NUNCA no render.
 *
 * Fica em `services/ratings/bin`: fora do bundle de render, mas COBERTO pelo
 * typecheck — esta LISTADO em `tsconfig.runtime.json`, que `pnpm typecheck`
 * encadeia. (A lista la e por ARQUIVO, nao por diretorio: nem todo bin entra.)
 * Usa o core PURO em `../src/omdb/**` (typechecked + testado) e adiciona so o
 * IO: client HTTP, Prisma (api_cache / api_sync_logs / external_ratings), sample
 * e relatorio em `.data/` (gitignored).
 *
 * ENDPOINT: `GET /?i=<IMDb_ID>`. Um payload devolve as notas de TRES fontes
 * editoriais (IMDb, Rotten Tomatoes, Metacritic) de uma vez — cada uma vira sua
 * propria linha em `external_ratings`, com sua escala e seu credito.
 * `omdb` e o fornecedor TECNICO e nunca a fonte de nota nenhuma (invariante 2).
 *
 * O QUE FAZ:
 *  - Dry-run (default): reporta o PLANO. ZERO rede, ZERO DB, ZERO cota.
 *  - `--sample`: busca o(s) payload(s) REAL(is), grava `api_cache` +
 *    `api_sync_logs` e escreve um sample SANITIZADO por id em `.data/`. NAO
 *    grava `external_ratings`.
 *  - `--apply`: idem, e grava `external_ratings` so para o que tiver mapping
 *    inequivoco e entidade local resolvida por IMDb id. Tudo o mais e recusado
 *    e contado no relatorio.
 *
 * SELECAO DE IDS:
 *  - `--id=tt...`: consulta exatamente esse id (ignora frescor: foi pedido).
 *  - sem `--id`: seleciona ate `--limit` (default 20) entidades locais do
 *    `--type` (movie/tv) que tenham IMDb id E cuja coleta OMDb esteja fora da
 *    janela de frescor (`RATING_STALE_POLICY`). `--ignore-freshness` desliga o
 *    filtro (queima cota; use so apos mudanca de licenca/politica).
 *
 * COTA: o plano gratuito sao 1.000 requisicoes por DIA. Uma requisicao rende as
 * tres notas, entao o teto vale em ENTIDADES/dia. O relatorio informa o gasto.
 * Protecao ativa: 3 falhas CONSECUTIVAS (ou circuito aberto) interrompem o lote
 * e o relatorio diz quantos ids ficaram sem consulta.
 *
 * NAO FAZ: exibir nada publicamente; tocar `screen_score`; alterar slugs,
 * canonical, redirects ou UI; baixar imagem; criar migration.
 *
 * SEGREDO: `OMDB_API_KEY` so em env var. A OMDb nao aceita header, entao a
 * chave viaja em query — e nunca e impressa, nunca entra em relatorio, sample,
 * log ou `api_cache`.
 *
 * FAIL-CLOSED: producao exige `CINERIE_RATINGS_PROVIDER_AUTHORIZED=true`;
 * `--sample`/`--apply` exigem a chave E `DATABASE_URL`; `--apply` exige `--type`.
 *
 * Uso (a partir da raiz):
 *   TSX="$(ls node_modules/.pnpm/tsx@*\/node_modules/tsx/dist/cli.mjs | head -1)"
 *   node "$TSX" services/ratings/bin/sync-omdb-ratings.ts --type=movie --limit=20
 *   node "$TSX" services/ratings/bin/sync-omdb-ratings.ts --id=tt3896198 --sample
 *   node "$TSX" services/ratings/bin/sync-omdb-ratings.ts --type=movie --limit=5 --apply
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createOmdbClient,
  loadOmdbConfig,
  OMDB_ENDPOINT,
  OMDB_KEY_ENV,
  OMDB_PROVIDER_API,
} from '@screena/omdb-client'
import { sanitizePayload } from '@screena/rapidapi-core'
import { disconnectPrisma, getPrismaClient } from '@screena/db/server'

import { parseOmdbArgs } from '../src/omdb/args.js'
import { describeOmdbGateReason, evaluateOmdbGate } from '../src/omdb/gate.js'
import {
  buildOmdbReport,
  omdbRunMode,
  renderOmdbReport,
  serializeOmdbReportJson,
} from '../src/omdb/report.js'
import { DEFAULT_OMDB_CANDIDATE_LIMIT, runOmdbRatingsSync } from '../src/omdb/run.js'
import type {
  CachePort,
  EntityLookupPort,
  ExternalRatingsPort,
  StaleEntityCandidateSelectPort,
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
const NOOP_CANDIDATES: StaleEntityCandidateSelectPort = {
  async selectStaleByType() {
    return { candidates: [], skippedFresh: 0 }
  },
}
const NOOP_RATINGS: ExternalRatingsPort = {
  async upsert() {
    return { created: false, changed: false }
  },
}

async function main(): Promise<void> {
  loadRepoEnv()

  const parsed = parseOmdbArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`Argumentos invalidos: ${parsed.error}`)
    process.exitCode = 1
    return
  }
  const args = parsed.args

  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
  const hasKey = Boolean(process.env[OMDB_KEY_ENV]?.trim())
  const hasDb = Boolean(process.env.DATABASE_URL?.trim())

  // Comparacao com a string exata: "1", "yes" ou "sim" NAO autorizam producao.
  const providerAuthorized = process.env.CINERIE_RATINGS_PROVIDER_AUTHORIZED?.trim() === 'true'

  const gate = evaluateOmdbGate({
    isProd,
    apply: args.apply,
    sample: args.sample,
    hasKey,
    hasDb,
    providerAuthorized,
  })
  if (!gate.allowed && gate.reason !== null) {
    console.error(describeOmdbGateReason(gate.reason))
    process.exitCode = 1
    return
  }

  const touchesNetwork = args.apply || args.sample
  const mode = omdbRunMode(args)

  // Dry-run PURO: sem rede, sem DB, sem cliente HTTP, sem chave.
  if (!touchesNetwork) {
    const result = await runOmdbRatingsSync(
      {
        apply: false,
        sample: false,
        entityType: args.type,
        id: args.id,
        limit: args.limit,
        providerApi: OMDB_PROVIDER_API,
        cacheTtlMs: 0,
        ignoreFreshness: args.ignoreFreshness,
        // FILA DE FUNDO. O leitor esperando na tela entra como `on_demand` pela
        // cobertura sob demanda, com reserva propria — aqui e sempre a semente,
        // que cede a vez quando o saldo entra na reserva do leitor.
        consumer: 'seed',
      },
      {
        fetchTitle: () => Promise.reject(new Error('dry-run nao busca payload')),
        cache: NOOP_CACHE,
        syncLog: NOOP_SYNC_LOG,
        entities: NOOP_ENTITIES,
        candidates: NOOP_CANDIDATES,
        ratings: NOOP_RATINGS,
        now: () => new Date(),
        requestCount: () => 0,
      },
    )
    const report = buildOmdbReport(result, {
      apply: false,
      sample: false,
      providerApi: OMDB_PROVIDER_API,
    })
    writeReport(report, args.report, mode, args.type)

    const target =
      args.id !== null
        ? `id=${args.id}`
        : args.type !== null
          ? `ate ${args.limit ?? DEFAULT_OMDB_CANDIDATE_LIMIT} candidato(s) ${args.type} local(is) fora da janela de frescor`
          : '(informe --id=tt... ou --type=movie|tv)'
    console.log(
      `[dry-run] plano: GET ${result.endpoint}?i=<IMDb> · alvo: ${target} · ` +
        'nada foi chamado, nada foi gravado.',
    )
    return
  }

  // A partir daqui a rede sera tocada, e o gate ja garantiu chave + DATABASE_URL.
  const config = loadOmdbConfig(process.env)
  const client = createOmdbClient(config)
  const prisma = getPrismaClient()

  const { createPrismaCache } = await import('../src/persistence/cache.js')
  const { createPrismaSyncLog } = await import('../src/persistence/sync-log.js')
  const { createPrismaEntityLookup } = await import('../src/persistence/entity-lookup.js')
  const { createPrismaStaleEntityCandidates } = await import(
    '../src/persistence/stale-entity-candidates.js'
  )
  const { createPrismaExternalRatings } = await import(
    '../src/persistence/external-ratings-store.js'
  )
  const { createPrismaRatingCreditLookup } = await import(
    '../src/persistence/rating-credit-lookup.js'
  )

  const { createPrismaOmdbBudget } = await import('../src/persistence/omdb-budget-source.js')

  const syncLog = createPrismaSyncLog(prisma, OMDB_PROVIDER_API)

  // O core ja grava a linha AUTORITATIVA de `api_sync_logs` quando toca a rede.
  // Este flag impede que uma falha POSTERIOR (escrita de sample/relatorio em
  // disco) acrescente uma 2a linha `aborted` contraditoria para o mesmo ciclo.
  let mainLogWritten = false

  try {
    const result = await runOmdbRatingsSync(
      {
        apply: args.apply,
        sample: args.sample,
        entityType: args.type,
        id: args.id,
        limit: args.limit,
        providerApi: OMDB_PROVIDER_API,
        cacheTtlMs: config.cacheTtlMs,
        ignoreFreshness: args.ignoreFreshness,
      },
      {
        fetchTitle: (imdbId) => client.getByImdbId(imdbId),
        cache: createPrismaCache(prisma, OMDB_PROVIDER_API),
        syncLog,
        // Em `--sample` (sem `--apply`) o core nunca resolve nem grava entidade.
        entities: args.apply ? createPrismaEntityLookup(prisma) : NOOP_ENTITIES,
        // Candidatos locais so sao selecionados quando `--id` nao foi informado.
        candidates:
          args.id === null ? createPrismaStaleEntityCandidates(prisma) : NOOP_CANDIDATES,
        // A nota nasce fail-closed e, logo apos persistida, a politica de
        // exibicao decide se acende — com base na licenca que o proprietario
        // autorizou (services/legal). Nenhuma recusa e silenciosa: o motivo
        // sempre vai para o console.
        ratings: args.apply
          ? createPrismaExternalRatings(prisma, {
              credits: createPrismaRatingCreditLookup(prisma),
              log: (message) => console.warn(message),
            })
          : NOOP_RATINGS,
        now: () => new Date(),
        requestCount: () => client.getRequestCount(),
        // A COTA, finalmente ligada. `checkOmdbBudget` existia, estava testado e
        // NUNCA era chamado por nada em producao: a fila de fundo gastava o teto
        // inteiro sem pedir licenca. Com `--id` explicito o porto NAO entra — o
        // operador pediu UM id nominalmente, e barrar um pedido nominal por
        // causa da fila de fundo seria o inverso da politica.
        budget: args.id === null ? createPrismaOmdbBudget(prisma, () => new Date()) : undefined,
      },
    )

    // A partir daqui o ciclo ja esta registrado em `api_sync_logs` (o core
    // gravou). Falhas de disco abaixo sao best-effort e nunca viram `aborted`.
    mainLogWritten = result.touchedNetwork

    if (args.sample) {
      for (const item of result.items) {
        if (item.rawPayload === null) continue
        try {
          // Sanitizacao dupla: por nome de campo E por valor do segredo conhecido.
          const sanitized = sanitizePayload(item.rawPayload, {
            secrets: [config.apiKey],
            maxArrayItems: 5,
          })
          const samplePath = path.join(dataDir(), `omdb-sample-${item.id}.json`)
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

    const report = buildOmdbReport(result, {
      apply: args.apply,
      sample: args.sample,
      providerApi: OMDB_PROVIDER_API,
    })
    writeReport(report, args.report, mode, args.type)

    if (result.idsQueried > 0 && result.counters.ratingsRecognized === 0) {
      console.log(
        'Nenhum rating reconhecido nos ids consultados. Inspecione o sample e, se ' +
          'necessario, estenda o reconhecedor (services/ratings/src/omdb/sources.ts).',
      )
    }
    if (result.idsQueried === 0 && result.idsSkippedFresh > 0) {
      console.log(
        `Nada a consultar: ${result.idsSkippedFresh} entidade(s) ja coletada(s) dentro da janela de ` +
          `${result.refreshWindowHours ?? '-'}h. Use --ignore-freshness para forcar.`,
      )
    }
    const bySource = report.by_source.map((s) => `${s.source}=${s.count}`).join(' ')
    console.log(
      `status=${result.status} · ids=${result.idsQueried} · falhas=${result.idsFailed} · ` +
        `frescos pulados=${result.idsSkippedFresh} · ratings reconhecidos=${result.counters.ratingsRecognized}` +
        `${bySource === '' ? '' : ` (${bySource})`} · ` +
        `gravados=${result.counters.ratingsWritten} · sem entidade=${result.idsWithoutEntity} · ` +
        `cota=${result.quotaCost}/${report.quota.daily_limit} por dia`,
    )
    if (result.status === 'failed') process.exitCode = 1
  } catch (error) {
    // Todo sync externo gera log — inclusive o abortado por erro inesperado.
    // MAS so se a linha autoritativa ainda nao saiu.
    try {
      if (!mainLogWritten) {
        await syncLog.write({
          endpoint: OMDB_ENDPOINT,
          status: 'aborted',
          errorCode: 'omdb_unexpected_error',
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
      'Sync de ratings (OMDb) abortado por erro inesperado:',
      error instanceof Error ? error.message : error,
    )
  } finally {
    await disconnectPrisma()
  }
}

/** Escreve o relatorio (best-effort: uma falha de disco nunca invalida o sync). */
function writeReport(
  report: ReturnType<typeof buildOmdbReport>,
  explicitPath: string | null,
  mode: string,
  type: string | null,
): void {
  try {
    const target =
      explicitPath === null
        ? path.join(dataDir(), `omdb-report-${mode}-${type ?? 'all'}.md`)
        : path.isAbsolute(explicitPath)
          ? explicitPath
          : path.resolve(process.cwd(), explicitPath)

    mkdirSync(path.dirname(target), { recursive: true })
    const body = target.endsWith('.json')
      ? serializeOmdbReportJson(report)
      : renderOmdbReport(report)
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
    'Falha no sync de ratings (OMDb):',
    error instanceof Error ? error.message : error,
  )
  process.exitCode = 1
})
