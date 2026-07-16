/**
 * sync-episodes-handler.ts — `sync_episodes` (Backend A §11).
 *
 * Detalhe + creditos + guest stars + ids externos + stills dos episodios de UMA
 * temporada.
 *
 * `Episode.tmdbId` nulo NAO derruba o lote: sem chave natural, aquele episodio
 * nao tem o que sincronizar. Ele e contado em `skippedNoTmdbId`, ganha metrica
 * propria e o restante da temporada segue. Falhar a temporada inteira por causa
 * de uma linha sem id transformaria um buraco de dado num incidente de fila.
 */

import { CATALOG_METRIC_NAMES } from '../../metrics/index.js'
import type { CatalogJobContext, CatalogJobHandler } from '../handler.js'
import type { CatalogEpisodesSyncPort } from './ports.js'
import { validateSyncEpisodesInput, type SyncEpisodesInput } from './schemas.js'
import { classifySafeError, throwIfAborted } from './support.js'

/** Resultado serializavel do `sync_episodes`. */
export interface SyncEpisodesResult {
  readonly tmdbId: number
  readonly seasonNumber: number
  readonly episodes: number
  readonly cast: number
  readonly guestStars: number
  readonly crew: number
  readonly externalIds: number
  readonly stills: number
  readonly skippedNoTmdbId: number
  readonly skipped: boolean
  readonly skipReason: string | null
}

/** Dependencias do handler. */
export interface SyncEpisodesHandlerDeps {
  readonly episodesSync: CatalogEpisodesSyncPort
}

/** Handler de `sync_episodes`. */
export class SyncEpisodesHandler
  implements CatalogJobHandler<SyncEpisodesInput, SyncEpisodesResult>
{
  readonly type = 'sync_episodes' as const

  constructor(private readonly deps: SyncEpisodesHandlerDeps) {}

  validateInput(value: unknown): SyncEpisodesInput {
    return validateSyncEpisodesInput(value)
  }

  async execute(context: CatalogJobContext, input: SyncEpisodesInput): Promise<SyncEpisodesResult> {
    const startedAt = Date.now()
    throwIfAborted(context.signal)
    await context.heartbeat()

    try {
      const outcome = await this.deps.episodesSync.syncEpisodes({
        tvTmdbId: input.tmdbId,
        seasonNumber: input.seasonNumber,
        locale: input.locale,
        signal: context.signal,
      })

      context.metrics.increment(CATALOG_METRIC_NAMES.entitiesSyncedTotal, outcome.episodes, {
        job_type: this.type,
        entity_type: 'episode',
        result: outcome.skipped ? 'skipped' : 'success',
      })

      if (outcome.skippedNoTmdbId > 0) {
        // Visivel como metrica propria: buraco de dado upstream, nao falha nossa.
        context.metrics.increment(
          CATALOG_METRIC_NAMES.entitiesSyncedTotal,
          outcome.skippedNoTmdbId,
          { job_type: this.type, entity_type: 'episode', result: 'skipped_no_tmdb_id' },
        )
        context.log.log('warn', 'catalog_episodes_skipped_no_tmdb_id', {
          jobId: context.jobId,
          seasonNumber: input.seasonNumber,
          skipped: outcome.skippedNoTmdbId,
        })
      }

      context.metrics.observe(
        CATALOG_METRIC_NAMES.syncDurationSeconds,
        (Date.now() - startedAt) / 1000,
        { job_type: this.type, entity_type: 'episode' },
      )

      return {
        tmdbId: input.tmdbId,
        seasonNumber: input.seasonNumber,
        episodes: outcome.episodes,
        cast: outcome.cast,
        guestStars: outcome.guestStars,
        crew: outcome.crew,
        externalIds: outcome.externalIds,
        stills: outcome.stills,
        skippedNoTmdbId: outcome.skippedNoTmdbId,
        skipped: outcome.skipped,
        skipReason: outcome.skipReason,
      }
    } catch (error) {
      context.metrics.increment(CATALOG_METRIC_NAMES.jobsFailedTotal, 1, {
        job_type: this.type,
        entity_type: 'episode',
        error_class: classifySafeError(error),
      })
      throw error
    }
  }
}
