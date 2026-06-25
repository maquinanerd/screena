/**
 * movie.ts — Normaliza o detalhe de filme do TMDB para o formato canonico.
 */

import type { TmdbMovieDetail } from '@screena/tmdb-client'
import type { CastMemberInput, CrewMemberInput, ExternalIdInput, MovieUpsert } from '../types.js'
import { NormalizationError } from '../types.js'
import {
  normalizeDate,
  normalizeImdbId,
  normalizeOriginalLanguage,
  nullableNumber,
  nullableString,
} from '../utils/normalize.js'
import { buildExternalIds } from './external-ids.js'
import { normalizeCredits } from './credits.js'

/** Resultado da normalizacao de um filme. */
export interface NormalizedMovie {
  readonly movie: MovieUpsert
  readonly externalIds: ExternalIdInput[]
  readonly cast: CastMemberInput[]
  readonly crew: CrewMemberInput[]
}

/** Normaliza um filme; lanca NormalizationError sem id ou sem titulo. */
export function normalizeMovie(detail: TmdbMovieDetail): NormalizedMovie {
  if (typeof detail.id !== 'number') {
    throw new NormalizationError('Filme TMDB sem id numerico.')
  }
  const title = nullableString(detail.original_title) ?? nullableString(detail.title)
  if (title === null) {
    throw new NormalizationError(`Filme TMDB ${detail.id} sem titulo.`)
  }

  const imdbId = normalizeImdbId(detail.imdb_id ?? detail.external_ids?.imdb_id)
  const movie: MovieUpsert = {
    tmdbId: detail.id,
    imdbId,
    titleOriginal: title,
    originalLanguage: normalizeOriginalLanguage(detail.original_language),
    releaseDate: normalizeDate(detail.release_date),
    runtimeMinutes: nullableNumber(detail.runtime),
    status: nullableString(detail.status),
    popularity: nullableNumber(detail.popularity),
    voteAverageTmdb: nullableNumber(detail.vote_average),
    voteCountTmdb: nullableNumber(detail.vote_count),
    posterPath: nullableString(detail.poster_path),
    backdropPath: nullableString(detail.backdrop_path),
  }

  const credits = normalizeCredits(detail.credits)
  return {
    movie,
    externalIds: buildExternalIds('movie', detail.id, imdbId),
    cast: credits.cast,
    crew: credits.crew,
  }
}
