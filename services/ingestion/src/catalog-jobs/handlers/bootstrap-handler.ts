/**
 * bootstrap-handler.ts — `bootstrap` (Backend A §5).
 *
 * ORQUESTRADOR, nao executor. Ele NAO baixa o catalogo dentro de uma transacao
 * longa: enfileira as etapas e deixa a propria fila cascatear —
 *
 *   bootstrap -> discover_ids -> sync_details -> { sync_credits,
 *                sync_external_ids, sync_media, sync_seasons -> sync_episodes }
 *              -> sync_lists (snapshots)
 *
 * Por que assim: um bootstrap sincrono de milhoes de ids seria uma transacao
 * impossivel de retomar — morreu no meio, perdeu tudo. Enfileirando, cada etapa
 * e um job duravel com retry/dead-letter proprio, e o progresso vive no banco.
 *
 * Idempotencia e resume: as chaves carregam o `requestId` do bootstrap. Repetir
 * o MESMO requestId (resume) e noop para o que ja foi enfileirado; um requestId
 * NOVO e uma execucao nova e deliberada. Sem o requestId na chave, dois
 * bootstraps distintos colidiriam e o segundo viraria noop silencioso.
 */

import { CATALOG_METRIC_NAMES } from '../../metrics/index.js'
import type { CatalogJobContext, CatalogJobHandler } from '../handler.js'
import { buildIdempotencyKey } from '../idempotency.js'
import type { CatalogJobStorePort, EnqueueCatalogJobInput } from '../store-port.js'
import type { DiscoveryListType } from '../../discovery-snapshots/index.js'
import { validateBootstrapInput, type BootstrapInput } from './schemas.js'
import { classifySafeError, throwIfAborted } from './support.js'

/** Relatorio do bootstrap (serializavel; sem segredo). */
export interface CatalogBootstrapReport {
  readonly requestId: string
  readonly strategy: string
  readonly mode: string
  readonly locale: string
  readonly entityTypes: readonly string[]
  /** Jobs planejados (o que o bootstrap quis enfileirar). */
  readonly planned: number
  /** Jobs efetivamente criados (chave nova). */
  readonly enqueued: number
  /** Jobs que ja existiam (noop idempotente) — o sinal de resume. */
  readonly alreadyQueued: number
  readonly stages: readonly BootstrapStageReport[]
}

/** Relatorio de uma etapa do bootstrap. */
export interface BootstrapStageReport {
  readonly stage: string
  readonly planned: number
  readonly enqueued: number
  readonly alreadyQueued: number
}

/** Dependencias do handler. */
export interface BootstrapHandlerDeps {
  readonly store: CatalogJobStorePort
}

/** Listas de descoberta capturadas por padrao, por tipo de entidade. */
const BOOTSTRAP_LISTS: Readonly<Record<'movie' | 'tv', readonly DiscoveryListType[]>> = {
  movie: ['trending', 'popular', 'top_rated', 'upcoming', 'now_playing'],
  tv: ['trending', 'popular', 'top_rated', 'airing_today', 'on_the_air'],
}

/** Handler de `bootstrap`. */
export class BootstrapHandler implements CatalogJobHandler<BootstrapInput, CatalogBootstrapReport> {
  readonly type = 'bootstrap' as const

  constructor(private readonly deps: BootstrapHandlerDeps) {}

  validateInput(value: unknown): BootstrapInput {
    return validateBootstrapInput(value)
  }

  async execute(context: CatalogJobContext, input: BootstrapInput): Promise<CatalogBootstrapReport> {
    throwIfAborted(context.signal)
    await context.heartbeat()

    // `status` nao enfileira nada: so relata o que este requestId ja planejou.
    if (input.mode === 'status') {
      return this.emptyReport(context, input)
    }

    try {
      const stages: BootstrapStageReport[] = []
      stages.push(await this.enqueueStage(context, 'discover', this.planDiscovery(context, input)))
      await context.heartbeat()
      stages.push(await this.enqueueStage(context, 'lists', this.planLists(context, input)))

      const planned = stages.reduce((sum, s) => sum + s.planned, 0)
      const enqueued = stages.reduce((sum, s) => sum + s.enqueued, 0)
      const alreadyQueued = stages.reduce((sum, s) => sum + s.alreadyQueued, 0)

      context.metrics.increment(CATALOG_METRIC_NAMES.jobsTotal, enqueued, {
        job_type: this.type,
        result: 'enqueued',
      })

      context.log.log('info', 'catalog_bootstrap_enqueued', {
        jobId: context.jobId,
        requestId: context.requestId,
        strategy: input.strategy,
        planned,
        enqueued,
        alreadyQueued,
      })

      return {
        requestId: context.requestId,
        strategy: input.strategy,
        mode: input.mode,
        locale: input.locale,
        entityTypes: input.entityTypes,
        planned,
        enqueued,
        alreadyQueued,
        stages,
      }
    } catch (error) {
      context.metrics.increment(CATALOG_METRIC_NAMES.jobsFailedTotal, 1, {
        job_type: this.type,
        error_class: classifySafeError(error),
      })
      throw error
    }
  }

  /** Etapa 1 — descoberta do universo de ids, um job por tipo de entidade. */
  private planDiscovery(
    context: CatalogJobContext,
    input: BootstrapInput,
  ): EnqueueCatalogJobInput[] {
    return input.entityTypes.map((entityType) => ({
      jobType: 'discover_ids' as const,
      entityType,
      externalId: null,
      idempotencyKey: buildIdempotencyKey({
        jobType: 'discover_ids',
        entityType,
        externalId: null,
        discriminator: `bootstrap:${context.requestId}:${input.strategy}`,
      }),
      payload: {
        strategy: input.strategy,
        entityType,
        locale: input.locale,
        country: input.country,
        limit: input.limit,
        ids: input.ids,
        enqueueDetails: true,
      },
      priority: 10, // a descoberta abre o funil: roda antes dos detalhes
      runId: context.requestId,
    }))
  }

  /** Etapa 2 — snapshots de descoberta (so movie/tv tem lista). */
  private planLists(context: CatalogJobContext, input: BootstrapInput): EnqueueCatalogJobInput[] {
    const jobs: EnqueueCatalogJobInput[] = []
    for (const entityType of input.entityTypes) {
      if (entityType !== 'movie' && entityType !== 'tv') continue
      for (const listType of BOOTSTRAP_LISTS[entityType]) {
        jobs.push({
          jobType: 'sync_lists',
          entityType,
          externalId: null,
          idempotencyKey: buildIdempotencyKey({
            jobType: 'sync_lists',
            entityType,
            externalId: null,
            discriminator: `bootstrap:${context.requestId}:${listType}:${input.locale}`,
          }),
          payload: {
            listType,
            entityType,
            locale: input.locale,
            country: input.country,
            window: listType === 'trending' ? 'day' : null,
          },
          priority: 80, // snapshot depende de entidade promovida: vai por ultimo
          runId: context.requestId,
        })
      }
    }
    return jobs
  }

  /** Enfileira um lote e conta criado vs ja existente (o sinal de resume). */
  private async enqueueStage(
    context: CatalogJobContext,
    stage: string,
    jobs: readonly EnqueueCatalogJobInput[],
  ): Promise<BootstrapStageReport> {
    let enqueued = 0
    let alreadyQueued = 0
    for (const job of jobs) {
      throwIfAborted(context.signal)
      const result = await this.deps.store.enqueue(job)
      if (result.created) enqueued += 1
      else alreadyQueued += 1
    }
    return { stage, planned: jobs.length, enqueued, alreadyQueued }
  }

  /** Relatorio vazio (modo `status`). */
  private emptyReport(context: CatalogJobContext, input: BootstrapInput): CatalogBootstrapReport {
    return {
      requestId: context.requestId,
      strategy: input.strategy,
      mode: input.mode,
      locale: input.locale,
      entityTypes: input.entityTypes,
      planned: 0,
      enqueued: 0,
      alreadyQueued: 0,
      stages: [],
    }
  }
}
