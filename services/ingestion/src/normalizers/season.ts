/**
 * season.ts — Normaliza o detalhe de temporada (`GET /tv/{id}/season/{n}`).
 *
 * `episodeCount` e derivado do tamanho de `episodes[]` (o detalhe de temporada
 * do TMDB nao traz `episode_count`; esse campo so existe no resumo embutido na
 * serie). `overview` e dado cru estrutural — nao e bloco de valor editorial.
 */

import type { TmdbSeasonDetail } from '@screena/tmdb-client'
import type { EpisodeUpsert, SeasonUpsert } from '../types.js'
import { NormalizationError } from '../types.js'
import { normalizeDate, nullableNumber, nullableString } from '../utils/normalize.js'
import { normalizeEpisode } from './episode.js'

/** Resultado da normalizacao de uma temporada (temporada + episodios). */
export interface NormalizedSeason {
  readonly season: SeasonUpsert
  readonly episodes: EpisodeUpsert[]
}

/** Normaliza uma temporada; lanca NormalizationError sem season_number. */
export function normalizeSeason(detail: TmdbSeasonDetail): NormalizedSeason {
  if (typeof detail.season_number !== 'number') {
    throw new NormalizationError('Temporada TMDB sem season_number.')
  }
  const episodes = (detail.episodes ?? []).map(normalizeEpisode)
  const season: SeasonUpsert = {
    tmdbId: nullableNumber(detail.id),
    seasonNumber: detail.season_number,
    name: nullableString(detail.name),
    overview: nullableString(detail.overview),
    airDate: normalizeDate(detail.air_date),
    episodeCount: episodes.length,
    posterPath: nullableString(detail.poster_path),
  }
  return { season, episodes }
}
