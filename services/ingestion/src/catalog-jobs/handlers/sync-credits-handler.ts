/**
 * sync-credits-handler.ts — `sync_credits` (Backend A §8).
 *
 * Elenco/equipe de movie|tv|season|episode, incluindo guest stars de episodio.
 *
 * Armadilha coberta pelo adapter (documentada aqui porque governa o contrato):
 * `cast_members.credit_id` e unique GLOBAL e o TMDB REUSA o credit id do show
 * nos episodios. Por isso a persistencia e replace-set idempotente com
 * skipDuplicates — nunca inventar credit id novo para contornar a colisao.
 */

import { CATALOG_METRIC_NAMES } from '../../metrics/index.js'
import type { CatalogJobContext, CatalogJobHandler } from '../handler.js'
import type { CatalogCreditsSyncPort } from './ports.js'
import { validateSyncCreditsInput, type SyncCreditsInput } from './schemas.js'
import { classifySafeError, throwIfAborted } from './support.js'

/** Resultado serializavel do `sync_credits`. */
export interface SyncCreditsResult {
  readonly entityType: string
  readonly tmdbId: number
  readonly cast: number
  readonly crew: number
  readonly guestStars: number
  readonly skipped: boolean
  readonly skipReason: string | null
}

/** Dependencias do handler. */
export interface SyncCreditsHandlerDeps {
  readonly creditsSync: CatalogCreditsSyncPort
}

/** Handler de `sync_credits`. */
export class SyncCreditsHandler implements CatalogJobHandler<SyncCreditsInput, SyncCreditsResult> {
  readonly type = 'sync_credits' as const

  constructor(private readonly deps: SyncCreditsHandlerDeps) {}

  validateInput(value: unknown): SyncCreditsInput {
    return validateSyncCreditsInput(value)
  }

  async execute(context: CatalogJobContext, input: SyncCreditsInput): Promise<SyncCreditsResult> {
    throwIfAborted(context.signal)
    await context.heartbeat()

    try {
      const outcome = await this.deps.creditsSync.syncCredits({
        kind: input.entityType,
        tmdbId: input.tmdbId,
        seasonNumber: input.seasonNumber,
        episodeNumber: input.episodeNumber,
        locale: input.locale,
        signal: context.signal,
      })

      context.metrics.increment(
        CATALOG_METRIC_NAMES.entitiesSyncedTotal,
        outcome.cast + outcome.crew + outcome.guestStars,
        { job_type: this.type, entity_type: input.entityType, result: outcome.skipped ? 'skipped' : 'success' },
      )

      return {
        entityType: input.entityType,
        tmdbId: input.tmdbId,
        cast: outcome.cast,
        crew: outcome.crew,
        guestStars: outcome.guestStars,
        skipped: outcome.skipped,
        skipReason: outcome.skipReason,
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
