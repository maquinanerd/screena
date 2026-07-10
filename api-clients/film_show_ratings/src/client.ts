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
  FILM_SHOW_RATINGS_ITEM_ENDPOINT,
  FILM_SHOW_RATINGS_POPULAR_ENDPOINT,
  type FilmShowRatingsPopularType,
} from './provider.js'

/** Uma requisicao de populares: endpoint + params (sem segredo). */
export interface PopularRequest {
  readonly endpoint: string
  readonly params: QueryParams
  readonly cacheKey: CacheKey
}

/** Uma requisicao de item unico: endpoint + params (`id`) + chave de cache. */
export interface ItemRequest {
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

/**
 * Monta (sem executar) a requisicao de `/item/?id=<id>`.
 *
 * PURO — o `id` viaja SO como query param (`id`); o segredo continua em header.
 * A validacao da FORMA do id (`tt<digitos>`) e responsabilidade do chamador
 * (parser de args + worker via `isImdbId`); aqui so montamos o request.
 */
export function buildItemRequest(id: string): ItemRequest {
  const params: QueryParams = { id }
  return {
    endpoint: FILM_SHOW_RATINGS_ITEM_ENDPOINT,
    params,
    cacheKey: buildCacheKey(FILM_SHOW_RATINGS_ITEM_ENDPOINT, params),
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

  /**
   * `GET /item/?id=<id>` — payload de UM titulo (liberado no plano Pro).
   *
   * Devolve o payload cru (`unknown`). Nenhuma normalizacao acontece aqui: a
   * interpretacao (mapping para `external_ratings`) e do worker `services/ratings`.
   */
  async getItem(id: string): Promise<unknown> {
    const request = buildItemRequest(id)
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
