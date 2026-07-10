/**
 * client.ts — Client offline do Film/Show Ratings (RapidAPI).
 *
 * WORKER-ONLY. Devolve o payload BRUTO como `unknown`: esta API nao publica
 * schema de resposta, entao o client NAO inventa tipos. Interpretar o payload
 * (e decidir se ha mapping seguro para `external_ratings`) e responsabilidade
 * de `services/ratings`, com recusa explicita quando o dado for ambiguo.
 *
 * INVARIANTE 2: este client e o fornecedor TECNICO. Ele nunca declara a fonte
 * editorial de uma nota.
 */

import {
  buildCacheKey,
  RapidApiHttpClient,
  createRapidApiFetchTransport,
  type CacheKey,
  type QueryParams,
  type RapidApiClientConfig,
  type RapidApiHttpDeps,
} from '@screena/rapidapi-core'

import {
  FILM_SHOW_RATINGS_POPULAR_ENDPOINT,
  type FilmShowRatingsPopularType,
} from './provider.js'

/** Uma requisicao de populares: endpoint + params (sem segredo). */
export interface PopularRequest {
  readonly endpoint: string
  readonly params: QueryParams
  readonly cacheKey: CacheKey
}

/**
 * Monta (sem executar) a requisicao de `/popular/`.
 *
 * PURO — usado por teste e pelo relatorio de dry-run, que precisa saber o que
 * SERIA chamado sem gastar cota. `type` ausente = `/popular/` sem query.
 */
export function buildPopularRequest(type?: FilmShowRatingsPopularType): PopularRequest {
  const params: QueryParams = type === undefined ? {} : { type }
  return {
    endpoint: FILM_SHOW_RATINGS_POPULAR_ENDPOINT,
    params,
    cacheKey: buildCacheKey(FILM_SHOW_RATINGS_POPULAR_ENDPOINT, params),
  }
}

/** Client offline do Film/Show Ratings. */
export class FilmShowRatingsClient {
  private readonly http: RapidApiHttpClient

  constructor(config: RapidApiClientConfig, deps: RapidApiHttpDeps) {
    this.http = new RapidApiHttpClient(config, deps)
  }

  /**
   * `GET /popular/?type=film` | `GET /popular/?type=show` | `GET /popular/`.
   *
   * Devolve o payload cru (`unknown`). Nenhuma normalizacao acontece aqui.
   */
  async getPopular(type?: FilmShowRatingsPopularType): Promise<unknown> {
    const request = buildPopularRequest(type)
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
export function createFilmShowRatingsClient(config: RapidApiClientConfig): FilmShowRatingsClient {
  return new FilmShowRatingsClient(config, {
    transport: createRapidApiFetchTransport(config.timeoutMs),
  })
}
