/**
 * types.ts — Subset tipado das respostas TMDB usadas pela Screena.
 *
 * NAO e o schema completo do TMDB — apenas os campos que a ingestao da Fase 2
 * normaliza. Todos os campos sao opcionais/defensivos: o TMDB pode omitir
 * campos, e os normalizers tratam ausencia sem inventar dado.
 */

/**
 * Bloco paginado de `recommendations`/`similar` no detalhe.
 *
 * Chegava desde sempre (esta em MOVIE_APPEND e TV_APPEND) e nao tinha
 * declaracao aqui — por isso sumia no limite do tipo, sem erro nem aviso.
 */
export interface TmdbRelatedTitlesBlock {
  results?: TmdbRelatedTitle[]
}

/** Um titulo dentro de `recommendations`/`similar`. */
export interface TmdbRelatedTitle {
  id: number
  /** `movie` | `tv`. Ausente quando o endpoint ja e de um tipo so. */
  media_type?: string | null
}

/**
 * Genero do TMDB, como vem no DETALHE (`/movie/{id}.genres`, `/tv/{id}.genres`).
 *
 * NAO e append: e campo de primeiro nivel do detalhe, entao chega em toda
 * requisicao que ja fazemos. Ficava sem declaracao aqui e por isso era
 * descartado silenciosamente no normalizador.
 */
export interface TmdbGenreRef {
  id: number
  name?: string | null
}

/** IDs externos retornados por `append_to_response=external_ids`. */
export interface TmdbExternalIds {
  imdb_id?: string | null
}

/** Credito de elenco (credits.cast). */
export interface TmdbCastCredit {
  id: number
  name?: string | null
  character?: string | null
  order?: number | null
  credit_id?: string | null
  known_for_department?: string | null
  gender?: number | null
  profile_path?: string | null
}

/** Credito de equipe (credits.crew). */
export interface TmdbCrewCredit {
  id: number
  name?: string | null
  department?: string | null
  job?: string | null
  credit_id?: string | null
  known_for_department?: string | null
  gender?: number | null
  profile_path?: string | null
}

/** Bloco `credits` (cast/crew) de filme/serie. */
export interface TmdbCredits {
  cast?: TmdbCastCredit[]
  crew?: TmdbCrewCredit[]
}

/** Detalhe de filme (`GET /movie/{id}`). */
export interface TmdbMovieDetail {
  id: number
  imdb_id?: string | null
  original_title?: string | null
  title?: string | null
  original_language?: string | null
  release_date?: string | null
  runtime?: number | null
  status?: string | null
  popularity?: number | null
  vote_average?: number | null
  vote_count?: number | null
  poster_path?: string | null
  backdrop_path?: string | null
  external_ids?: TmdbExternalIds
  credits?: TmdbCredits
  recommendations?: TmdbRelatedTitlesBlock
  similar?: TmdbRelatedTitlesBlock
  genres?: TmdbGenreRef[]
}

/** Resumo de temporada embutido no detalhe da serie (`tv.seasons[]`). */
export interface TmdbSeasonSummary {
  id?: number | null
  season_number: number
  name?: string | null
  overview?: string | null
  air_date?: string | null
  episode_count?: number | null
  poster_path?: string | null
}

/** Detalhe de serie (`GET /tv/{id}`). */
export interface TmdbTvDetail {
  id: number
  original_name?: string | null
  name?: string | null
  original_language?: string | null
  first_air_date?: string | null
  last_air_date?: string | null
  status?: string | null
  number_of_seasons?: number | null
  number_of_episodes?: number | null
  popularity?: number | null
  vote_average?: number | null
  vote_count?: number | null
  poster_path?: string | null
  backdrop_path?: string | null
  external_ids?: TmdbExternalIds
  credits?: TmdbCredits
  seasons?: TmdbSeasonSummary[]
  recommendations?: TmdbRelatedTitlesBlock
  similar?: TmdbRelatedTitlesBlock
  genres?: TmdbGenreRef[]
}

/** Episodio dentro do detalhe de temporada (`season.episodes[]`). */
export interface TmdbEpisodeSummary {
  id?: number | null
  episode_number: number
  name?: string | null
  overview?: string | null
  air_date?: string | null
  runtime?: number | null
  still_path?: string | null
}

/** Detalhe de temporada (`GET /tv/{id}/season/{n}`). */
export interface TmdbSeasonDetail {
  id?: number | null
  season_number: number
  name?: string | null
  overview?: string | null
  air_date?: string | null
  poster_path?: string | null
  episodes?: TmdbEpisodeSummary[]
}

/** Detalhe de episodio (`GET /tv/{id}/season/{n}/episode/{e}`). */
export interface TmdbEpisodeDetail {
  id?: number | null
  episode_number: number
  season_number?: number | null
  name?: string | null
  overview?: string | null
  air_date?: string | null
  runtime?: number | null
  still_path?: string | null
  external_ids?: TmdbExternalIds
  credits?: TmdbCredits
}

/** Detalhe de pessoa (`GET /person/{id}`). */
export interface TmdbPersonDetail {
  id: number
  imdb_id?: string | null
  name?: string | null
  known_for_department?: string | null
  gender?: number | null
  birthday?: string | null
  deathday?: string | null
  place_of_birth?: string | null
  profile_path?: string | null
  /**
   * Biografia crua. Campo de primeiro nivel do detalhe de pessoa — sempre
   * chegou; faltava a coluna do outro lado, nao o dado.
   */
  biography?: string | null
  external_ids?: TmdbExternalIds
}

/**
 * Item de filme em respostas de LISTA do TMDB (ex.: `GET /movie/upcoming`).
 * Subset defensivo: so os campos de CATALOGO que a ingestao usa para descobrir
 * ids e alimentar "Em breve" (release_date/poster/backdrop). NAO e fonte
 * editorial — nenhum campo de nota/critica/streaming.
 */
export interface TmdbMovieListItem {
  id: number
  title?: string | null
  original_title?: string | null
  release_date?: string | null
  poster_path?: string | null
  backdrop_path?: string | null
}

/** Resposta paginada de lista de filmes (ex.: `GET /movie/upcoming`). */
export interface TmdbMoviePage {
  page?: number | null
  results?: TmdbMovieListItem[]
  total_pages?: number | null
  total_results?: number | null
}
