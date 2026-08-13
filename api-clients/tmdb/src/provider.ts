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

/**
 * ============ ATRIBUICAO DO "ONDE ASSISTIR": JustWatch, NAO TMDB ============
 *
 * O sub-recurso `watch/providers` NAO e dado do TMDB: o TMDB o revende, e a
 * fonte e o **JustWatch**. Os termos do endpoint sao explicitos e a sancao e
 * nominal:
 *
 *   "In order to use this data you must attribute the source of the data as
 *    JustWatch. If we find any usage not complying with these terms we will
 *    revoke access to the API."
 *
 * POR QUE ISTO E CRITICO ALEM DESTE BLOCO: o acesso ao TMDB e a fundacao do
 * catalogo inteiro (fichas, elenco, imagens, temporadas). Creditar errado aqui
 * nao arrisca so o painel de streaming — arrisca a API que sustenta o site.
 *
 * POR QUE NAO REUSAR O CREDITO DO AGREGADOR: `streaming_availability` (Movie of
 * the Night) e um fornecedor DIFERENTE, com dado diferente e credito diferente.
 * Reusar aquele texto num dado vindo do TMDB nao seria credito faltando — seria
 * **proveniencia falsa**, que e pior, porque afirma uma origem que nao e a
 * verdadeira. Cada fornecedor tecnico carrega o seu proprio credito.
 *
 * SEPARACAO QUE NAO PODE COLAPSAR: este URL e a ATRIBUICAO (quem forneceu a
 * disponibilidade). Ele nao e o destino da oferta — esse e o `link` por PAIS do
 * proprio payload, que vai para `watch_availability.web_url`. Sao dois campos,
 * dois propositos; confundi-los faria o credito virar CTA ou o CTA virar credito.
 */

/** Fonte editorial REAL do bloco `watch/providers` (nunca "TMDB"). */
export const TMDB_WATCH_DATA_SOURCE = 'JustWatch'

/** Texto de credito exibido junto ao painel de streaming de origem TMDB. */
export const TMDB_WATCH_ATTRIBUTION_TEXT = 'Disponibilidade fornecida por JustWatch'

/** Linkback do credito: a fonte do dado, nao o destino da oferta. */
export const TMDB_WATCH_ATTRIBUTION_URL = 'https://www.justwatch.com/'

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
