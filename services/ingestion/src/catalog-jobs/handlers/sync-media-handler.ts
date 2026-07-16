/**
 * sync-media-handler.ts — `sync_media` (Backend A §10).
 *
 * Posters/backdrops/logos/profiles/stills + trailers/teasers/clips/featurettes.
 *
 * Invariante 6 (fail-closed): toda linha de midia nasce `display_allowed=false`
 * e ESTE job nunca liga a flag. Promover midia a exibivel e decisao humana
 * registrada, fora do sync — um worker nao licencia arte de estudio sozinho.
 */

import { CATALOG_METRIC_NAMES } from '../../metrics/index.js'
import type { CatalogJobContext, CatalogJobHandler } from '../handler.js'
import type { CatalogMediaSyncPort } from './ports.js'
import { validateSyncMediaInput, type SyncMediaInput } from './schemas.js'
import { classifySafeError, throwIfAborted } from './support.js'

/** Resultado serializavel do `sync_media`. */
export interface SyncMediaResult {
  readonly entityType: string
  readonly tmdbId: number
  readonly images: number
  readonly videos: number
  readonly skipped: boolean
  readonly skipReason: string | null
}

/** Dependencias do handler. */
export interface SyncMediaHandlerDeps {
  readonly mediaSync: CatalogMediaSyncPort
}

/** Handler de `sync_media`. */
export class SyncMediaHandler implements CatalogJobHandler<SyncMediaInput, SyncMediaResult> {
  readonly type = 'sync_media' as const

  constructor(private readonly deps: SyncMediaHandlerDeps) {}

  validateInput(value: unknown): SyncMediaInput {
    return validateSyncMediaInput(value)
  }

  async execute(context: CatalogJobContext, input: SyncMediaInput): Promise<SyncMediaResult> {
    const startedAt = Date.now()
    throwIfAborted(context.signal)
    await context.heartbeat()

    try {
      const outcome = await this.deps.mediaSync.syncMedia({
        kind: input.entityType,
        tmdbId: input.tmdbId,
        seasonNumber: input.seasonNumber,
        episodeNumber: input.episodeNumber,
        locale: input.locale,
        signal: context.signal,
      })

      context.metrics.increment(
        CATALOG_METRIC_NAMES.entitiesSyncedTotal,
        outcome.images + outcome.videos,
        {
          job_type: this.type,
          entity_type: input.entityType,
          result: outcome.skipped ? 'skipped' : 'success',
        },
      )
      context.metrics.observe(
        CATALOG_METRIC_NAMES.syncDurationSeconds,
        (Date.now() - startedAt) / 1000,
        { job_type: this.type, entity_type: input.entityType },
      )

      return {
        entityType: input.entityType,
        tmdbId: input.tmdbId,
        images: outcome.images,
        videos: outcome.videos,
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
