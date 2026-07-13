/**
 * provider.ts — Identidade do fornecedor TECNICO Streaming Availability.
 *
 * Fonte: Streaming Availability API (Movie of the Night), consumida via RapidAPI.
 * Contrato REAL de lookup por titulo (v4):
 *   `GET /shows/{imdbId}?series_granularity=episode&output_language=en`.
 * A chave da chamada nesta fase e o **IMDb id real** (`tt<digitos>`) da
 * entidade local (vindo de `entity_external_ids`); NAO usamos titulo nem o TMDB
 * id como chave da chamada. O payload devolve `streamingOptions` agrupado por
 * pais — o filtro por pais (BR) acontece no worker, nao na querystring.
 *
 * Docs: https://docs.movieofthenight.com/guide/shows
 *
 * ATRIBUICAO: os termos exigem creditar "Streaming Availability API by Movie of
 * the Night" com link para https://www.movieofthenight.com/about/api sempre que
 * o dado for EXIBIDO. Por isso, nesta fase, tudo nasce com
 * `display_allowed = false` — nada e exibido antes da etapa de licenca/atribuicao.
 */

/** Chave em `api_providers` (kind = streaming). Ja existe no seed. */
export const STREAMING_AVAILABILITY_PROVIDER_API = 'streaming_availability'

/** Host RapidAPI (header `x-rapidapi-host`). */
export const STREAMING_AVAILABILITY_DEFAULT_HOST = 'streaming-availability.p.rapidapi.com'

/** Base URL padrao no RapidAPI (sem sufixo de versao: a key ja fixa a versao). */
export const STREAMING_AVAILABILITY_DEFAULT_BASE_URL = 'https://streaming-availability.p.rapidapi.com'

/** TTL padrao do `api_cache`: 24h (a documentacao indica atualizacao diaria). */
export const STREAMING_AVAILABILITY_DEFAULT_CACHE_TTL_MS = 86_400_000

/** Pais padrao desta fase (filtro aplicado no worker, nunca na querystring). */
export const STREAMING_AVAILABILITY_DEFAULT_COUNTRY = 'BR'

/**
 * Granularidade de series pedida ao upstream. O contrato real usa `episode`;
 * para filme e inocuo, mas mantemos exatamente o que a doc/cURL especifica.
 */
export const STREAMING_AVAILABILITY_DEFAULT_SERIES_GRANULARITY = 'episode'

/** Idioma do texto de saida do upstream (o contrato real usa `en`). */
export const STREAMING_AVAILABILITY_DEFAULT_OUTPUT_LANGUAGE = 'en'

/** Texto de atribuicao exigido pelos termos (usado so quando a licenca liberar). */
export const STREAMING_AVAILABILITY_ATTRIBUTION_TEXT =
  'Disponibilidade de streaming fornecida por Streaming Availability API by Movie of the Night'

/** Link de atribuicao exigido pelos termos. */
export const STREAMING_AVAILABILITY_ATTRIBUTION_URL = 'https://www.movieofthenight.com/about/api'

/** Tipo de entidade suportado nesta fase (nao busca pessoa/temporada/episodio). */
export const STREAMING_AVAILABILITY_KINDS = ['movie', 'tv'] as const

/** Tipo derivado de um `kind` suportado. */
export type StreamingAvailabilityKind = (typeof STREAMING_AVAILABILITY_KINDS)[number]

/** `value` e um `kind` suportado? */
export function isStreamingKind(value: string): value is StreamingAvailabilityKind {
  return (STREAMING_AVAILABILITY_KINDS as readonly string[]).includes(value)
}

/**
 * Segmento TMDB usado no `id` de `/shows/{id}`.
 *
 * A API usa `movie/<id>` para filme e `tv/<id>` para serie — os mesmos rotulos
 * do nosso `EntityType`, por coincidencia feliz.
 */
export function tmdbShowId(kind: StreamingAvailabilityKind, tmdbId: number): string {
  return `${kind}/${tmdbId}`
}

/** Um IMDb id valido (`tt` + digitos). */
export function isImdbId(value: string): boolean {
  return /^tt\d+$/.test(value)
}
