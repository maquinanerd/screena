/**
 * movie.ts — Normaliza o detalhe de filme do TMDB para o formato canonico.
 */

import type { TmdbMovieDetail } from '@screena/tmdb-client'
import type {
  CastMemberInput,
  CrewMemberInput,
  ExternalIdInput,
  MovieUpsert,
  TitleRecommendationLink,
  TitleGenreLink,
} from '../types.js'
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
import { collectRecommendations } from './recommendations.js'
import { normalizeTitleGenres } from './genres.js'

/** Resultado da normalizacao de um filme. */
export interface NormalizedMovie {
  readonly movie: MovieUpsert
  readonly externalIds: ExternalIdInput[]
  readonly cast: CastMemberInput[]
  readonly crew: CrewMemberInput[]
  /** A fonte trouxe a lista de elenco (array, mesmo vazio)? Ver NormalizedCredits. */
  readonly castPresent: boolean
  /** A fonte trouxe a lista de equipe (array, mesmo vazio)? Ver NormalizedCredits. */
  readonly crewPresent: boolean
  /**
   * `recommendations` + `similar`, na ORDEM do TMDB (a ordem e o sinal).
   *
   * Chegavam no append desde sempre e eram descartados aqui — terceiro caso do
   * mesmo padrao. Ver `normalizers/recommendations.ts`.
   */
  readonly recommendations: TitleRecommendationLink[]
  /** A fonte trouxe ALGUM dos dois blocos? Ausencia nunca e lista vazia. */
  readonly recommendationsPresent: boolean
  /** Generos, na ORDEM do TMDB (editorial: o primeiro e o mais representativo). */
  readonly genres: TitleGenreLink[]
  /**
   * A fonte trouxe o array de generos (mesmo vazio)?
   *
   * Mesma disciplina de `castPresent`: ausencia do campo NAO e o mesmo que lista
   * vazia. Sem esta distincao, um payload truncado apagaria os generos de um
   * titulo que os tem — foi exatamente o defeito de creditos apagados por
   * payload sem `credits`.
   */
  readonly genresPresent: boolean
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
  const recomendacoes = collectRecommendations(detail, 'movie')
  const genres = normalizeTitleGenres(detail.genres)
  return {
    movie,
    externalIds: buildExternalIds('movie', detail.id, imdbId),
    cast: credits.cast,
    crew: credits.crew,
    castPresent: credits.castPresent,
    crewPresent: credits.crewPresent,
    recommendations: recomendacoes.links,
    recommendationsPresent: recomendacoes.present,
    genres: genres.links,
    genresPresent: genres.present,
  }
}
