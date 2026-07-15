/**
 * catalog-types.ts — DTOs de TRANSPORTE das respostas de catalogo do TMDB
 * (configuracao, taxonomias, discover, busca, listas e changes).
 *
 * Igual a `types.ts`: NAO e o schema completo do TMDB — apenas o subset que a
 * ingestao usa, com todos os campos opcionais/defensivos (o TMDB pode omitir
 * campos; os normalizers/validators tratam ausencia sem inventar dado). Estes sao
 * DTOs de transporte (raw), distintos do modelo Prisma persistido.
 */

/* ------------------------------------------------------------------ */
/* Configuracao (/configuration)                                       */
/* ------------------------------------------------------------------ */

/** Bloco `images` do `/configuration`. */
export interface TmdbImagesConfig {
  base_url?: string | null
  secure_base_url?: string | null
  poster_sizes?: string[]
  backdrop_sizes?: string[]
  still_sizes?: string[]
  profile_sizes?: string[]
  logo_sizes?: string[]
}

/** Resposta de `GET /configuration`. */
export interface TmdbConfiguration {
  images?: TmdbImagesConfig
  change_keys?: string[]
}

/* ------------------------------------------------------------------ */
/* Taxonomias auxiliares                                               */
/* ------------------------------------------------------------------ */

/** Item de `GET /configuration/countries`. */
export interface TmdbCountry {
  iso_3166_1: string
  english_name?: string | null
  native_name?: string | null
}

/** Item de `GET /configuration/languages`. */
export interface TmdbLanguage {
  iso_639_1: string
  english_name?: string | null
  name?: string | null
}

/** Item de `GET /configuration/jobs`. */
export interface TmdbJobDepartment {
  department: string
  jobs?: string[]
}

/** Um genero (`GET /genre/{movie,tv}/list`). */
export interface TmdbGenre {
  id: number
  name?: string | null
}

/** Resposta de `GET /genre/{movie,tv}/list`. */
export interface TmdbGenreList {
  genres?: TmdbGenre[]
}

/** Uma classificacao indicativa por territorio. */
export interface TmdbCertification {
  certification: string
  meaning?: string | null
  order?: number | null
}

/** Resposta de `GET /certification/{movie,tv}/list` (mapa territorio -> lista). */
export interface TmdbCertificationList {
  certifications?: Record<string, TmdbCertification[]>
}

/* ------------------------------------------------------------------ */
/* Paginas de lista / discover / busca / changes                       */
/* ------------------------------------------------------------------ */

/** Item de serie em respostas de LISTA/discover/busca. */
export interface TmdbTvListItem {
  id: number
  name?: string | null
  original_name?: string | null
  first_air_date?: string | null
  poster_path?: string | null
  backdrop_path?: string | null
}

/** Resposta paginada de series. */
export interface TmdbTvPage {
  page?: number | null
  results?: TmdbTvListItem[]
  total_pages?: number | null
  total_results?: number | null
}

/** Item de pessoa em respostas de busca. */
export interface TmdbPersonListItem {
  id: number
  name?: string | null
  profile_path?: string | null
  known_for_department?: string | null
}

/** Resposta paginada de pessoas. */
export interface TmdbPersonPage {
  page?: number | null
  results?: TmdbPersonListItem[]
  total_pages?: number | null
  total_results?: number | null
}

/** Item de multi-busca (media_type discrimina filme/serie/pessoa). */
export interface TmdbMultiListItem {
  id: number
  media_type?: string | null
  title?: string | null
  name?: string | null
}

/** Resposta paginada de multi-busca. */
export interface TmdbMultiPage {
  page?: number | null
  results?: TmdbMultiListItem[]
  total_pages?: number | null
  total_results?: number | null
}

/** Item de `GET /{movie,tv,person}/changes` (ids alterados na janela). */
export interface TmdbChangeItem {
  id: number
  adult?: boolean | null
}

/** Resposta paginada de changes. */
export interface TmdbChangesPage {
  page?: number | null
  results?: TmdbChangeItem[]
  total_pages?: number | null
  total_results?: number | null
}
