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
 *
 * COBERTURA: este e o chamador SEMENTE do T0. Ele nao monta o `sync_details` a
 * mao — pede a `buildCoverageJob`, a mesma porta que o incremental `/changes` e
 * a hidratacao sob demanda usam. Ver `entity-coverage/entry.ts`.
 */

import { CATALOG_METRIC_NAMES } from '../../metrics/index.js'
import { buildCoverageJob } from '../../entity-coverage/entry.js'
import type { CatalogJobContext, CatalogJobHandler } from '../handler.js'
import type { CatalogJobStorePort } from '../store-port.js'
import type { CatalogDiscoverIdsPort } from './ports.js'
import { validateDiscoverIdsInput, type DiscoverIdsInput } from './schemas.js'
import { classifySafeError, createEnqueueTally, throwIfAborted } from './support.js'

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
    // A chave de `sync_details` vinda da DESCOBERTA nao tem escopo: o mesmo id
    // descoberto amanha e o mesmo trabalho. Como o export diario reoferece
    // largamente o MESMO conjunto, quase toda tentativa aqui e noop — e e a
    // contagem abaixo, nao um erro no banco, que torna isso visivel.
    const tally = createEnqueueTally()
    let enqueued = 0
    let index = 0
    for (const tmdbId of ids) {
      throwIfAborted(context.signal)
      // PORTA UNICA de cobertura (T0). Sem escopo: a descoberta e o backfill do
      // universo, e o MESMO id descoberto de novo e o mesmo trabalho (noop
      // idempotente).
      const result = await this.deps.store.enqueue(
        buildCoverageJob({
          kind: input.entityType,
          tmdbId,
          locale: input.locale,
          reason: 'discovery',
          runId: context.requestId,
        }),
      )
      tally.add('sync_details', result.created)
      if (result.created) enqueued += 1
      index += 1
      if (index % 50 === 0) await context.heartbeat()
    }
    tally.flush(context.metrics)
    return enqueued
  }
}
