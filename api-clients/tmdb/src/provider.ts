/**
 * provider.ts — Constantes e helpers de identidade do TMDB.
 *
 * TMDB e um `provider_api` (fornecedor tecnico, kind=data), NUNCA um
 * `rating_source` (fonte editorial).
 *
 * Dois conceitos DISTINTOS — nao confundir:
 *  - `TMDB_PROVIDER_API = 'tmdb'`: chave do fornecedor tecnico, usada APENAS em
 *    `api_cache.provider_api`, `api_sync_logs.provider_api` e `api_providers.key`.
 *  - `tmdbExternalIdSource(kind)` -> `tmdb_movie` / `tmdb_tv` / `tmdb_person`:
 *    namespace de `entity_external_ids.source`. NUNCA e o provider tecnico.
 */

/**
 * Chave do fornecedor tecnico TMDB (api_providers.key, kind=data). Usada SO em
 * `api_cache`, `api_sync_logs` e `api_providers` — NUNCA em
 * `entity_external_ids.source` (esse usa o namespace `tmdbExternalIdSource`).
 */
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

/**
 * Namespace de `entity_external_ids.source` por tipo: `tmdb_movie` / `tmdb_tv` /
 * `tmdb_person`.
 *
 * O TMDB usa espacos de id SEPARADOS por entidade (um filme e uma serie podem
 * ter o mesmo `tmdb_id`). Como `entity_external_ids` tem unique
 * `(source, external_id)`, um unico `'tmdb'` colidiria entre tipos; o namespace
 * evita a colisao. Isto e SEPARADO de `TMDB_PROVIDER_API='tmdb'` (provider
 * tecnico de `api_cache`/`api_sync_logs`/`api_providers`) — nao confundir os dois.
 */
export function tmdbExternalIdSource(kind: TmdbEntityKind): string {
  return `tmdb_${kind}`
}
