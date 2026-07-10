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

/**
 * Endpoint de populares. Aceita `type=film` | `type=show` | sem `type`.
 *
 * NOTA (plano Pro): `/popular/` NAO e liberado no plano contratado — retorna 403.
 * O worker de enriquecimento usa `/item/?id=<IMDb>` (liberado). Este endpoint e
 * mantido apenas por retrocompatibilidade do client/testes; o fluxo novo nao o
 * chama por padrao.
 */
export const FILM_SHOW_RATINGS_POPULAR_ENDPOINT = '/popular/'

/**
 * Endpoint de item unico: `GET /item/?id=<IMDb_ID>` (ex.: `id=tt9603208`).
 *
 * Liberado no plano Pro. Enriquece UMA entidade ja existente localmente,
 * resolvida por identificador inequivoco (IMDb id). Nunca casa por titulo/ano.
 */
export const FILM_SHOW_RATINGS_ITEM_ENDPOINT = '/item/'

/** Forma de um IMDb id aceito pelo `/item/`: `tt` + digitos. */
export const IMDB_ID_PATTERN = /^tt\d+$/

/**
 * `value` e um IMDb id valido (`tt<digitos>`)?
 *
 * Por enquanto o `/item/` so e chamado com IMDb id — o exemplo validado no
 * RapidAPI foi `id=tt9603208`. Suporte a TMDB id no request fica como TODO
 * (nao chutamos um formato nao validado). Fonte unica da forma do id, reusada
 * pelo parser de args e pelo worker.
 */
export function isImdbId(value: string): boolean {
  return IMDB_ID_PATTERN.test(value.trim())
}

/** Tipos aceitos pelo parametro `type` de `/popular/`. */
export const FILM_SHOW_RATINGS_POPULAR_TYPES = ['film', 'show'] as const

/** Tipo derivado de um `type` valido de `/popular/`. */
export type FilmShowRatingsPopularType = (typeof FILM_SHOW_RATINGS_POPULAR_TYPES)[number]

/** `value` e um `type` valido de `/popular/`? */
export function isPopularType(value: string): value is FilmShowRatingsPopularType {
  return (FILM_SHOW_RATINGS_POPULAR_TYPES as readonly string[]).includes(value)
}
