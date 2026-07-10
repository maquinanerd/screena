/**
 * provider.ts — Identidade do fornecedor TECNICO Film/Show Ratings.
 *
 * INVARIANTE 2: `provider_api` != `rating_source`. Esta chave e o fornecedor
 * tecnico que TRANSPORTA notas; ela NUNCA e a fonte editorial da nota. A fonte
 * real (imdb, rotten_tomatoes, metacritic, letterboxd, filmaffinity) e resolvida
 * pelo worker `services/ratings` a partir do payload, e nunca inferida daqui.
 */

/** Chave em `api_providers` (kind = ratings). */
export const FILM_SHOW_RATINGS_PROVIDER_API = 'rapidapi_film_show_ratings'

/** Host RapidAPI (header `x-rapidapi-host`). */
export const FILM_SHOW_RATINGS_DEFAULT_HOST = 'film-show-ratings.p.rapidapi.com'

/** Base URL padrao (sem barra final). */
export const FILM_SHOW_RATINGS_DEFAULT_BASE_URL = 'https://film-show-ratings.p.rapidapi.com'

/**
 * TTL padrao do `api_cache` para este provider: 24h.
 *
 * Nao ha documentacao publica de ritmo de atualizacao; 24h e o default
 * conservador definido no escopo desta fase.
 */
export const FILM_SHOW_RATINGS_DEFAULT_CACHE_TTL_MS = 86_400_000

/** Endpoint de populares. Aceita `type=film` | `type=show` | sem `type`. */
export const FILM_SHOW_RATINGS_POPULAR_ENDPOINT = '/popular/'

/** Tipos aceitos pelo parametro `type` de `/popular/`. */
export const FILM_SHOW_RATINGS_POPULAR_TYPES = ['film', 'show'] as const

/** Tipo derivado de um `type` valido de `/popular/`. */
export type FilmShowRatingsPopularType = (typeof FILM_SHOW_RATINGS_POPULAR_TYPES)[number]

/** `value` e um `type` valido de `/popular/`? */
export function isPopularType(value: string): value is FilmShowRatingsPopularType {
  return (FILM_SHOW_RATINGS_POPULAR_TYPES as readonly string[]).includes(value)
}
