/**
 * episode.ts — Normaliza um episodio (vindo de `season.episodes[]`).
 *
 * O numero da temporada NAO mora no episodio (e derivado de `seasons` via
 * `season_id`, decisao da Fase 1). Aqui so vem `episodeNumber` e campos proprios.
 */

import type { TmdbEpisodeSummary } from '@screena/tmdb-client'
import type { EpisodeUpsert } from '../types.js'
import { NormalizationError } from '../types.js'
import { normalizeDate, nullableNumber, nullableString } from '../utils/normalize.js'

/** Normaliza um episodio; lanca NormalizationError sem episode_number. */
export function normalizeEpisode(episode: TmdbEpisodeSummary): EpisodeUpsert {
  if (typeof episode.episode_number !== 'number') {
    throw new NormalizationError('Episodio TMDB sem episode_number.')
  }
  return {
    tmdbId: nullableNumber(episode.id),
    episodeNumber: episode.episode_number,
    name: nullableString(episode.name),
    overview: nullableString(episode.overview),
    airDate: normalizeDate(episode.air_date),
    runtimeMinutes: nullableNumber(episode.runtime),
    stillPath: nullableString(episode.still_path),
  }
}
