/**
 * reprocess-raw-handler.ts — `reprocess_raw` (Backend A §14).
 *
 * Reprocessa `tmdb_raw` JA capturado -> tabelas tipadas. Serve para quando a
 * normalizacao muda (bug corrigido, campo novo) e o catalogo precisa ser
 * reconstruido SEM gastar cota do provider.
 *
 * Garantia: NUNCA chama o TMDB. A entrada e o payload bruto ja gravado; se ele
 * nao existe, o job nao busca — reporta `skipped`. Um "reprocessamento" que
 * refizesse fetch seria um sync disfarcado, com custo de cota escondido.
 */

import { CATALOG_METRIC_NAMES } from '../../metrics/index.js'
import type { CatalogJobContext, CatalogJobHandler } from '../handler.js'
import type { CatalogReprocessRawPort } from './ports.js'
import { validateReprocessRawInput, type ReprocessRawInput } from './schemas.js'
import { classifySafeError, throwIfAborted } from './support.js'

/** Resultado serializavel do `reprocess_raw`. */
export interface ReprocessRawResult {
  readonly entityType: string
  readonly scanned: number
  readonly promoted: number
  readonly unchanged: number
  readonly skipped: number
  readonly failed: number
  readonly dryRun: boolean
}

/** Dependencias do handler. */
export interface ReprocessRawHandlerDeps {
  readonly reprocessRaw: CatalogReprocessRawPort
}

/** Handler de `reprocess_raw`. */
export class ReprocessRawHandler
  implements CatalogJobHandler<ReprocessRawInput, ReprocessRawResult>
{
  readonly type = 'reprocess_raw' as const

  constructor(private readonly deps: ReprocessRawHandlerDeps) {}

  validateInput(value: unknown): ReprocessRawInput {
    return validateReprocessRawInput(value)
  }

  async execute(context: CatalogJobContext, input: ReprocessRawInput): Promise<ReprocessRawResult> {
    const startedAt = Date.now()
    throwIfAborted(context.signal)
    await context.heartbeat()

    try {
      const outcome = await this.deps.reprocessRaw.reprocess({
        kind: input.entityType,
        tmdbId: input.tmdbId,
        baseLanguage: input.baseLanguage,
        limit: input.limit,
        dryRun: input.dryRun,
        signal: context.signal,
      })

      context.metrics.increment(CATALOG_METRIC_NAMES.entitiesSyncedTotal, outcome.promoted, {
        job_type: this.type,
        entity_type: input.entityType,
        result: outcome.dryRun ? 'dry_run' : 'promoted',
      })
      context.metrics.observe(
        CATALOG_METRIC_NAMES.syncDurationSeconds,
        (Date.now() - startedAt) / 1000,
        { job_type: this.type, entity_type: input.entityType },
      )

      context.log.log('info', 'catalog_reprocess_raw_finished', {
        jobId: context.jobId,
        entityType: input.entityType,
        scanned: outcome.scanned,
        promoted: outcome.promoted,
        dryRun: outcome.dryRun,
      })

      return {
        entityType: input.entityType,
        scanned: outcome.scanned,
        promoted: outcome.promoted,
        unchanged: outcome.unchanged,
        skipped: outcome.skipped,
        failed: outcome.failed,
        dryRun: outcome.dryRun,
      }
    } catch (error) {
      context.metrics.increment(CATALOG_METRIC_NAMES.jobsFailedTotal, 1, {
        job_type: this.type,
        entity_type: input.entityType,
        error_class: classifySafeError(error),
      })
      throw error
    }
  }
}
