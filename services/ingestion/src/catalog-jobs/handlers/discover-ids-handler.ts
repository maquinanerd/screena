/**
 * discover-ids-handler.ts — `discover_ids` (Backend A §6).
 *
 * Descobre o universo de ids (Daily ID Exports / listas / discover / lista
 * explicita) e, quando pedido, enfileira um `sync_details` por id aceito.
 *
 * Conteudo adulto: a exclusao e responsabilidade da porta de descoberta (duas
 * camadas — arquivos `adult_*` nunca baixados + campo `adult` fail-closed por
 * linha). Este handler apenas CONTA o que foi rejeitado e o expoe em metrica:
 * um salto em `rejectedAdult` e sinal de mudanca upstream, nao ruido.
 */

import { CATALOG_METRIC_NAMES } from '../../metrics/index.js'
import type { CatalogJobContext, CatalogJobHandler } from '../handler.js'
import { buildIdempotencyKey } from '../idempotency.js'
import type { CatalogJobStorePort } from '../store-port.js'
import type { CatalogDiscoverIdsPort } from './ports.js'
import { validateDiscoverIdsInput, type DiscoverIdsInput } from './schemas.js'
import { classifySafeError, throwIfAborted } from './support.js'

/** Resultado serializavel do `discover_ids`. */
export interface DiscoverIdsResult {
  readonly strategy: string
  readonly entityType: string
  readonly discovered: number
  readonly accepted: number
  readonly rejectedAdult: number
  readonly duplicate: number
  readonly enqueued: number
}

/** Dependencias do handler. */
export interface DiscoverIdsHandlerDeps {
  readonly discovery: CatalogDiscoverIdsPort
  readonly store: CatalogJobStorePort
}

/** Handler de `discover_ids`. */
export class DiscoverIdsHandler implements CatalogJobHandler<DiscoverIdsInput, DiscoverIdsResult> {
  readonly type = 'discover_ids' as const

  constructor(private readonly deps: DiscoverIdsHandlerDeps) {}

  validateInput(value: unknown): DiscoverIdsInput {
    return validateDiscoverIdsInput(value)
  }

  async execute(context: CatalogJobContext, input: DiscoverIdsInput): Promise<DiscoverIdsResult> {
    throwIfAborted(context.signal)
    await context.heartbeat()

    let outcome
    try {
      outcome = await this.deps.discovery.discover({
        strategy: input.strategy,
        kind: input.entityType,
        locale: input.locale,
        country: input.country,
        limit: input.limit,
        maxPages: input.maxPages,
        ids: input.ids,
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

    if (outcome.rejectedAdult > 0) {
      context.metrics.increment(CATALOG_METRIC_NAMES.entitiesSyncedTotal, outcome.rejectedAdult, {
        job_type: this.type,
        entity_type: input.entityType,
        result: 'rejected_adult',
      })
    }

    let enqueued = 0
    if (input.enqueueDetails) {
      enqueued = await this.enqueueDetails(context, input, outcome.ids)
    }

    context.metrics.increment(CATALOG_METRIC_NAMES.entitiesSyncedTotal, outcome.accepted, {
      job_type: this.type,
      entity_type: input.entityType,
      result: 'discovered',
    })

    context.log.log('info', 'catalog_discover_ids_finished', {
      jobId: context.jobId,
      strategy: input.strategy,
      entityType: input.entityType,
      discovered: outcome.discovered,
      accepted: outcome.accepted,
      rejectedAdult: outcome.rejectedAdult,
      enqueued,
    })

    return {
      strategy: input.strategy,
      entityType: input.entityType,
      discovered: outcome.discovered,
      accepted: outcome.accepted,
      rejectedAdult: outcome.rejectedAdult,
      duplicate: outcome.duplicate,
      enqueued,
    }
  }

  /** Enfileira `sync_details` por id. Heartbeat periodico: o lote e longo. */
  private async enqueueDetails(
    context: CatalogJobContext,
    input: DiscoverIdsInput,
    ids: readonly number[],
  ): Promise<number> {
    let enqueued = 0
    let index = 0
    for (const tmdbId of ids) {
      throwIfAborted(context.signal)
      const externalId = String(tmdbId)
      const result = await this.deps.store.enqueue({
        jobType: 'sync_details',
        entityType: input.entityType,
        externalId,
        // Sem discriminador de janela: a descoberta e o backfill do universo, e
        // o MESMO id descoberto de novo e o mesmo trabalho (noop idempotente).
        idempotencyKey: buildIdempotencyKey({
          jobType: 'sync_details',
          entityType: input.entityType,
          externalId,
          discriminator: input.locale,
        }),
        payload: {
          entityType: input.entityType,
          tmdbId,
          locale: input.locale,
          reason: 'discovery',
        },
        priority: 100, // backfill cede a vez para changes (prioridade 50)
        runId: context.requestId,
      })
      if (result.created) enqueued += 1
      index += 1
      if (index % 50 === 0) await context.heartbeat()
    }
    return enqueued
  }
}
