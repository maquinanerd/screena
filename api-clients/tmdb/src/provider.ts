/**
 * provider.ts — Constantes e helpers de identidade do TMDB.
 *
 * TMDB e um `provider_api` (fornecedor tecnico, kind=data), NUNCA um
 * `rating_source` (fonte editorial). Esta constante e a chave usada em
 * `api_cache.provider_api`, `api_sync_logs.provider_api` e `entity_external_ids.source`.
 */

/** Chave do fornecedor tecnico TMDB (api_providers.key, kind=data). */
export const TMDB_PROVIDER_API = 'tmdb'

/** Base URL padrao da API TMDB v3. */
export const TMDB_DEFAULT_BASE_URL = 'https://api.themoviedb.org/3'

/** Tipos de entidade TMDB que sabemos mapear para URLs canonicas. */
export type TmdbEntityKind = 'movie' | 'tv' | 'person'

/** URL canonica publica da entidade no themoviedb.org (para entity_external_ids.url). */
export function tmdbWebUrl(kind: TmdbEntityKind, tmdbId: number): string {
  return `https://www.themoviedb.org/${kind}/${tmdbId}`
}

/**
 * URL canonica de um identificador IMDb (apenas referencia; IMDb NAO e rating aqui).
 * Ids de titulo comecam com 'tt' (/title/); ids de pessoa com 'nm' (/name/).
 */
export function imdbWebUrl(imdbId: string): string {
  const segment = imdbId.startsWith('nm') ? 'name' : 'title'
  return `https://www.imdb.com/${segment}/${imdbId}/`
}
