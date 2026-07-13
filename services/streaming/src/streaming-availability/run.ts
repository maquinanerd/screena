/**
 * run.ts — Orquestracao PURA do worker de disponibilidade. Sem Prisma, sem rede.
 *
 * Fluxo por entidade: monta a requisicao -> busca (so com `--sample`/`--apply`)
 * -> grava `api_cache` -> reconhece o payload -> em `--apply`, faz o REPLACE
 * TRANSACIONAL do snapshot `(entity, country, provider_api)`.
 *
 * Uma linha-resumo em `api_sync_logs` fecha o ciclo — sempre, inclusive em falha.
 */

import { buildShowRequest } from '@screena/streaming-availability-client'
import { hashPayload, statusOf } from '@screena/rapidapi-core'

import type { CachePort, EntitySelectPort, SyncLogPort, SyncStatus, WatchStorePort } from '../ports.js'
import { mapShowPayload } from './mapping.js'
import type { OfferRejection, SelectedEntity, StreamingEntityType } from './types.js'

/** Endpoint logico do ciclo (o path real e `/shows/{imdbId}` por entidade). */
export const STREAMING_SYNC_ENDPOINT = '/shows/{id}'

/** HTTP status de "titulo ausente no upstream" — nao e falha, e `not_found`. */
const HTTP_NOT_FOUND = 404

/** Janela de frescor: a documentacao indica atualizacao diaria. */
export const STREAMING_STALE_AFTER_MS = 86_400_000

/** Dependencias injetadas. */
export interface StreamingRunDeps {
  /**
   * Busca o payload de `/shows/{imdbId}`. Recebe o IMDb id real da entidade
   * (a chave da chamada nesta fase). Lanca em falha de rede/HTTP; um
   * `RapidApiHttpError` com `status === 404` e tratado como `not_found`.
   */
  readonly fetchShow: (imdbId: string) => Promise<unknown>
  readonly cache: CachePort
  readonly syncLog: SyncLogPort
  readonly entities: EntitySelectPort
  readonly watch: WatchStorePort
  readonly now: () => Date
  readonly requestCount: () => number
}

/** Opcoes do run. */
export interface StreamingRunOptions {
  readonly apply: boolean
  readonly sample: boolean
  readonly kind: StreamingEntityType
  readonly country: string
  readonly limit: number | null
  readonly tmdbId: number | null
  readonly imdbId: string | null
  readonly cacheTtlMs: number
}

/** Contagens do ciclo. */
export interface StreamingRunCounters {
  readonly entitiesSelected: number
  /** Selecionadas SEM IMDb id real: nao consultadas (nao ha chave de chamada). */
  readonly entitiesWithoutImdb: number
  readonly entitiesFetched: number
  /** Consultadas mas ausentes no upstream (HTTP 404): nao e falha. */
  readonly entitiesNotFound: number
  readonly offersRecognized: number
  readonly offersWritten: number
  readonly offersDeleted: number
  readonly entitiesFailed: number
}

/** Resultado do ciclo. */
export interface StreamingRunResult {
  readonly status: SyncStatus
  readonly endpoint: string
  readonly touchedNetwork: boolean
  readonly counters: StreamingRunCounters
  readonly rejections: readonly OfferRejection[]
  /** Primeiro payload cru recebido (o bin sanitiza antes de virar sample). */
  readonly firstRawPayload: unknown
  readonly durationMs: number
  readonly quotaCost: number
  readonly errorCode: string | null
  /** Plano do dry-run: o que SERIA chamado. */
  readonly planned: readonly string[]
}

const DEFAULT_LIMIT = 5

/** Seleciona as entidades-alvo (id explicito tem precedencia sobre a varredura). */
async function selectEntities(
  options: StreamingRunOptions,
  entities: EntitySelectPort,
): Promise<readonly SelectedEntity[]> {
  if (options.tmdbId !== null) {
    const found = await entities.findByTmdbId(options.kind, options.tmdbId)
    return found === null ? [] : [found]
  }
  if (options.imdbId !== null) {
    const found = await entities.findByImdbId(options.kind, options.imdbId)
    return found === null ? [] : [found]
  }
  return entities.select(options.kind, options.limit ?? DEFAULT_LIMIT)
}

/** Uma entidade com IMDb id real (a unica que pode ser consultada nesta fase). */
type EntityWithImdb = SelectedEntity & { readonly imdbId: string }

/** A entidade tem IMDb id real (nao-nulo, nao-vazio)? */
function hasImdbId(entity: SelectedEntity): entity is EntityWithImdb {
  return entity.imdbId !== null && entity.imdbId.trim() !== ''
}

/**
 * Id usado no path de `/shows/{id}`: o **IMDb id real** da entidade.
 *
 * Nesta fase a chave da chamada e o IMDb id vindo de `entity_external_ids`, NAO
 * o TMDB id nem o titulo. Entidades sem IMDb id nao sao consultadas (o run as
 * conta em `entitiesWithoutImdb`). Retorna `null` quando a entidade nao tem id.
 */
export function showIdFor(entity: SelectedEntity): string | null {
  return hasImdbId(entity) ? entity.imdbId : null
}

/** Executa um ciclo do worker. */
export async function runStreamingAvailabilitySync(
  options: StreamingRunOptions,
  deps: StreamingRunDeps,
): Promise<StreamingRunResult> {
  const startedAt = deps.now().getTime()
  const touchesNetwork = options.apply || options.sample

  // Uma falha aqui (DB indisponivel) PROPAGA: o bin a captura e registra uma
  // linha `aborted` em `api_sync_logs`. Engolir o erro aqui produziria um ciclo
  // sem log — proibido pela regra "todo sync externo gera log".
  const selected: readonly SelectedEntity[] = await selectEntities(options, deps.entities)

  // So consultamos quem tem IMDb id real: e a chave da chamada `/shows/{imdbId}`.
  // As demais nao viram chamada (nao inventamos id) e sao contadas no relatorio.
  const targets: readonly EntityWithImdb[] = selected.filter(hasImdbId)
  const entitiesWithoutImdb = selected.length - targets.length

  const planned = targets.map(
    (entity) => buildShowRequest({ showId: entity.imdbId }).endpoint,
  )

  if (!touchesNetwork) {
    return {
      status: 'empty',
      endpoint: STREAMING_SYNC_ENDPOINT,
      touchedNetwork: false,
      counters: {
        ...emptyCounters(),
        entitiesSelected: selected.length,
        entitiesWithoutImdb,
      },
      rejections: [],
      firstRawPayload: null,
      durationMs: deps.now().getTime() - startedAt,
      quotaCost: 0,
      errorCode: null,
      planned,
    }
  }

  const rejections: OfferRejection[] = []
  let entitiesFetched = 0
  let entitiesFailed = 0
  let entitiesNotFound = 0
  let offersRecognized = 0
  let offersWritten = 0
  let offersDeleted = 0
  let firstRawPayload: unknown = null
  let firstPayloadHash: string | null = null

  for (const entity of targets) {
    const request = buildShowRequest({ showId: entity.imdbId })

    let payload: unknown
    try {
      payload = await deps.fetchShow(entity.imdbId)
    } catch (error) {
      // 404 = titulo ausente no upstream: NAO e falha e NAO derruba o lote.
      // Conta como `not_found` e segue para a proxima entidade.
      if (statusOf(error) === HTTP_NOT_FOUND) {
        entitiesNotFound += 1
        continue
      }
      // Qualquer outra falha (rede/timeout/5xx/circuito) tambem nao derruba o
      // ciclo: conta como falha e segue.
      entitiesFailed += 1
      continue
    }

    entitiesFetched += 1
    const fetchedAt = deps.now()
    const payloadHash = hashPayload(payload)
    if (firstRawPayload === null) {
      firstRawPayload = payload
      firstPayloadHash = payloadHash
    }

    await deps.cache.write({
      endpoint: request.endpoint,
      requestKey: request.cacheKey.requestKey,
      paramsHash: request.cacheKey.paramsHash,
      payload,
      payloadHash,
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + options.cacheTtlMs),
    })

    const mapping = mapShowPayload(payload, entity, options.country)
    rejections.push(...mapping.rejections)
    offersRecognized += mapping.offers.length

    if (!options.apply) continue

    // NAO reescreve o snapshot quando o payload nao foi RECONHECIDO (corpo nao
    // e objeto, showType desconhecido, identidade trocada, ou `streamingOptions`
    // ausente/invalido). Nesses casos nao aprendemos nada sobre a entidade, e um
    // replace com lista vazia APAGARIA ofertas boas ja gravadas.
    //
    // Um `recognized: true` com zero ofertas e diferente: `streamingOptions`
    // existe e o pais simplesmente nao tem oferta ("saiu do catalogo") — ai o
    // replace vazio e a atualizacao correta.
    if (!mapping.recognized) continue

    // Replace transacional do snapshot deste provider/entidade/pais.
    // Ofertas de OUTROS provider_api (ex.: seed demo) permanecem intactas.
    const outcome = await deps.watch.replaceSnapshot({
      entityType: entity.entityType,
      entityId: entity.entityId,
      countryCode: options.country.toUpperCase(),
      offers: mapping.offers,
      fetchedAt,
      staleAfter: new Date(fetchedAt.getTime() + STREAMING_STALE_AFTER_MS),
    })
    offersWritten += outcome.created
    offersDeleted += outcome.deleted
  }

  const durationMs = deps.now().getTime() - startedAt
  const quotaCost = deps.requestCount()

  // Precedencia do status:
  //  - nada consultado: `empty` se nem havia entidade; `partial` se havia
  //    entidades mas nenhuma tinha IMDb id (skip nao e sucesso nem falha);
  //  - erros reais dominaram e nada foi buscado: `failed`;
  //  - houve qualquer skip/falha/404/recusa: `partial`;
  //  - tudo limpo: `success`.
  let status: SyncStatus
  if (targets.length === 0) {
    status = selected.length === 0 ? 'empty' : 'partial'
  } else if (entitiesFetched === 0 && entitiesFailed > 0) {
    status = 'failed'
  } else if (
    entitiesFailed > 0 ||
    entitiesNotFound > 0 ||
    entitiesWithoutImdb > 0 ||
    rejections.length > 0
  ) {
    status = 'partial'
  } else {
    status = 'success'
  }

  await deps.syncLog.write({
    endpoint: STREAMING_SYNC_ENDPOINT,
    status,
    itemsProcessed: entitiesFetched,
    itemsCreated: offersWritten,
    itemsUpdated: 0,
    durationMs,
    quotaCost,
    payloadHash: firstPayloadHash,
  })

  return {
    status,
    endpoint: STREAMING_SYNC_ENDPOINT,
    touchedNetwork: true,
    counters: {
      entitiesSelected: selected.length,
      entitiesWithoutImdb,
      entitiesFetched,
      entitiesNotFound,
      offersRecognized,
      offersWritten,
      offersDeleted,
      entitiesFailed,
    },
    rejections,
    firstRawPayload,
    durationMs,
    quotaCost,
    errorCode: null,
    planned,
  }
}

function emptyCounters(): StreamingRunCounters {
  return {
    entitiesSelected: 0,
    entitiesWithoutImdb: 0,
    entitiesFetched: 0,
    entitiesNotFound: 0,
    offersRecognized: 0,
    offersWritten: 0,
    offersDeleted: 0,
    entitiesFailed: 0,
  }
}
