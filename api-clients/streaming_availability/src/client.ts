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

import { isImdbId } from './provider.js'

/** Endpoint base de lookup por titulo. */
export const SHOWS_ENDPOINT_PREFIX = '/shows/'

/** Parametros de uma consulta de disponibilidade. */
export interface ShowLookupInput {
  /** `tt0111161` (IMDb) ou `movie/278` | `tv/1396` (TMDB). */
  readonly showId: string
  /** ISO 3166-1 alpha-2 (ex.: `BR`). */
  readonly country: string
  /** ISO 639-1 do texto de saida (opcional). */
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
 * Monta (sem executar) a requisicao de `GET /shows/{id}`.
 *
 * PURO — o dry-run usa isto para relatar o que SERIA chamado sem gastar cota.
 * A barra de `movie/278` e parte do path (nao e escapada): a doc define o id
 * TMDB exatamente nesse formato.
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
    country: input.country,
    ...(input.outputLanguage === undefined ? {} : { output_language: input.outputLanguage }),
  }
  return { endpoint, params, cacheKey: buildCacheKey(endpoint, params) }
}

/** Client offline do Streaming Availability. */
export class StreamingAvailabilityClient {
  private readonly http: RapidApiHttpClient

  constructor(config: RapidApiClientConfig, deps: RapidApiHttpDeps) {
    this.http = new RapidApiHttpClient(config, deps)
  }

  /** `GET /shows/{id}?country=BR` — payload cru, sem normalizacao. */
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
