/**
 * client.ts — Client offline do Streaming Availability (RapidAPI).
 *
 * WORKER-ONLY. Devolve o payload BRUTO (`unknown`); a normalizacao para
 * `watch_availability` acontece em `services/streaming`, com recusa explicita
 * de qualquer oferta que nao mapeie para uma modalidade LEGAL conhecida.
 */

import {
  buildCacheKey,
  RapidApiHttpClient,
  RapidApiConfigError,
  createRapidApiFetchTransport,
  type CacheKey,
  type QueryParams,
  type RapidApiClientConfig,
  type RapidApiHttpDeps,
} from '@screena/rapidapi-core'

import {
  isImdbId,
  STREAMING_AVAILABILITY_DEFAULT_OUTPUT_LANGUAGE,
  STREAMING_AVAILABILITY_DEFAULT_SERIES_GRANULARITY,
} from './provider.js'

/** Endpoint base de lookup por titulo. */
export const SHOWS_ENDPOINT_PREFIX = '/shows/'

/**
 * Parametros de uma consulta de disponibilidade.
 *
 * O contrato real e `GET /shows/{imdbId}?series_granularity=episode&output_language=en`.
 * NAO ha param `country`: o payload devolve `streamingOptions` por pais e o
 * filtro (BR) e feito no worker. `showId` e o IMDb id real da entidade.
 */
export interface ShowLookupInput {
  /** IMDb id real da entidade (`tt<digitos>`) — a chave da chamada nesta fase. */
  readonly showId: string
  /** Granularidade de series (default `episode`, como no contrato real). */
  readonly seriesGranularity?: string
  /** ISO 639-1 do texto de saida (default `en`, como no contrato real). */
  readonly outputLanguage?: string
}

/** Uma requisicao montada (sem segredo, sem execucao). */
export interface ShowRequest {
  readonly endpoint: string
  readonly params: QueryParams
  readonly cacheKey: CacheKey
}

/**
 * `showId` seguro para compor um path?
 *
 * Aceita SO `tt<digitos>` ou `movie/<digitos>` | `tv/<digitos>`. Qualquer outra
 * forma e recusada — isso impede path traversal / injecao de querystring vindas
 * de um id malformado (ex.: `../`, `?`, `#`).
 */
export function isSafeShowId(showId: string): boolean {
  return isImdbId(showId) || /^(?:movie|tv)\/\d+$/.test(showId)
}

/**
 * Monta (sem executar) a requisicao de
 * `GET /shows/{imdbId}?series_granularity=episode&output_language=en`.
 *
 * PURO — o dry-run usa isto para relatar o que SERIA chamado sem gastar cota.
 * Nao ha param `country`: o payload devolve todos os paises e o worker filtra BR.
 * A barra de `movie/278` (aceita pelo guard) e parte do path e nao e escapada,
 * mas a chamada canonica desta fase usa o IMDb id.
 *
 * @throws {RapidApiConfigError} Se `showId` nao for uma forma reconhecida.
 */
export function buildShowRequest(input: ShowLookupInput): ShowRequest {
  if (!isSafeShowId(input.showId)) {
    throw new RapidApiConfigError(
      `showId invalido: "${input.showId}". Use "tt<digitos>", "movie/<id>" ou "tv/<id>".`,
    )
  }
  const endpoint = `${SHOWS_ENDPOINT_PREFIX}${input.showId}`
  const params: QueryParams = {
    series_granularity:
      input.seriesGranularity ?? STREAMING_AVAILABILITY_DEFAULT_SERIES_GRANULARITY,
    output_language: input.outputLanguage ?? STREAMING_AVAILABILITY_DEFAULT_OUTPUT_LANGUAGE,
  }
  return { endpoint, params, cacheKey: buildCacheKey(endpoint, params) }
}

/** Client offline do Streaming Availability. */
export class StreamingAvailabilityClient {
  private readonly http: RapidApiHttpClient

  constructor(config: RapidApiClientConfig, deps: RapidApiHttpDeps) {
    this.http = new RapidApiHttpClient(config, deps)
  }

  /**
   * `GET /shows/{imdbId}?series_granularity=episode&output_language=en` — payload
   * cru, sem normalizacao. A `x-rapidapi-key` viaja so em header (nunca na URL).
   */
  async getShow(input: ShowLookupInput): Promise<unknown> {
    const request = buildShowRequest(input)
    return this.http.request(request.endpoint, request.params)
  }

  /** Requisicoes HTTP efetivamente disparadas (inclui retries) — `quota_cost`. */
  getRequestCount(): number {
    return this.http.getRequestCount()
  }

  /** O circuito deste provider esta aberto? */
  isCircuitOpen(): boolean {
    return this.http.isCircuitOpen()
  }
}

/** Cria o client com o transporte `fetch` real (timeout da config). */
export function createStreamingAvailabilityClient(
  config: RapidApiClientConfig,
): StreamingAvailabilityClient {
  return new StreamingAvailabilityClient(config, {
    transport: createRapidApiFetchTransport(config.timeoutMs),
  })
}
