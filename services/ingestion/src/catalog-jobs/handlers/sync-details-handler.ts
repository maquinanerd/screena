/**
 * sync-details-handler.ts — `sync_details` (Backend A §7).
 *
 * Sincroniza o detalhe de UMA entidade e, quando pedido, enfileira as
 * dependencias (creditos, ids externos, midia, temporadas). O detalhe e a raiz:
 * sem ele promovido, nenhum job dependente tem entidade dona para escrever —
 * por isso as dependencias sao enfileiradas DEPOIS do upsert, e nunca quando o
 * proprio detalhe foi pulado.
 *
 * Idempotencia: o upsert e por chave natural (tmdb_id) e as chaves de
 * enfileiramento sao deterministicas — reexecutar o job nao duplica trabalho.
 */

import { CATALOG_METRIC_NAMES } from '../../metrics/index.js'
import type { CatalogJobContext, CatalogJobHandler } from '../handler.js'
import { buildIdempotencyKey } from '../idempotency.js'
import type { CatalogJobStorePort, EnqueueCatalogJobInput } from '../store-port.js'
import type { CatalogDetailSyncPort, SearchReindexPort } from './ports.js'
import type { DetailWatchOutcome } from '../../watch-providers/from-detail.js'
import { validateSyncDetailsInput, type SyncDetailsInput } from './schemas.js'
import { classifySafeError, throwIfAborted } from './support.js'

/** Resultado serializavel do `sync_details`. */
export interface SyncDetailsResult {
  readonly entityType: string
  readonly tmdbId: number
  readonly created: boolean
  readonly updated: boolean
  readonly unchanged: boolean
  readonly skipped: boolean
  readonly skipReason: string | null
  readonly enqueued: number
  readonly reindexed: boolean
  /**
   * Desfecho NOMEADO da disponibilidade. Sobe ate a CLI porque e o unico jeito
   * de `sync` deixar de dizer so o que trouxe e passar a dizer o que NAO trouxe.
   */
  readonly watchOutcome: DetailWatchOutcome
  /** Ofertas inseridas/atualizadas neste detalhe. */
  readonly watchOffers: number
}

/** Dependencias do handler. */
export interface SyncDetailsHandlerDeps {
  readonly detailSync: CatalogDetailSyncPort
  readonly store: CatalogJobStorePort
  readonly search: SearchReindexPort
}

/** Kinds que geram dependencias de catalogo (os de referencia nao geram). */
const DEPENDENCY_KINDS = new Set(['movie', 'tv', 'person'])

/** Kinds que entram na projecao de busca. */
const SEARCHABLE_KINDS = new Set(['movie', 'tv', 'person'])

/** Handler de `sync_details`. */
export class SyncDetailsHandler implements CatalogJobHandler<SyncDetailsInput, SyncDetailsResult> {
  readonly type = 'sync_details' as const

  constructor(private readonly deps: SyncDetailsHandlerDeps) {}

  validateInput(value: unknown): SyncDetailsInput {
    return validateSyncDetailsInput(value)
  }

  async execute(context: CatalogJobContext, input: SyncDetailsInput): Promise<SyncDetailsResult> {
    throwIfAborted(context.signal)
    await context.heartbeat()

    let outcome
    try {
      outcome = await this.deps.detailSync.syncDetail({
        kind: input.entityType,
        tmdbId: input.tmdbId,
        locale: input.locale,
        signal: context.signal,
      })
    } catch (error) {
      context.metrics.increment(CATALOG_METRIC_NAMES.jobsFailedTotal, 1, {
        job_type: this.type,
        entity_type: input.entityType,
        error_class: classifySafeError(error),
      })
      throw error
    }

    context.metrics.increment(CATALOG_METRIC_NAMES.entitiesSyncedTotal, outcome.skipped ? 0 : 1, {
      job_type: this.type,
      entity_type: input.entityType,
      result: outcome.skipped
        ? 'skipped'
        : outcome.created
          ? 'created'
          : outcome.updated
            ? 'updated'
            : 'unchanged',
    })

    // Desfecho da disponibilidade, SEMPRE registrado — inclusive no caminho
    // pulado. E o unico sinal do caminho da SEMENTE: o worker descarta o
    // resultado do handler, entao um `sync_details` que nao materializou oferta
    // nenhuma nao apareceria em lugar nenhum sem esta linha.
    context.metrics.increment(CATALOG_METRIC_NAMES.detailWatchTotal, 1, {
      entity_type: input.entityType,
      watch_outcome: outcome.watchOutcome,
    })

    // Detalhe pulado => nada a enfileirar: os dependentes nao teriam dono.
    if (outcome.skipped) {
      context.log.log('info', 'catalog_sync_details_skipped', {
        jobId: context.jobId,
        entityType: input.entityType,
        reason: outcome.skipReason,
      })
      return {
        entityType: input.entityType,
        tmdbId: input.tmdbId,
        created: false,
        updated: false,
        unchanged: false,
        skipped: true,
        skipReason: outcome.skipReason,
        enqueued: 0,
        reindexed: false,
        watchOutcome: outcome.watchOutcome,
        watchOffers: outcome.watchOffers,
      }
    }

    throwIfAborted(context.signal)
    await context.heartbeat()

    let enqueued = 0
    if (input.enqueueDependencies && DEPENDENCY_KINDS.has(input.entityType)) {
      enqueued = await this.enqueueDependencies(context, input)
    }

    // Reprojeta a busca so quando o dado mudou: reindexar um `unchanged` seria
    // escrita a toa em cada ciclo de sync.
    let reindexed = false
    if (
      SEARCHABLE_KINDS.has(input.entityType) &&
      outcome.entityId !== null &&
      (outcome.created || outcome.updated)
    ) {
      await this.deps.search.reindexEntity(
        input.entityType as 'movie' | 'tv' | 'person',
        outcome.entityId,
        input.locale,
      )
      reindexed = true
    }

    return {
      entityType: input.entityType,
      tmdbId: input.tmdbId,
      created: outcome.created,
      updated: outcome.updated,
      unchanged: outcome.unchanged,
      skipped: false,
      skipReason: null,
      enqueued,
      reindexed,
      watchOutcome: outcome.watchOutcome,
      watchOffers: outcome.watchOffers,
    }
  }

  /**
   * Enfileira SO o que a busca do detalhe nao cobriu.
   *
   * O detalhe vem com o `append_to_response` RICO de
   * `api-clients/tmdb/src/append-to-response.ts` — 13 sub-recursos para movie,
   * 16 para tv — e ja faz upsert de ids externos e elenco/equipe na MESMA
   * resposta (e, para tv, tambem das temporadas/episodios base). Enfileirar
   * `sync_credits`/`sync_external_ids` aqui seria refetch puro: mesma cota,
   * mesmo dado, zero ganho. Esses dois tipos existem como caminho de
   * REPARO/refresh explicito (via CLI), nao como dependencia automatica.
   *
   * NOTA (corrigida): a versao anterior deste comentario dizia que o detalhe
   * vinha com `append_to_response=external_ids,credits`. Nao vem — essa string
   * e so o rotulo de `params` da CHAVE de `api_cache` (ver `import-movie.ts`).
   * A crenca errada foi o que manteve `watch/providers` chegando e sendo
   * descartado.
   *
   * Sobra de verdade:
   *  - `sync_media` — `images`/`videos` ESTAO no append rico, mas nao sao o
   *    mesmo conjunto: os endpoints dedicados sao chamados SEM `language`
   *    (`buildUrl` nao injeta idioma), entao devolvem todos os idiomas, enquanto
   *    o bloco do append herda o `language` da requisicao de detalhe e vem
   *    filtrado. Trocar um pelo outro perderia imagem;
   *  - `sync_seasons` (tv) — enumera as temporadas e enfileira `sync_episodes`,
   *    que traz o nivel de episodio que o import base nao traz (guest stars,
   *    creditos, ids externos e stills do episodio).
   */
  private async enqueueDependencies(
    context: CatalogJobContext,
    input: SyncDetailsInput,
  ): Promise<number> {
    const externalId = String(input.tmdbId)
    const base = { locale: input.locale, tmdbId: input.tmdbId }
    const jobs: EnqueueCatalogJobInput[] = []

    const push = (
      jobType: EnqueueCatalogJobInput['jobType'],
      payload: Record<string, unknown>,
      priority: number,
    ) => {
      jobs.push({
        jobType,
        entityType: input.entityType,
        externalId,
        idempotencyKey: buildIdempotencyKey({
          jobType,
          entityType: input.entityType,
          externalId,
          discriminator: input.locale,
        }),
        payload,
        priority,
        runId: context.requestId,
      })
    }

    push('sync_media', { ...base, entityType: input.entityType }, 70)
    if (input.entityType === 'tv') {
      push('sync_seasons', { ...base, enqueueEpisodes: true }, 65)
    }

    let created = 0
    for (const job of jobs) {
      const result = await this.deps.store.enqueue(job)
      if (result.created) created += 1
    }
    context.log.log('debug', 'catalog_sync_details_enqueued', {
      jobId: context.jobId,
      entityType: input.entityType,
      planned: jobs.length,
      created,
    })
    return created
  }
}
