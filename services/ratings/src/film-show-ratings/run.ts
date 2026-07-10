/**
 * run.ts — Orquestracao PURA do worker de ratings (Film/Show Ratings).
 *
 * Depende so de portas (`CachePort`, `SyncLogPort`, `EntityLookupPort`,
 * `ExternalRatingsPort`) e de uma funcao `fetchPopular` injetada. Nenhum Prisma,
 * nenhum `fetch` real, nenhum relogio real. Testavel com fakes.
 *
 * Regras materializadas aqui:
 *  - `--dry-run` (default) NUNCA grava `external_ratings`;
 *  - `--apply` grava SO o que passou pelo reconhecedor estrito + `validateRating`
 *    + resolucao inequivoca da entidade local;
 *  - toda execucao que TOCA a rede grava `api_cache` e `api_sync_logs`;
 *  - `display_allowed = false` e `license_status = unknown` sao decididos no
 *    adapter de escrita (invariante 6) — o core nunca os afrouxa.
 */

import { buildPopularRequest, type FilmShowRatingsPopularType } from '@screena/film-show-ratings-client'
import { hashPayload } from '@screena/rapidapi-core'

import type {
  CachePort,
  EntityLookupPort,
  ExternalRatingsPort,
  SyncLogPort,
  SyncStatus,
} from '../ports.js'
import { mapPopularPayload } from './mapping.js'
import type {
  ExternalRatingRow,
  RatingRejection,
  RatingsEntityType,
  PopularEntityRef,
} from './types.js'

/** `film` -> `movie`, `show` -> `tv`. */
export function entityTypeOf(type: FilmShowRatingsPopularType): RatingsEntityType {
  return type === 'film' ? 'movie' : 'tv'
}

/** Dependencias injetadas do run. */
export interface RatingsRunDeps {
  /** Busca o payload cru de `/popular/`. Lanca em falha de rede/HTTP. */
  readonly fetchPopular: (type: FilmShowRatingsPopularType | null) => Promise<unknown>
  readonly cache: CachePort
  readonly syncLog: SyncLogPort
  readonly entities: EntityLookupPort
  readonly ratings: ExternalRatingsPort
  readonly now: () => Date
  /** Requisicoes gastas (para `quota_cost`). */
  readonly requestCount: () => number
}

/** Opcoes do run. */
export interface RatingsRunOptions {
  readonly apply: boolean
  readonly sample: boolean
  readonly type: FilmShowRatingsPopularType | null
  readonly limit: number | null
  readonly providerApi: string
  readonly cacheTtlMs: number
}

/** Contagem de resultados por item. */
export interface RatingsRunCounters {
  readonly itemsSeen: number
  readonly ratingsRecognized: number
  readonly ratingsWritten: number
  readonly ratingsCreated: number
  readonly ratingsUpdated: number
  /** Linhas ja identicas: nada reescrito, `updated_at` intacto. */
  readonly ratingsUnchanged: number
}

/** Resultado do run (alimenta o relatorio). */
export interface RatingsRunResult {
  readonly status: SyncStatus
  readonly endpoint: string
  readonly touchedNetwork: boolean
  readonly recognized: boolean
  readonly payloadHash: string | null
  /** Payload CRU (o bin sanitiza antes de escrever o sample). */
  readonly rawPayload: unknown
  readonly counters: RatingsRunCounters
  readonly rejections: readonly RatingRejection[]
  readonly durationMs: number
  readonly quotaCost: number
  readonly errorCode: string | null
}

const EMPTY_COUNTERS: RatingsRunCounters = {
  itemsSeen: 0,
  ratingsRecognized: 0,
  ratingsWritten: 0,
  ratingsCreated: 0,
  ratingsUpdated: 0,
  ratingsUnchanged: 0,
}

/** Resolve a entidade local por id inequivoco. IMDb tem precedencia sobre TMDB. */
async function resolveEntity(
  entities: EntityLookupPort,
  entityType: RatingsEntityType,
  ref: PopularEntityRef,
): Promise<string | null> {
  if (ref.imdbId !== null) {
    const byImdb = await entities.findByImdbId(entityType, ref.imdbId)
    if (byImdb !== null) return byImdb.entityId
  }
  if (ref.tmdbId !== null) {
    const byTmdb = await entities.findByTmdbId(entityType, ref.tmdbId)
    if (byTmdb !== null) return byTmdb.entityId
  }
  return null
}

/**
 * Executa um ciclo do worker.
 *
 * Dry-run PURO (sem `--sample` e sem `--apply`) nao toca a rede: devolve o plano
 * (endpoint que SERIA chamado) com `status: 'empty'` e zero quota.
 */
export async function runFilmShowRatingsSync(
  options: RatingsRunOptions,
  deps: RatingsRunDeps,
): Promise<RatingsRunResult> {
  const startedAt = deps.now().getTime()
  const request = buildPopularRequest(options.type ?? undefined)
  const touchesNetwork = options.apply || options.sample

  if (!touchesNetwork) {
    return {
      status: 'empty',
      endpoint: request.endpoint,
      touchedNetwork: false,
      recognized: false,
      payloadHash: null,
      rawPayload: null,
      counters: EMPTY_COUNTERS,
      rejections: [],
      durationMs: deps.now().getTime() - startedAt,
      quotaCost: 0,
      errorCode: null,
    }
  }

  let payload: unknown
  try {
    payload = await deps.fetchPopular(options.type)
  } catch (error) {
    const durationMs = deps.now().getTime() - startedAt
    const errorCode = error instanceof Error ? error.name : 'UnknownError'
    // Todo sync externo gera log — inclusive o que falhou.
    await deps.syncLog.write({
      endpoint: request.endpoint,
      status: 'failed',
      errorCode,
      durationMs,
      quotaCost: deps.requestCount(),
    })
    return {
      status: 'failed',
      endpoint: request.endpoint,
      touchedNetwork: true,
      recognized: false,
      payloadHash: null,
      rawPayload: null,
      counters: EMPTY_COUNTERS,
      rejections: [],
      durationMs,
      quotaCost: deps.requestCount(),
      errorCode,
    }
  }

  const fetchedAt = deps.now()
  const payloadHash = hashPayload(payload)

  // O bruto vai para `api_cache` SEMPRE que houve rede (mesmo sem mapping).
  await deps.cache.write({
    endpoint: request.endpoint,
    requestKey: request.cacheKey.requestKey,
    paramsHash: request.cacheKey.paramsHash,
    payload,
    payloadHash,
    fetchedAt,
    expiresAt: new Date(fetchedAt.getTime() + options.cacheTtlMs),
  })

  const mapping = mapPopularPayload(payload, options.providerApi)
  const rejections: RatingRejection[] = [...mapping.rejections]

  const limitedItems =
    options.limit === null ? mapping.items : mapping.items.slice(0, options.limit)

  // Sem `--type` nao ha como saber se um item e `movie` ou `tv`. O parser ja
  // exige `--type` sob `--apply`; aqui a garantia e ESTRUTURAL (nao ha cast):
  // sem tipo, `applyEntityType` e null e nada e gravado.
  const applyEntityType: RatingsEntityType | null =
    options.type === null ? null : entityTypeOf(options.type)
  const canApply = options.apply && applyEntityType !== null
  if (options.apply && applyEntityType === null) {
    rejections.push({
      reason: 'entity-not-found',
      detail: '--apply sem --type: tipo de entidade indeterminado; nada gravado.',
    })
  }

  let ratingsRecognized = 0
  let ratingsWritten = 0
  let ratingsCreated = 0
  let ratingsUpdated = 0
  let ratingsUnchanged = 0

  for (const item of limitedItems) {
    rejections.push(...item.rejections)
    ratingsRecognized += item.ratings.length

    if (!canApply || applyEntityType === null || item.ratings.length === 0 || item.ref === null) {
      continue
    }

    const entityType = applyEntityType
    const entityId = await resolveEntity(deps.entities, entityType, item.ref)
    if (entityId === null) {
      rejections.push({
        reason: 'entity-not-found',
        detail: `item ${item.index}: nenhuma entidade ${entityType} local para imdbId=${item.ref.imdbId ?? '-'} tmdbId=${item.ref.tmdbId ?? '-'}`,
      })
      continue
    }

    for (const draft of item.ratings) {
      const row: ExternalRatingRow = {
        ...draft,
        entityType,
        entityId,
        providerApi: options.providerApi,
        providerPayloadHash: payloadHash,
        fetchedAt,
      }
      const outcome = await deps.ratings.upsert(row)
      if (outcome.created) {
        ratingsCreated += 1
        ratingsWritten += 1
      } else if (outcome.changed) {
        ratingsUpdated += 1
        ratingsWritten += 1
      } else {
        ratingsUnchanged += 1
      }
    }
  }

  const durationMs = deps.now().getTime() - startedAt
  const quotaCost = deps.requestCount()

  // `empty` quando a forma nem foi reconhecida; `partial` quando reconhecemos
  // algo mas houve recusa; `success` quando nada foi recusado.
  let status: SyncStatus
  if (!mapping.recognized) status = 'empty'
  else if (rejections.length > 0) status = 'partial'
  else status = 'success'

  await deps.syncLog.write({
    endpoint: request.endpoint,
    status,
    itemsProcessed: limitedItems.length,
    itemsCreated: ratingsCreated,
    itemsUpdated: ratingsUpdated,
    durationMs,
    quotaCost,
    payloadHash,
  })

  return {
    status,
    endpoint: request.endpoint,
    touchedNetwork: true,
    recognized: mapping.recognized,
    payloadHash,
    rawPayload: payload,
    counters: {
      itemsSeen: limitedItems.length,
      ratingsRecognized,
      ratingsWritten,
      ratingsCreated,
      ratingsUpdated,
      ratingsUnchanged,
    },
    rejections,
    durationMs,
    quotaCost,
    errorCode: null,
  }
}
