/**
 * sync-changes-handler.ts — `sync_changes` (Backend A §13).
 *
 * Fino de proposito: o executor transacional real (`runChangesSync`) ja existe e
 * ja garante a invariante central — o checkpoint SO avanca depois do COMMIT do
 * lote, na MESMA transacao do enqueue. Este handler apenas traduz o payload do
 * job para as opcoes do executor e emite as metricas do ciclo.
 *
 * Reexecutar e seguro: janela concluida e noop; janela parcial retoma da pagina
 * seguinte ao checkpoint; pagina repetida nao duplica job (idempotency key).
 */

import { CATALOG_METRIC_NAMES } from '../../metrics/index.js'
import { runChangesSync, type ChangesRunDeps, type ChangesRunReport } from '../../changes/run.js'
import type { CatalogJobContext, CatalogJobHandler } from '../handler.js'
import { validateSyncChangesInput, type SyncChangesInput } from './schemas.js'
import { classifySafeError, throwIfAborted } from './support.js'

/** Resultado serializavel do `sync_changes`. */
export interface SyncChangesResult {
  readonly window: { readonly from: string; readonly to: string }
  readonly kinds: ChangesRunReport['kinds']
  readonly totalEnqueued: number
}

/** Dependencias do handler. */
export interface SyncChangesHandlerDeps {
  /** Deps do executor, MENOS `metrics`/`log` (vem do contexto do job). */
  readonly changes: Omit<ChangesRunDeps, 'metrics' | 'log'>
}

/** Handler de `sync_changes`. */
export class SyncChangesHandler implements CatalogJobHandler<SyncChangesInput, SyncChangesResult> {
  readonly type = 'sync_changes' as const

  constructor(private readonly deps: SyncChangesHandlerDeps) {}

  validateInput(value: unknown): SyncChangesInput {
    return validateSyncChangesInput(value)
  }

  async execute(context: CatalogJobContext, input: SyncChangesInput): Promise<SyncChangesResult> {
    const startedAt = Date.now()
    throwIfAborted(context.signal)
    await context.heartbeat()

    try {
      const report = await runChangesSync(
        {
          ...this.deps.changes,
          metrics: context.metrics,
          log: context.log,
          // Sem repassar o signal, o timeout do job marcava retry mas ESTE ciclo
          // seguia rodando: o job era reivindicado de novo e os dois paginavam
          // em paralelo, ambos gravando checkpoint — o zumbi regredindo o
          // `lastPage` do run novo (o commit nao tem guarda de monotonicidade).
          signal: context.signal,
        },
        {
          kinds: input.kinds,
          from: input.from ?? undefined,
          to: input.to ?? undefined,
          maxPages: input.maxPages ?? undefined,
          resume: input.resume,
          runId: context.requestId,
        },
      )

      for (const kind of report.kinds) {
        context.metrics.increment(CATALOG_METRIC_NAMES.entitiesSyncedTotal, kind.enqueued, {
          job_type: this.type,
          entity_type: kind.kind,
          result: kind.skipped ? 'skipped' : kind.done ? 'done' : 'partial',
        })
      }
      context.metrics.observe(
        CATALOG_METRIC_NAMES.syncDurationSeconds,
        (Date.now() - startedAt) / 1000,
        { job_type: this.type },
      )

      return {
        window: report.window,
        kinds: report.kinds,
        totalEnqueued: report.totalEnqueued,
      }
    } catch (error) {
      context.metrics.increment(CATALOG_METRIC_NAMES.jobsFailedTotal, 1, {
        job_type: this.type,
        error_class: classifySafeError(error),
      })
      throw error
    }
  }
}
