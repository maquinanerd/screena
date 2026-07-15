/**
 * catalog.ts — Endpoints TIPADOS de CATALOGO do TMDB (Fase 6): configuracao,
 * taxonomias, listas, discover, busca e changes.
 *
 * Cada metodo monta path + params e delega ao `TmdbHttpClient` (que aplica
 * throttle/retry/breaker). Diferente de `endpoints.ts` (detalhe por entidade com
 * append_to_response), aqui estao os endpoints de descoberta/catalogo. Todos GET,
 * worker-only. Discover valida filtros contra um allowlist e serializa de forma
 * DETERMINISTA (chaves ordenadas) — filtro desconhecido e rejeitado.
 *
 * Validadores de envelope (puros) ficam ao lado dos DTOs de transporte: o worker
 * valida a resposta antes de normalizar; campos desconhecidos sao preservados no
 * raw capture, nunca descartados silenciosamente.
 */

import type { TmdbConfig } from './config.js'
import type { TmdbHttpClient, TmdbQueryParams } from './http.js'
import type { TmdbMoviePage } from './types.js'
import type {
  TmdbCertificationList,
  TmdbChangesPage,
  TmdbConfiguration,
  TmdbCountry,
  TmdbGenreList,
  TmdbImagesResponse,
  TmdbJobDepartment,
  TmdbLanguage,
  TmdbMultiPage,
  TmdbPersonPage,
  TmdbTvPage,
  TmdbVideosResponse,
} from './catalog-types.js'

/** Tipos de mídia agregada aceitos por `/trending/{media_type}/{time_window}`. */
export type TrendingMediaType = 'movie' | 'tv' | 'person' | 'all'
/** Janelas de tendência aceitas. */
export type TrendingTimeWindow = 'day' | 'week'

const TRENDING_MEDIA_TYPES: ReadonlySet<string> = new Set(['movie', 'tv', 'person', 'all'])
const TRENDING_TIME_WINDOWS: ReadonlySet<string> = new Set(['day', 'week'])

/** Erro de uso do client de catalogo (ex.: filtro discover desconhecido, query vazia). */
export class TmdbCatalogError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TmdbCatalogError'
  }
}

/** Params comuns de lista (language/region/page). region so e enviado se fornecido. */
export interface CatalogListParams {
  language?: string
  region?: string
  page?: number
}

/** Params de busca (query obrigatoria; demais opcionais). */
export interface SearchParams {
  language?: string
  page?: number
  region?: string
  include_adult?: boolean
  year?: number
  first_air_date_year?: number
}

/** Params de changes (janela + pagina). Datas em `YYYY-MM-DD`. */
export interface ChangesParams {
  start_date?: string
  end_date?: string
  page?: number
}

/** Filtros aceitos por `discover` de filme (allowlist — o resto e rejeitado). */
export interface DiscoverMovieParams {
  language?: string
  region?: string
  page?: number
  sort_by?: string
  include_adult?: boolean
  include_video?: boolean
  with_genres?: string
  without_genres?: string
  with_original_language?: string
  primary_release_year?: number
  year?: number
  'primary_release_date.gte'?: string
  'primary_release_date.lte'?: string
  'release_date.gte'?: string
  'release_date.lte'?: string
  'vote_average.gte'?: number
  'vote_average.lte'?: number
  'vote_count.gte'?: number
  'with_runtime.gte'?: number
  'with_runtime.lte'?: number
  with_watch_providers?: string
  watch_region?: string
  with_watch_monetization_types?: string
  with_companies?: string
  with_keywords?: string
  without_keywords?: string
  with_people?: string
  with_cast?: string
  with_crew?: string
}

/** Filtros aceitos por `discover` de serie (allowlist). */
export interface DiscoverTvParams {
  language?: string
  page?: number
  sort_by?: string
  with_genres?: string
  without_genres?: string
  with_original_language?: string
  first_air_date_year?: number
  'first_air_date.gte'?: string
  'first_air_date.lte'?: string
  'air_date.gte'?: string
  'air_date.lte'?: string
  'vote_average.gte'?: number
  'vote_count.gte'?: number
  'with_runtime.gte'?: number
  'with_runtime.lte'?: number
  with_networks?: string
  with_companies?: string
  with_keywords?: string
  without_keywords?: string
  with_watch_providers?: string
  watch_region?: string
  with_watch_monetization_types?: string
  include_null_first_air_dates?: boolean
  screened_theatrically?: boolean
  timezone?: string
}

const DISCOVER_MOVIE_KEYS: ReadonlySet<string> = new Set([
  'language', 'region', 'page', 'sort_by', 'include_adult', 'include_video',
  'with_genres', 'without_genres', 'with_original_language', 'primary_release_year', 'year',
  'primary_release_date.gte', 'primary_release_date.lte', 'release_date.gte', 'release_date.lte',
  'vote_average.gte', 'vote_average.lte', 'vote_count.gte', 'with_runtime.gte', 'with_runtime.lte',
  'with_watch_providers', 'watch_region', 'with_watch_monetization_types', 'with_companies',
  'with_keywords', 'without_keywords', 'with_people', 'with_cast', 'with_crew',
])

const DISCOVER_TV_KEYS: ReadonlySet<string> = new Set([
  'language', 'page', 'sort_by', 'with_genres', 'without_genres', 'with_original_language',
  'first_air_date_year', 'first_air_date.gte', 'first_air_date.lte', 'air_date.gte', 'air_date.lte',
  'vote_average.gte', 'vote_count.gte', 'with_runtime.gte', 'with_runtime.lte', 'with_networks',
  'with_companies', 'with_keywords', 'without_keywords', 'with_watch_providers', 'watch_region',
  'with_watch_monetization_types', 'include_null_first_air_dates', 'screened_theatrically', 'timezone',
])

/** Converte um valor de param para o tipo aceito pela query (boolean -> string). */
function toQueryValue(value: unknown): string | number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return value
  return String(value)
}

/** Monta um `TmdbQueryParams` com chaves ORDENADAS (serializacao determinista). */
function sortedParams(entries: Array<[string, unknown]>): TmdbQueryParams {
  const out: TmdbQueryParams = {}
  const sorted = [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  for (const [key, raw] of sorted) {
    const value = toQueryValue(raw)
    if (value !== undefined) out[key] = value
  }
  return out
}

/** Params de lista: language default do config; region opcional; page default 1. */
function listParams(config: TmdbConfig, params: CatalogListParams): TmdbQueryParams {
  return sortedParams([
    ['language', params.language ?? config.defaultLanguage],
    ['region', params.region],
    ['page', params.page ?? 1],
  ])
}

/** Valida filtros de discover contra o allowlist e serializa de forma determinista. */
function discoverParams(
  config: TmdbConfig,
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): TmdbQueryParams {
  const entries: Array<[string, unknown]> = [
    ['language', input.language ?? config.defaultLanguage],
    ['page', input.page ?? 1],
  ]
  for (const [key, value] of Object.entries(input)) {
    if (key === 'language' || key === 'page') continue
    if (value === undefined) continue
    if (!allowed.has(key)) {
      throw new TmdbCatalogError(`filtro discover desconhecido rejeitado: ${key}`)
    }
    entries.push([key, value])
  }
  return sortedParams(entries)
}

/** Params de busca: query obrigatoria e nao-vazia; language default do config. */
function searchParams(config: TmdbConfig, query: string, params: SearchParams): TmdbQueryParams {
  const q = query.trim()
  if (q === '') throw new TmdbCatalogError('busca TMDB exige query nao-vazia.')
  return sortedParams([
    ['query', q],
    ['language', params.language ?? config.defaultLanguage],
    ['region', params.region],
    ['page', params.page ?? 1],
    ['include_adult', params.include_adult],
    ['year', params.year],
    ['first_air_date_year', params.first_air_date_year],
  ])
}

/** Conjunto de endpoints de catalogo TMDB. */
export interface TmdbCatalogEndpoints {
  getConfiguration(): Promise<TmdbConfiguration>
  getCountries(): Promise<TmdbCountry[]>
  getLanguages(): Promise<TmdbLanguage[]>
  getJobs(): Promise<TmdbJobDepartment[]>
  getMovieGenres(language?: string): Promise<TmdbGenreList>
  getTvGenres(language?: string): Promise<TmdbGenreList>
  getMovieCertifications(): Promise<TmdbCertificationList>
  getTvCertifications(): Promise<TmdbCertificationList>
  getPopularMovies(params?: CatalogListParams): Promise<TmdbMoviePage>
  getTopRatedMovies(params?: CatalogListParams): Promise<TmdbMoviePage>
  getNowPlayingMovies(params?: CatalogListParams): Promise<TmdbMoviePage>
  getPopularTvShows(params?: CatalogListParams): Promise<TmdbTvPage>
  getTopRatedTvShows(params?: CatalogListParams): Promise<TmdbTvPage>
  getAiringTodayTvShows(params?: CatalogListParams): Promise<TmdbTvPage>
  getOnTheAirTvShows(params?: CatalogListParams): Promise<TmdbTvPage>
  getMovieChanges(params?: ChangesParams): Promise<TmdbChangesPage>
  getTvChanges(params?: ChangesParams): Promise<TmdbChangesPage>
  getPersonChanges(params?: ChangesParams): Promise<TmdbChangesPage>
  discoverMovies(params?: DiscoverMovieParams): Promise<TmdbMoviePage>
  discoverTvShows(params?: DiscoverTvParams): Promise<TmdbTvPage>
  searchMovies(query: string, params?: SearchParams): Promise<TmdbMoviePage>
  searchTvShows(query: string, params?: SearchParams): Promise<TmdbTvPage>
  searchPeople(query: string, params?: SearchParams): Promise<TmdbPersonPage>
  searchMulti(query: string, params?: SearchParams): Promise<TmdbMultiPage>
  getTrending(
    mediaType: TrendingMediaType,
    timeWindow: TrendingTimeWindow,
    params?: { page?: number; language?: string },
  ): Promise<TmdbMultiPage>
  getMovieImages(tmdbId: number): Promise<TmdbImagesResponse>
  getTvImages(tmdbId: number): Promise<TmdbImagesResponse>
  getSeasonImages(tvTmdbId: number, seasonNumber: number): Promise<TmdbImagesResponse>
  getEpisodeImages(tvTmdbId: number, seasonNumber: number, episodeNumber: number): Promise<TmdbImagesResponse>
  getPersonImages(tmdbId: number): Promise<TmdbImagesResponse>
  getMovieVideos(tmdbId: number): Promise<TmdbVideosResponse>
  getTvVideos(tmdbId: number): Promise<TmdbVideosResponse>
  getSeasonVideos(tvTmdbId: number, seasonNumber: number): Promise<TmdbVideosResponse>
  getEpisodeVideos(tvTmdbId: number, seasonNumber: number, episodeNumber: number): Promise<TmdbVideosResponse>
}

/** Cria os endpoints de catalogo sobre um `TmdbHttpClient` ja configurado. */
export function createTmdbCatalogEndpoints(
  client: TmdbHttpClient,
  config: TmdbConfig,
): TmdbCatalogEndpoints {
  const language = config.defaultLanguage
  return {
    async getConfiguration() {
      return (await client.request('/configuration')) as TmdbConfiguration
    },
    async getCountries() {
      return (await client.request('/configuration/countries', { language })) as TmdbCountry[]
    },
    async getLanguages() {
      return (await client.request('/configuration/languages')) as TmdbLanguage[]
    },
    async getJobs() {
      return (await client.request('/configuration/jobs')) as TmdbJobDepartment[]
    },
    async getMovieGenres(lang) {
      return (await client.request('/genre/movie/list', { language: lang ?? language })) as TmdbGenreList
    },
    async getTvGenres(lang) {
      return (await client.request('/genre/tv/list', { language: lang ?? language })) as TmdbGenreList
    },
    async getMovieCertifications() {
      return (await client.request('/certification/movie/list')) as TmdbCertificationList
    },
    async getTvCertifications() {
      return (await client.request('/certification/tv/list')) as TmdbCertificationList
    },
    async getPopularMovies(params = {}) {
      return (await client.request('/movie/popular', listParams(config, params))) as TmdbMoviePage
    },
    async getTopRatedMovies(params = {}) {
      return (await client.request('/movie/top_rated', listParams(config, params))) as TmdbMoviePage
    },
    async getNowPlayingMovies(params = {}) {
      return (await client.request('/movie/now_playing', listParams(config, params))) as TmdbMoviePage
    },
    async getPopularTvShows(params = {}) {
      return (await client.request('/tv/popular', listParams(config, params))) as TmdbTvPage
    },
    async getTopRatedTvShows(params = {}) {
      return (await client.request('/tv/top_rated', listParams(config, params))) as TmdbTvPage
    },
    async getAiringTodayTvShows(params = {}) {
      return (await client.request('/tv/airing_today', listParams(config, params))) as TmdbTvPage
    },
    async getOnTheAirTvShows(params = {}) {
      return (await client.request('/tv/on_the_air', listParams(config, params))) as TmdbTvPage
    },
    async getMovieChanges(params = {}) {
      return (await client.request('/movie/changes', changeParams(params))) as TmdbChangesPage
    },
    async getTvChanges(params = {}) {
      return (await client.request('/tv/changes', changeParams(params))) as TmdbChangesPage
    },
    async getPersonChanges(params = {}) {
      return (await client.request('/person/changes', changeParams(params))) as TmdbChangesPage
    },
    async discoverMovies(params = {}) {
      return (await client.request(
        '/discover/movie',
        discoverParams(config, params as Record<string, unknown>, DISCOVER_MOVIE_KEYS),
      )) as TmdbMoviePage
    },
    async discoverTvShows(params = {}) {
      return (await client.request(
        '/discover/tv',
        discoverParams(config, params as Record<string, unknown>, DISCOVER_TV_KEYS),
      )) as TmdbTvPage
    },
    async searchMovies(query, params = {}) {
      return (await client.request('/search/movie', searchParams(config, query, params))) as TmdbMoviePage
    },
    async searchTvShows(query, params = {}) {
      return (await client.request('/search/tv', searchParams(config, query, params))) as TmdbTvPage
    },
    async searchPeople(query, params = {}) {
      return (await client.request('/search/person', searchParams(config, query, params))) as TmdbPersonPage
    },
    async searchMulti(query, params = {}) {
      return (await client.request('/search/multi', searchParams(config, query, params))) as TmdbMultiPage
    },
    async getTrending(mediaType, timeWindow, params = {}) {
      if (!TRENDING_MEDIA_TYPES.has(mediaType)) {
        throw new TmdbCatalogError(`trending media_type invalido: ${mediaType}`)
      }
      if (!TRENDING_TIME_WINDOWS.has(timeWindow)) {
        throw new TmdbCatalogError(`trending time_window invalido: ${timeWindow}`)
      }
      const data = await client.request(`/trending/${mediaType}/${timeWindow}`, {
        language: params.language ?? language,
        page: params.page ?? 1,
      })
      return data as TmdbMultiPage
    },
    async getMovieImages(tmdbId) {
      return (await client.request(`/movie/${tmdbId}/images`)) as TmdbImagesResponse
    },
    async getTvImages(tmdbId) {
      return (await client.request(`/tv/${tmdbId}/images`)) as TmdbImagesResponse
    },
    async getSeasonImages(tvTmdbId, seasonNumber) {
      return (await client.request(`/tv/${tvTmdbId}/season/${seasonNumber}/images`)) as TmdbImagesResponse
    },
    async getEpisodeImages(tvTmdbId, seasonNumber, episodeNumber) {
      return (await client.request(
        `/tv/${tvTmdbId}/season/${seasonNumber}/episode/${episodeNumber}/images`,
      )) as TmdbImagesResponse
    },
    async getPersonImages(tmdbId) {
      return (await client.request(`/person/${tmdbId}/images`)) as TmdbImagesResponse
    },
    async getMovieVideos(tmdbId) {
      return (await client.request(`/movie/${tmdbId}/videos`)) as TmdbVideosResponse
    },
    async getTvVideos(tmdbId) {
      return (await client.request(`/tv/${tmdbId}/videos`)) as TmdbVideosResponse
    },
    async getSeasonVideos(tvTmdbId, seasonNumber) {
      return (await client.request(`/tv/${tvTmdbId}/season/${seasonNumber}/videos`)) as TmdbVideosResponse
    },
    async getEpisodeVideos(tvTmdbId, seasonNumber, episodeNumber) {
      return (await client.request(
        `/tv/${tvTmdbId}/season/${seasonNumber}/episode/${episodeNumber}/videos`,
      )) as TmdbVideosResponse
    },
  }
}

/** Params de changes: so inclui o que foi fornecido; page default 1. */
function changeParams(params: ChangesParams): TmdbQueryParams {
  return sortedParams([
    ['start_date', params.start_date],
    ['end_date', params.end_date],
    ['page', params.page ?? 1],
  ])
}

/* ------------------------------------------------------------------ */
/* Validadores de envelope (puros) — usados pelo worker e pelos testes */
/* ------------------------------------------------------------------ */

/** Resultado de validacao de contrato: ok + lista de erros legiveis. */
export interface ContractResult {
  readonly ok: boolean
  readonly errors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Valida o envelope de uma pagina TMDB (results[]/page/total_pages/total_results). */
export function validateTmdbPage(payload: unknown): ContractResult {
  const errors: string[] = []
  if (!isRecord(payload)) {
    return { ok: false, errors: ['pagina TMDB nao e um objeto.'] }
  }
  if (payload.results !== undefined && !Array.isArray(payload.results)) {
    errors.push('campo `results` presente mas nao e array.')
  }
  for (const key of ['page', 'total_pages', 'total_results'] as const) {
    const value = payload[key]
    if (value !== undefined && value !== null && typeof value !== 'number') {
      errors.push(`campo \`${key}\` presente mas nao e number.`)
    }
  }
  if (Array.isArray(payload.results)) {
    for (const item of payload.results) {
      if (!isRecord(item) || typeof item.id !== 'number') {
        errors.push('item de `results` sem `id` numerico.')
        break
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

/** Valida o envelope de `/configuration` (bloco `images` com base URLs). */
export function validateTmdbConfiguration(payload: unknown): ContractResult {
  const errors: string[] = []
  if (!isRecord(payload)) return { ok: false, errors: ['configuration nao e um objeto.'] }
  const images = payload.images
  if (!isRecord(images)) {
    errors.push('configuration.images ausente ou invalido.')
  } else {
    if (typeof images.secure_base_url !== 'string' || images.secure_base_url === '') {
      errors.push('configuration.images.secure_base_url ausente.')
    }
    for (const key of ['poster_sizes', 'backdrop_sizes', 'still_sizes', 'profile_sizes', 'logo_sizes'] as const) {
      if (images[key] !== undefined && !Array.isArray(images[key])) {
        errors.push(`configuration.images.${key} nao e array.`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

/** Valida o envelope de `/genre/{movie,tv}/list` (genres[]). */
export function validateTmdbGenreList(payload: unknown): ContractResult {
  const errors: string[] = []
  if (!isRecord(payload)) return { ok: false, errors: ['genre list nao e um objeto.'] }
  if (!Array.isArray(payload.genres)) {
    errors.push('campo `genres` ausente ou nao e array.')
  } else {
    for (const g of payload.genres) {
      if (!isRecord(g) || typeof g.id !== 'number') {
        errors.push('genero sem `id` numerico.')
        break
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

/** Valida o envelope de `/certification/{movie,tv}/list` (map territorio -> lista). */
export function validateTmdbCertificationList(payload: unknown): ContractResult {
  const errors: string[] = []
  if (!isRecord(payload)) return { ok: false, errors: ['certification list nao e um objeto.'] }
  const certifications = payload.certifications
  if (!isRecord(certifications)) {
    errors.push('campo `certifications` ausente ou invalido.')
  } else {
    for (const [territory, list] of Object.entries(certifications)) {
      if (!Array.isArray(list)) {
        errors.push(`certifications[${territory}] nao e array.`)
        break
      }
    }
  }
  return { ok: errors.length === 0, errors }
}
