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

import {
  buildItemRequest,
  buildPopularRequest,
  FILM_SHOW_RATINGS_ITEM_ENDPOINT,
  type FilmShowRatingsPopularType,
} from '@screena/film-show-ratings-client'
import { hashPayload, isCircuitOpenError, statusOf } from '@screena/rapidapi-core'
import { computeRatingStaleAfter } from '@screena/schemas'

import type {
  CachePort,
  EntityCandidateSelectPort,
  EntityLookupPort,
  ExternalRatingsPort,
  SyncLogPort,
  SyncStatus,
} from '../ports.js'
import { mapItemPayload, mapPopularPayload } from './mapping.js'
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
        // Janela de re-sync da politica versionada da FONTE (nunca do provider
        // tecnico). `null` quando a fonte nao tem politica declarada.
        staleAfter: computeRatingStaleAfter(draft.ratingSource, fetchedAt),
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

// ===========================================================================
// Item enrichment (`/item/?id=<IMDb>`) — fluxo ATUAL do worker.
//
// O plano Pro NAO libera `/popular/` (403). Em vez de listar populares, o worker
// enriquece entidades locais JA existentes, uma por vez, via `/item/?id=<IMDb>`.
// A entidade e resolvida por identificador inequivoco (IMDb id explicito, ou os
// candidatos locais selecionados por tipo) — NUNCA por titulo/ano.
// ===========================================================================

/** Limite conservador de candidatos locais quando `--limit` nao e informado. */
export const DEFAULT_ITEM_CANDIDATE_LIMIT = 20

/**
 * Falhas de rede/HTTP CONSECUTIVAS que interrompem o lote de candidatos.
 *
 * Sem isso, um upstream degradado (429 em rajada, 5xx sistemico) faz o worker
 * varrer TODOS os candidatos, cada um com os retries do core — "queimar quota em
 * loop". Ao 3o id seguido que falha, paramos e reportamos os ids nao consultados.
 * Um unico sucesso zera o contador: uma falha isolada no meio do lote nao aborta.
 */
export const MAX_CONSECUTIVE_ITEM_FAILURES = 3

/** Diagnostico SANITIZADO de uma falha de busca de item (nunca vaza a chave). */
export interface ItemFetchErrorInfo {
  /** Detalhe legivel para o relatorio: id + status/nome do erro, sem URL/chave. */
  readonly detail: string
  /** Status HTTP do provider quando disponivel (403/429/500...), senao `null`. */
  readonly httpStatus: number | null
  /** O erro sinaliza circuito aberto (fonte degradada pelo core)? */
  readonly circuitOpen: boolean
  /** Nome da classe do erro (`RapidApiHttpError`, `Error`...), nunca a mensagem crua. */
  readonly errorCode: string
}

/**
 * Trecho do corpo de um erro HTTP, seguro para o relatorio: sem URL, sem host,
 * colapsado e limitado. O corpo do `RapidApiHttpError` ja vem truncado e NUNCA
 * contem a chave (ela viaja so em header); mas o corpo e da RESPOSTA do upstream
 * (controlado por terceiros) e pode citar o proprio host — por isso redigimos
 * URLs completas, referencias protocol-relative (`//host`) e hostnames crus
 * (`sub.dominio.tld`) antes de limitar o tamanho. Assim o relatorio nunca carrega
 * URL/host, so a mensagem util.
 */
export function sanitizeErrorBody(error: unknown): string | null {
  const raw = (error as { body?: unknown }).body
  if (typeof raw !== 'string') return null
  const cleaned = raw
    // URL completa (http/https). Vem primeiro: consome o `//host` embutido.
    .replace(/https?:\/\/\S+/gi, '[url]')
    // Referencia protocol-relative: `//host/...` sem esquema.
    .replace(/\/\/[^\s"'<>]+/g, '[url]')
    // Hostname/dominio cru (`film-show-ratings.p.rapidapi.com[/path]`). O TLD
    // exige letras, entao numeros de versao/nota (`9.5`, `1.2.3`) sobrevivem.
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b(?:\/\S*)?/gi, '[host]')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '') return null
  return cleaned.length > 140 ? `${cleaned.slice(0, 140)}…` : cleaned
}

/**
 * Nome de classe do erro sem o prefixo tecnico do provider (`RapidApi`): o
 * relatorio ganha um rotulo util (`HttpError`, `CircuitOpenError`) sem repetir o
 * marcador do fornecedor no artefato. `Error` e demais nomes ficam intactos.
 */
export function normalizeErrorCode(name: string): string {
  return name.startsWith('RapidApi') ? name.slice('RapidApi'.length) : name
}

/**
 * Descreve uma falha de `fetchItem` para o relatorio, expondo o STATUS HTTP
 * (403/429/500...) em vez de esconde-lo atras de um `RapidApiHttpError` opaco.
 *
 * PURO e sem segredo: usa so `error.name`, o status numerico, a flag `permanent`
 * e um trecho do corpo ja sanitizado. Nunca cita a URL, o host ou a chave.
 */
export function describeItemFetchError(error: unknown, id: string): ItemFetchErrorInfo {
  const errorCode = normalizeErrorCode(error instanceof Error ? error.name : 'UnknownError')

  if (isCircuitOpenError(error)) {
    return {
      detail: `id ${id}: circuito do provider aberto (fonte degradada); consulta suspensa.`,
      httpStatus: null,
      circuitOpen: true,
      errorCode,
    }
  }

  const httpStatus = statusOf(error)
  if (httpStatus !== null) {
    const permanent = (error as { permanent?: unknown }).permanent === true
    const kind = permanent ? 'permanente (nao retentavel)' : 'transitorio'
    const body = sanitizeErrorBody(error)
    return {
      detail: `id ${id}: HTTP ${httpStatus} ${kind} (${errorCode})${body !== null ? ` — ${body}` : ''}.`,
      httpStatus,
      circuitOpen: false,
      errorCode,
    }
  }

  // Rede/timeout/abort: sem status. Mantem a mensagem historica (id + nome).
  return {
    detail: `id ${id}: falha de rede/HTTP (${errorCode}).`,
    httpStatus: null,
    circuitOpen: false,
    errorCode,
  }
}

/** Dependencias injetadas do run de item enrichment. */
export interface RatingsItemRunDeps {
  /** Busca o payload cru de `/item/?id=<id>`. Lanca em falha de rede/HTTP. */
  readonly fetchItem: (id: string) => Promise<unknown>
  readonly cache: CachePort
  readonly syncLog: SyncLogPort
  readonly entities: EntityLookupPort
  readonly candidates: EntityCandidateSelectPort
  readonly ratings: ExternalRatingsPort
  readonly now: () => Date
  /** Requisicoes gastas (para `quota_cost`). */
  readonly requestCount: () => number
}

/** Opcoes do run de item enrichment. */
export interface RatingsItemRunOptions {
  readonly apply: boolean
  readonly sample: boolean
  /** `film`/`show`; obrigatorio no modo candidatos e sob `--apply`. */
  readonly type: FilmShowRatingsPopularType | null
  /** IMDb id explicito; `null` = modo candidatos (seleciona locais por tipo). */
  readonly id: string | null
  readonly limit: number | null
  readonly providerApi: string
  readonly cacheTtlMs: number
}

/** Resultado de UM id consultado (alimenta sample e relatorio). */
export interface RatingsItemResult {
  readonly id: string
  readonly entityType: RatingsEntityType | null
  /** A busca de rede teve sucesso? */
  readonly ok: boolean
  /**
   * Status HTTP quando a falha foi um erro HTTP do provider (ex.: 403/429/500);
   * `null` quando a busca teve sucesso, foi erro de rede/timeout, ou circuito
   * aberto. Nunca vaza a chave — e so o codigo numerico.
   */
  readonly httpStatus: number | null
  /** A forma do payload de `/item/` foi reconhecida? */
  readonly recognized: boolean
  readonly payloadHash: string | null
  /** Payload CRU (o bin sanitiza antes de escrever o sample). */
  readonly rawPayload: unknown
  readonly ratingsRecognized: number
  readonly ratingsWritten: number
  readonly ratingsCreated: number
  readonly ratingsUpdated: number
  readonly ratingsUnchanged: number
  /** Sob `--apply`: a entidade local foi resolvida? */
  readonly entityResolved: boolean
  readonly rejections: readonly RatingRejection[]
  readonly errorCode: string | null
}

/** Resultado do ciclo de item enrichment (alimenta o relatorio). */
export interface RatingsItemRunResult {
  readonly status: SyncStatus
  readonly endpoint: string
  readonly touchedNetwork: boolean
  /** Quantos ids foram efetivamente consultados nesta execucao. */
  readonly idsQueried: number
  /** Ids cuja busca de rede falhou. */
  readonly idsFailed: number
  /**
   * Ids que ficaram SEM consulta por interrupcao antecipada do lote (falhas
   * consecutivas ou circuito aberto) — protecao de quota, nao falha de rede.
   */
  readonly idsSkipped: number
  /** Ids (sob apply) com ratings reconhecidos porem SEM entidade local. */
  readonly idsWithoutEntity: number
  readonly items: readonly RatingsItemResult[]
  readonly counters: RatingsRunCounters
  readonly rejections: readonly RatingRejection[]
  readonly durationMs: number
  readonly quotaCost: number
  readonly errorCode: string | null
}

/** Um id a consultar, ja com o tipo e (quando conhecido) a entidade local. */
interface ItemIdEntry {
  readonly id: string
  readonly entityType: RatingsEntityType | null
  /** Id local ja conhecido (modo candidatos); `null` = resolver por IMDb. */
  readonly knownEntityId: string | null
}

/**
 * Executa um ciclo de ENRIQUECIMENTO por item (`/item/?id=<IMDb>`).
 *
 * Dry-run PURO (sem `--sample`/`--apply`) nao toca rede nem DB: devolve o plano
 * (endpoint que SERIA chamado) com `status: 'empty'` e zero quota.
 *
 * Sob rede: monta a lista de ids (o `--id` explicito, ou os candidatos locais
 * por tipo/limite), e para cada id busca o payload, grava `api_cache`, reconhece
 * via `mapItemPayload` e — sob `--apply` — grava `external_ratings` para a
 * entidade local resolvida. A falha de UM id nao aborta o ciclo (registra e
 * segue). Um unico `api_sync_logs` e escrito por ciclo.
 */
export async function runFilmShowRatingsItemSync(
  options: RatingsItemRunOptions,
  deps: RatingsItemRunDeps,
): Promise<RatingsItemRunResult> {
  const startedAt = deps.now().getTime()
  const endpoint = FILM_SHOW_RATINGS_ITEM_ENDPOINT
  const touchesNetwork = options.apply || options.sample

  if (!touchesNetwork) {
    return {
      status: 'empty',
      endpoint,
      touchedNetwork: false,
      idsQueried: 0,
      idsFailed: 0,
      idsSkipped: 0,
      idsWithoutEntity: 0,
      items: [],
      counters: EMPTY_COUNTERS,
      rejections: [],
      durationMs: deps.now().getTime() - startedAt,
      quotaCost: 0,
      errorCode: null,
    }
  }

  // Sem `--type` nao ha como saber `movie` vs `tv`. O parser ja exige `--type`
  // sob `--apply` e no modo candidatos; aqui a garantia e ESTRUTURAL (sem cast).
  const applyEntityType: RatingsEntityType | null =
    options.type === null ? null : entityTypeOf(options.type)

  const rejections: RatingRejection[] = []
  let entries: readonly ItemIdEntry[] = []

  if (options.id !== null) {
    entries = [{ id: options.id, entityType: applyEntityType, knownEntityId: null }]
  } else if (applyEntityType !== null) {
    const limit = options.limit ?? DEFAULT_ITEM_CANDIDATE_LIMIT
    const selected = await deps.candidates.selectByType(applyEntityType, limit)
    entries = selected.map((candidate) => ({
      id: candidate.imdbId,
      entityType: candidate.entityType,
      knownEntityId: candidate.entityId,
    }))
  } else {
    // Defensivo (o parser impede via CLI): modo candidatos exige tipo.
    rejections.push({
      reason: 'entity-not-found',
      detail: 'modo candidatos exige --type=film|show; nada consultado.',
    })
  }

  const itemResults: RatingsItemResult[] = []
  let idsFailed = 0
  let idsWithoutEntity = 0
  let ratingsRecognized = 0
  let ratingsWritten = 0
  let ratingsCreated = 0
  let ratingsUpdated = 0
  let ratingsUnchanged = 0
  // Falhas de rede/HTTP em sequencia (zeradas por qualquer sucesso). No teto,
  // interrompem o lote para NAO queimar quota varrendo um upstream degradado.
  let consecutiveFailures = 0

  for (const [index, entry] of entries.entries()) {
    const request = buildItemRequest(entry.id)

    let payload: unknown
    try {
      payload = await deps.fetchItem(entry.id)
    } catch (error) {
      // Uma falha isolada NAO aborta o lote. O detalhe expoe o STATUS HTTP
      // (403/429/500...) em vez de esconde-lo atras de um erro opaco — sempre
      // sem a chave, a URL ou o host. Ver `describeItemFetchError`.
      const info = describeItemFetchError(error, entry.id)
      const rejection: RatingRejection = { reason: 'item-fetch-failed', detail: info.detail }
      rejections.push(rejection)
      idsFailed += 1
      consecutiveFailures += 1
      itemResults.push({
        id: entry.id,
        entityType: entry.entityType,
        ok: false,
        httpStatus: info.httpStatus,
        recognized: false,
        payloadHash: null,
        rawPayload: null,
        ratingsRecognized: 0,
        ratingsWritten: 0,
        ratingsCreated: 0,
        ratingsUpdated: 0,
        ratingsUnchanged: 0,
        entityResolved: false,
        rejections: [rejection],
        errorCode: info.errorCode,
      })

      // Protecao de quota: circuito aberto, ou falhas consecutivas no teto,
      // interrompem o lote. Os ids restantes ficam sem consulta — nao ha nada a
      // ganhar em varrer um upstream degradado com os retries do core em cima.
      const remaining = entries.length - (index + 1)
      const abort = info.circuitOpen || consecutiveFailures >= MAX_CONSECUTIVE_ITEM_FAILURES
      if (abort && remaining > 0) {
        rejections.push({
          reason: 'batch-aborted',
          detail: info.circuitOpen
            ? `circuito do provider aberto apos ${idsFailed} falha(s); ${remaining} id(s) nao consultado(s) (protecao de quota).`
            : `${consecutiveFailures} falhas consecutivas de rede/HTTP; ${remaining} id(s) nao consultado(s) (protecao de quota).`,
        })
        break
      }
      continue
    }

    // Sucesso de rede: zera a sequencia de falhas (uma falha isolada anterior
    // nunca acumula para o teto de abort).
    consecutiveFailures = 0
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

    const mapping = mapItemPayload(payload, options.providerApi)
    const itemRejections: RatingRejection[] = [...mapping.rejections]
    if (mapping.item !== null) itemRejections.push(...mapping.item.rejections)

    const drafts = mapping.item?.ratings ?? []
    ratingsRecognized += drafts.length

    let itemWritten = 0
    let itemCreated = 0
    let itemUpdated = 0
    let itemUnchanged = 0
    let entityResolved = false

    const canApply =
      options.apply && entry.entityType !== null && mapping.item !== null && drafts.length > 0

    if (canApply && entry.entityType !== null && mapping.item !== null) {
      const entityType = entry.entityType
      const entityId =
        entry.knownEntityId !== null
          ? // Modo candidatos: a entidade ja veio da selecao local.
            entry.knownEntityId
          : // Modo `--id`: resolve pelo IMDb id consultado (fallback TMDB do payload).
            await resolveEntity(deps.entities, entityType, {
              imdbId: entry.id,
              tmdbId: mapping.item.ref?.tmdbId ?? null,
            })

      if (entityId === null) {
        idsWithoutEntity += 1
        itemRejections.push({
          reason: 'entity-not-found',
          detail: `id ${entry.id}: nenhuma entidade ${entityType} local.`,
        })
      } else {
        entityResolved = true
        for (const draft of drafts) {
          const row: ExternalRatingRow = {
            ...draft,
            entityType,
            entityId,
            providerApi: options.providerApi,
            providerPayloadHash: payloadHash,
            fetchedAt,
            staleAfter: computeRatingStaleAfter(draft.ratingSource, fetchedAt),
          }
          const outcome = await deps.ratings.upsert(row)
          if (outcome.created) {
            itemCreated += 1
            itemWritten += 1
          } else if (outcome.changed) {
            itemUpdated += 1
            itemWritten += 1
          } else {
            itemUnchanged += 1
          }
        }
      }
    }

    ratingsWritten += itemWritten
    ratingsCreated += itemCreated
    ratingsUpdated += itemUpdated
    ratingsUnchanged += itemUnchanged
    rejections.push(...itemRejections)

    itemResults.push({
      id: entry.id,
      entityType: entry.entityType,
      ok: true,
      httpStatus: null,
      recognized: mapping.recognized,
      payloadHash,
      rawPayload: payload,
      ratingsRecognized: drafts.length,
      ratingsWritten: itemWritten,
      ratingsCreated: itemCreated,
      ratingsUpdated: itemUpdated,
      ratingsUnchanged: itemUnchanged,
      entityResolved,
      rejections: itemRejections,
      errorCode: null,
    })
  }

  // `idsQueried` = ids EFETIVAMENTE consultados (um resultado por tentativa).
  // Quando o lote e interrompido cedo, e menor que `entries.length` — a
  // diferenca sao os ids pulados por protecao de quota.
  const idsQueried = itemResults.length
  const idsSkipped = entries.length - itemResults.length
  const durationMs = deps.now().getTime() - startedAt
  const quotaCost = deps.requestCount()

  // `empty` quando nada foi consultado; `failed` quando TODOS os ids consultados
  // falharam; `partial` quando houve alguma recusa/falha (inclui lote abortado);
  // `success` caso contrario.
  let status: SyncStatus
  if (idsQueried === 0) status = 'empty'
  else if (idsFailed === idsQueried) status = 'failed'
  else if (rejections.length > 0) status = 'partial'
  else status = 'success'

  // Um unico log por ciclo (nunca um por id). `payload_hash` so faz sentido
  // quando exatamente um id foi consultado.
  await deps.syncLog.write({
    endpoint,
    status,
    itemsProcessed: idsQueried,
    itemsCreated: ratingsCreated,
    itemsUpdated: ratingsUpdated,
    durationMs,
    quotaCost,
    payloadHash: itemResults.length === 1 ? (itemResults[0]?.payloadHash ?? null) : null,
  })

  return {
    status,
    endpoint,
    touchedNetwork: true,
    idsQueried,
    idsFailed,
    idsSkipped,
    idsWithoutEntity,
    items: itemResults,
    counters: {
      itemsSeen: idsQueried,
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
