/**
 * run.ts — Orquestracao PURA do worker de ratings OMDb.
 *
 * Depende so de portas (`CachePort`, `SyncLogPort`, `EntityLookupPort`,
 * `StaleEntityCandidateSelectPort`, `ExternalRatingsPort`) e de uma funcao
 * `fetchTitle` injetada. Nenhum Prisma, nenhum `fetch` real, nenhum relogio
 * real. Testavel com fakes.
 *
 * ESTE ARQUIVO NAO REESCREVE O PIPELINE — ele troca o PROVEDOR. As garantias do
 * adapter anterior sao mantidas uma a uma:
 *  - `--dry-run` (default) NUNCA grava `external_ratings` e nao toca a rede;
 *  - toda execucao que TOCA a rede grava `api_cache` e `api_sync_logs`
 *    ("nenhuma ingestao silenciosa");
 *  - `display_allowed=false` e `license_status='unknown'` continuam decididos no
 *    adapter de escrita (invariante 6) — o core nunca os afrouxa;
 *  - protecao de cota: 3 falhas CONSECUTIVAS (ou circuito aberto) interrompem o
 *    lote e o relatorio diz quantos ids ficaram sem consulta.
 *
 * O QUE E NOVO em relacao ao adapter anterior:
 *  - um payload rende ATE TRES linhas (uma por fonte editorial), nao uma;
 *  - a selecao de candidatos pula quem foi consultado recentemente
 *    (`omdbRefreshCutoff`), porque o plano gratuito tem teto DIARIO;
 *  - `Response: "False"` com HTTP 200 e recusa explicita, nunca "0 notas".
 */

import { buildOmdbByImdbIdRequest, OMDB_ENDPOINT } from '@screena/omdb-client'
import { hashPayload } from '@screena/rapidapi-core'
import { checkOmdbBudget, shouldRequeue, type OmdbConsumer } from '@screena/config'
import { computeRatingStaleAfter } from '@screena/schemas'

import {
  describeItemFetchError,
  MAX_CONSECUTIVE_ITEM_FAILURES,
  type ItemFetchErrorInfo,
} from '../film-show-ratings/run.js'
import type {
  CachePort,
  EntityLookupPort,
  ExternalRatingsPort,
  StaleEntityCandidateSelectPort,
  SyncLogPort,
  SyncStatus,
} from '../ports.js'
import { omdbRefreshCutoff, omdbRefreshWindowHours } from './freshness.js'
import { mapOmdbPayload } from './mapping.js'
import type { ExternalRatingRow, OmdbRejection, RatingsEntityType } from './types.js'

/** Limite conservador de candidatos quando `--limit` nao e informado. */
export const DEFAULT_OMDB_CANDIDATE_LIMIT = 20

export { MAX_CONSECUTIVE_ITEM_FAILURES }

/** Dependencias injetadas do run. */
export interface OmdbRunDeps {
  /** Busca o payload cru de `GET /?i=<imdbID>`. Lanca em falha de rede/HTTP. */
  readonly fetchTitle: (imdbId: string) => Promise<unknown>
  readonly cache: CachePort
  readonly syncLog: SyncLogPort
  readonly entities: EntityLookupPort
  readonly candidates: StaleEntityCandidateSelectPort
  readonly ratings: ExternalRatingsPort
  readonly now: () => Date
  /** Requisicoes gastas (para `quota_cost`). */
  readonly requestCount: () => number
  /**
   * O SALDO DE COTA do dia. `undefined` desliga a checagem.
   *
   * ATE 2026-08-21 ESTE PORTO NAO EXISTIA, e o efeito era exatamente o que o
   * dono descreveu: `checkOmdbBudget` estava escrito, testado e NUNCA CHAMADO
   * por nada em producao. A fila de fundo gastava a cota inteira sem pedir
   * licenca, e quando ela acabava era o LEITOR — quem esta esperando na tela —
   * que ficava sem resposta.
   *
   * `undefined` continua permitido para os testes e para `--id` avulso, onde o
   * operador pediu UM id nominalmente; producao injeta o porto real.
   */
  readonly budget?: OmdbBudgetPort
}

/** De onde sai o saldo de cota do dia. Uma leitura por ciclo, nunca por item. */
export interface OmdbBudgetPort {
  /** Requisicoes ja gastas hoje, por QUALQUER consumidor. */
  spentToday(): Promise<number>
}

/** Opcoes do run. */
export interface OmdbRunOptions {
  readonly apply: boolean
  readonly sample: boolean
  /** `movie`/`tv`; obrigatorio no modo candidatos e sob `--apply`. */
  readonly entityType: RatingsEntityType | null
  /** IMDb id explicito; `null` = modo candidatos. */
  readonly id: string | null
  readonly limit: number | null
  readonly providerApi: string
  readonly cacheTtlMs: number
  /**
   * `true` ignora a janela de frescor e reconsulta mesmo quem foi visto ha
   * pouco. Existe para reprocessar apos mudanca de licenca/politica — nunca e o
   * default, porque queima cota.
   */
  readonly ignoreFreshness: boolean
  /**
   * Quem esta pedindo cota. `seed` (fila de fundo) cede a vez quando o saldo
   * entra na reserva do leitor; `on_demand` so e barrado quando o teto INTEIRO
   * acabou. Ver `checkOmdbBudget` em @screena/config.
   */
  readonly consumer?: OmdbConsumer
}

/** Contagem de resultados. */
export interface OmdbRunCounters {
  readonly itemsSeen: number
  readonly ratingsRecognized: number
  readonly ratingsWritten: number
  readonly ratingsCreated: number
  readonly ratingsUpdated: number
  /** Linhas ja identicas: nada reescrito, `updated_at` intacto. */
  readonly ratingsUnchanged: number
}

/** Resultado de UM id consultado. */
export interface OmdbItemResult {
  readonly id: string
  readonly entityType: RatingsEntityType | null
  readonly ok: boolean
  readonly httpStatus: number | null
  readonly recognized: boolean
  readonly payloadHash: string | null
  /** Payload CRU (o bin sanitiza antes de escrever o sample). */
  readonly rawPayload: unknown
  /** Fontes editoriais efetivamente reconhecidas neste payload. */
  readonly sources: readonly string[]
  readonly ratingsRecognized: number
  readonly ratingsWritten: number
  readonly ratingsCreated: number
  readonly ratingsUpdated: number
  readonly ratingsUnchanged: number
  readonly entityResolved: boolean
  readonly rejections: readonly OmdbRejection[]
  readonly errorCode: string | null
}

/** Resultado do ciclo (alimenta o relatorio). */
export interface OmdbRunResult {
  readonly status: SyncStatus
  readonly endpoint: string
  readonly touchedNetwork: boolean
  readonly idsQueried: number
  readonly idsFailed: number
  /** Ids sem consulta por interrupcao antecipada (protecao de cota). */
  readonly idsSkipped: number
  /**
   * Ids barrados pelo TETO DIARIO da OMDb. Distinto de `idsSkipped`: aquele e
   * "o lote parou"; este e "havia trabalho e a cota acabou". Os dois pedem acoes
   * diferentes, e colapsa-los esconderia o unico numero que diz ao dono que
   * precisa de plano pago ou de fila menor.
   */
  readonly idsDeniedByQuota: number
  /** Entidades puladas por coleta recente (frescor) — nao e falha. */
  readonly idsSkippedFresh: number
  readonly idsWithoutEntity: number
  readonly items: readonly OmdbItemResult[]
  readonly counters: OmdbRunCounters
  readonly rejections: readonly OmdbRejection[]
  readonly durationMs: number
  readonly quotaCost: number
  /** Janela de frescor aplicada, em horas; `null` quando desligada. */
  readonly refreshWindowHours: number | null
  readonly errorCode: string | null
}

const EMPTY_COUNTERS: OmdbRunCounters = {
  itemsSeen: 0,
  ratingsRecognized: 0,
  ratingsWritten: 0,
  ratingsCreated: 0,
  ratingsUpdated: 0,
  ratingsUnchanged: 0,
}

/** Um id a consultar, com o tipo e (quando conhecido) a entidade local. */
interface OmdbIdEntry {
  readonly id: string
  readonly entityType: RatingsEntityType | null
  /** Id local ja conhecido (modo candidatos); `null` = resolver por IMDb. */
  readonly knownEntityId: string | null
}

/**
 * Executa um ciclo do worker OMDb.
 *
 * Dry-run PURO (sem `--sample`/`--apply`) nao toca rede nem DB: devolve o plano
 * (endpoint que SERIA chamado) com `status: 'empty'` e zero cota.
 */
export async function runOmdbRatingsSync(
  options: OmdbRunOptions,
  deps: OmdbRunDeps,
): Promise<OmdbRunResult> {
  const startedAt = deps.now().getTime()
  const endpoint = OMDB_ENDPOINT
  const touchesNetwork = options.apply || options.sample
  const refreshWindowHours = options.ignoreFreshness ? null : omdbRefreshWindowHours()

  if (!touchesNetwork) {
    return {
      status: 'empty',
      endpoint,
      touchedNetwork: false,
      idsQueried: 0,
      idsFailed: 0,
      idsSkipped: 0,
      idsDeniedByQuota: 0,
      idsSkippedFresh: 0,
      idsWithoutEntity: 0,
      items: [],
      counters: EMPTY_COUNTERS,
      rejections: [],
      durationMs: deps.now().getTime() - startedAt,
      quotaCost: 0,
      refreshWindowHours,
      errorCode: null,
    }
  }

  const rejections: OmdbRejection[] = []
  let entries: readonly OmdbIdEntry[] = []
  let idsSkippedFresh = 0

  if (options.id !== null) {
    // `--id` explicito ignora frescor de proposito: o operador pediu ESTE id.
    entries = [{ id: options.id, entityType: options.entityType, knownEntityId: null }]
  } else if (options.entityType !== null) {
    const limit = options.limit ?? DEFAULT_OMDB_CANDIDATE_LIMIT
    const cutoff = options.ignoreFreshness ? null : omdbRefreshCutoff(deps.now())
    const selection = await deps.candidates.selectStaleByType({
      entityType: options.entityType,
      limit,
      providerApi: options.providerApi,
      cutoff,
    })
    idsSkippedFresh = selection.skippedFresh
    entries = selection.candidates.map((candidate) => ({
      id: candidate.imdbId,
      entityType: candidate.entityType,
      knownEntityId: candidate.entityId,
    }))
  } else {
    // Defensivo (o parser impede via CLI): modo candidatos exige tipo.
    rejections.push({
      reason: 'entity-not-found',
      detail: 'modo candidatos exige --type=movie|tv; nada consultado.',
    })
  }

  const itemResults: OmdbItemResult[] = []
  let idsFailed = 0
  let idsWithoutEntity = 0
  let ratingsRecognized = 0
  let ratingsWritten = 0
  let ratingsCreated = 0
  let ratingsUpdated = 0
  let ratingsUnchanged = 0
  let consecutiveFailures = 0
  let idsDeniedByQuota = 0

  /**
   * O SALDO DO DIA, lido UMA vez e decrementado localmente.
   *
   * Uma leitura por item multiplicaria consultas ao banco por nada: dentro do
   * lote, o unico consumidor que gasta e este. O decremento local mantem o
   * veredito correto item a item sem reler.
   *
   * `null` = sem porto injetado (teste/`--id` avulso): a checagem nao roda. Isso
   * NAO e um bypass de politica — e a ausencia deliberada dela onde nao ha o que
   * proteger.
   */
  const consumer: OmdbConsumer = options.consumer ?? 'seed'
  let spentToday: number | null = deps.budget === undefined ? null : await deps.budget.spentToday()

  for (const [index, entry] of entries.entries()) {
    if (spentToday !== null) {
      const verdict = checkOmdbBudget(consumer, { spentToday })
      if (!verdict.granted) {
        // O lote PARA aqui. Os ids restantes NAO viram linha nenhuma: eles
        // continuam stale e voltam a ser candidatos no proximo ciclo — e por
        // isso `shouldRequeue` e sempre true para uma negacao de cota.
        const remaining = entries.length - index
        idsDeniedByQuota += remaining
        rejections.push({
          reason: 'quota-denied',
          detail:
            `${verdict.detail}; ${remaining} id(s) devolvido(s) a fila ` +
            `(requeue=${String(shouldRequeue(verdict))}, consumidor=${consumer}). ` +
            'Nenhuma nota foi marcada como ausente: cota e fato sobre o DIA, nao sobre o titulo.',
        })
        break
      }
    }

    const request = buildOmdbByImdbIdRequest(entry.id)

    let payload: unknown
    try {
      // O saldo cai ANTES da chamada, e nao depois do sucesso: uma requisicao
      // que falha tambem foi emitida e tambem conta na cota do fornecedor.
      // Debitar so no sucesso deixaria um lote com muitas falhas estourar o teto
      // achando que ainda tinha saldo.
      if (spentToday !== null) spentToday += 1
      payload = await deps.fetchTitle(entry.id)
    } catch (error) {
      // Uma falha isolada NAO aborta o lote. O detalhe expoe o STATUS HTTP,
      // sempre sem a chave, a URL ou o host (`describeItemFetchError` e
      // compartilhado com o adapter anterior — a sanitizacao ja e provada la).
      const info: ItemFetchErrorInfo = describeItemFetchError(error, entry.id)
      const rejection: OmdbRejection = { reason: 'item-fetch-failed', detail: info.detail }
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
        sources: [],
        ratingsRecognized: 0,
        ratingsWritten: 0,
        ratingsCreated: 0,
        ratingsUpdated: 0,
        ratingsUnchanged: 0,
        entityResolved: false,
        rejections: [rejection],
        errorCode: info.errorCode,
      })

      const remaining = entries.length - (index + 1)
      const abort = info.circuitOpen || consecutiveFailures >= MAX_CONSECUTIVE_ITEM_FAILURES
      if (abort && remaining > 0) {
        rejections.push({
          reason: 'batch-aborted',
          detail: info.circuitOpen
            ? `circuito do provider aberto apos ${idsFailed} falha(s); ${remaining} id(s) nao consultado(s) (protecao de cota).`
            : `${consecutiveFailures} falhas consecutivas de rede/HTTP; ${remaining} id(s) nao consultado(s) (protecao de cota).`,
        })
        break
      }
      continue
    }

    // Sucesso de rede zera a sequencia: uma falha isolada nunca acumula.
    consecutiveFailures = 0
    const fetchedAt = deps.now()
    const payloadHash = hashPayload(payload)

    // O bruto vai para `api_cache` SEMPRE que houve rede (mesmo sem mapping, e
    // mesmo quando a OMDb respondeu Response=False: o erro dela tambem e um
    // fato auditavel).
    await deps.cache.write({
      endpoint: request.endpoint,
      requestKey: request.cacheKey.requestKey,
      paramsHash: request.cacheKey.paramsHash,
      payload,
      payloadHash,
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + options.cacheTtlMs),
    })

    const mapping = mapOmdbPayload(payload, options.providerApi)
    const itemRejections: OmdbRejection[] = [...mapping.rejections]
    const drafts = mapping.ratings
    ratingsRecognized += drafts.length

    let itemWritten = 0
    let itemCreated = 0
    let itemUpdated = 0
    let itemUnchanged = 0
    let entityResolved = false

    const canApply = options.apply && entry.entityType !== null && drafts.length > 0

    if (canApply && entry.entityType !== null) {
      const entityType = entry.entityType
      const entityId =
        entry.knownEntityId !== null
          ? // Modo candidatos: a entidade ja veio da selecao local.
            entry.knownEntityId
          : // Modo `--id`: resolve pelo IMDb id consultado. NUNCA por titulo/ano.
            (await deps.entities.findByImdbId(entityType, entry.id))?.entityId ?? null

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
            // Janela de re-sync da politica versionada da FONTE (nunca do
            // provider tecnico). `null` quando a fonte nao tem politica.
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
      sources: drafts.map((draft) => draft.ratingSource),
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

  const idsQueried = itemResults.length
  const idsSkipped = entries.length - itemResults.length
  const durationMs = deps.now().getTime() - startedAt
  const quotaCost = deps.requestCount()

  // `empty` quando nada foi consultado; `failed` quando TODOS os ids
  // consultados falharam; `partial` quando houve alguma recusa/falha;
  // `success` caso contrario.
  let status: SyncStatus
  if (idsQueried === 0 && idsDeniedByQuota > 0) {
    // Cota estourada com trabalho pendente NAO e "vazio": e um ciclo abortado.
    // `empty` diria ao operador que nao havia nada a fazer, que e o oposto.
    status = 'aborted'
  } else if (idsQueried === 0) status = 'empty'
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
    idsDeniedByQuota,
    idsSkippedFresh,
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
    refreshWindowHours,
    errorCode: null,
  }
}
