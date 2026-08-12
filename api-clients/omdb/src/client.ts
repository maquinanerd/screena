/**
 * client.ts — Client offline da OMDb API.
 *
 * WORKER-ONLY. Devolve o payload BRUTO como `unknown`. Este pacote NAO
 * interpreta nota, fonte nem escala: interpretar (e recusar o que for ambiguo) e
 * responsabilidade de `services/ratings/src/omdb/mapping.ts`.
 *
 * ATENCAO — `Response: "False"`: a OMDb responde ERRO com HTTP **200** e um
 * campo `Error` no corpo (ex.: id inexistente, chave invalida). Para o executor
 * HTTP isso e sucesso, e este client devolve o payload como qualquer outro. Quem
 * reconhece o erro e o mapper, de proposito: assim o caso e testavel sem rede e
 * nunca vira "0 notas" silencioso.
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

import { OMDB_ENDPOINT } from './provider.js'

/** Uma requisicao por IMDb id: endpoint + params PUBLICOS + chave de cache. */
export interface OmdbByImdbIdRequest {
  readonly endpoint: string
  /** NUNCA contem a chave da API — ela e injetada so na montagem da URL. */
  readonly params: QueryParams
  readonly cacheKey: CacheKey
}

/**
 * Monta (sem executar) a requisicao `GET /?i=<imdbID>`.
 *
 * PURO — usado por teste e pelo relatorio de dry-run, que precisa saber o que
 * SERIA chamado sem gastar cota.
 *
 * `plot=short` e explicito para nao depender do default do upstream, e
 * `r=json` idem. A chave NAO entra em `params`: se entrasse, acabaria em
 * `api_cache.request_key` (ver `buildCacheKey`).
 */
export function buildOmdbByImdbIdRequest(imdbId: string): OmdbByImdbIdRequest {
  const params: QueryParams = { i: imdbId, plot: 'short', r: 'json' }
  return {
    endpoint: OMDB_ENDPOINT,
    params,
    cacheKey: buildCacheKey(OMDB_ENDPOINT, params),
  }
}

/** Client offline da OMDb. */
export class OmdbClient {
  private readonly http: RapidApiHttpClient

  constructor(config: RapidApiClientConfig, deps: RapidApiHttpDeps) {
    this.http = new RapidApiHttpClient(config, deps)
  }

  /**
   * `GET /?i=<imdbID>` — payload de UM titulo, com as notas de TODAS as fontes
   * que a OMDb conhece para ele.
   *
   * Devolve o payload cru (`unknown`). Nenhuma normalizacao acontece aqui —
   * inclusive `Response: "False"` volta como payload normal (ver cabecalho).
   */
  async getByImdbId(imdbId: string): Promise<unknown> {
    const request = buildOmdbByImdbIdRequest(imdbId)
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
export function createOmdbClient(config: RapidApiClientConfig): OmdbClient {
  return new OmdbClient(config, {
    transport: createRapidApiFetchTransport(config.timeoutMs),
  })
}
