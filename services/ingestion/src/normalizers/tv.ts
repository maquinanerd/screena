/**
 * tv.ts — Normaliza o detalhe de serie do TMDB.
 *
 * Alem do `TvShowUpsert`, devolve `seasonNumbers` (de `seasons[]`) para que a
 * orquestracao busque cada temporada via `GET /tv/{id}/season/{n}`.
 */

import type { TmdbTvDetail } from '@screena/tmdb-client'
import type {
  CastMemberInput,
  CrewMemberInput,
  ExternalIdInput,
  TitleRecommendationLink,
  TitleGenreLink,
  TitleCountryLink,
  TvShowUpsert,
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
import { normalizeBrContentRating, normalizeTvOriginCountries } from './detail-facts.js'

/** Resultado da normalizacao de uma serie. */
export interface NormalizedTvShow {
  readonly tvShow: TvShowUpsert
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
  readonly seasonNumbers: number[]
  /** Generos, na ORDEM do TMDB (editorial: o primeiro e o mais representativo). */
  readonly genres: TitleGenreLink[]
  /** A fonte trouxe o array de generos (mesmo vazio)? Ver NormalizedMovie. */
  readonly genresPresent: boolean
  /** Paises de origem (`origin_country`), na ordem do payload. */
  readonly countries: TitleCountryLink[]
  /** A fonte trouxe o array de paises? Mesma disciplina de `genresPresent`. */
  readonly countriesPresent: boolean
}

/** Normaliza uma serie; lanca NormalizationError sem id ou sem nome. */
export function normalizeTvShow(detail: TmdbTvDetail): NormalizedTvShow {
  if (typeof detail.id !== 'number') {
    throw new NormalizationError('Serie TMDB sem id numerico.')
  }
  const name = nullableString(detail.original_name) ?? nullableString(detail.name)
  if (name === null) {
    throw new NormalizationError(`Serie TMDB ${detail.id} sem nome.`)
  }

  const imdbId = normalizeImdbId(detail.external_ids?.imdb_id)
  const tvShow: TvShowUpsert = {
    tmdbId: detail.id,
    imdbId,
    nameOriginal: name,
    originalLanguage: normalizeOriginalLanguage(detail.original_language),
    firstAirDate: normalizeDate(detail.first_air_date),
    lastAirDate: normalizeDate(detail.last_air_date),
    status: nullableString(detail.status),
    numberOfSeasons: nullableNumber(detail.number_of_seasons),
    numberOfEpisodes: nullableNumber(detail.number_of_episodes),
    popularity: nullableNumber(detail.popularity),
    voteAverageTmdb: nullableNumber(detail.vote_average),
    voteCountTmdb: nullableNumber(detail.vote_count),
    posterPath: nullableString(detail.poster_path),
    backdropPath: nullableString(detail.backdrop_path),
    // Recorte BR de `content_ratings` (ficha, 20/08/2026): so a classificacao
    // BRASILEIRA e persistida — a de outro pais nunca entra sem rotulo.
    certification: normalizeBrContentRating(
      (detail as { content_ratings?: unknown }).content_ratings,
    ).certification,
  }

  const seasonNumbers = (detail.seasons ?? [])
    .map((season) => season.season_number)
    .filter((value): value is number => typeof value === 'number')

  const credits = normalizeCredits(detail.credits)
  const recomendacoes = collectRecommendations(detail, 'tv')
  const genres = normalizeTitleGenres(detail.genres)
  const countries = normalizeTvOriginCountries(
    (detail as { origin_country?: unknown }).origin_country,
  )
  return {
    tvShow,
    externalIds: buildExternalIds('tv', detail.id, imdbId),
    cast: credits.cast,
    crew: credits.crew,
    castPresent: credits.castPresent,
    crewPresent: credits.crewPresent,
    recommendations: recomendacoes.links,
    recommendationsPresent: recomendacoes.present,
    seasonNumbers,
    genres: genres.links,
    genresPresent: genres.present,
    countries: countries.links,
    countriesPresent: countries.present,
  }
}
