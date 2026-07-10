/**
 * http.ts — Executor HTTP resiliente COMPARTILHADO pelos clients RapidAPI.
 *
 * Implementa os cinco mecanismos obrigatorios de todo client externo
 * (`.claude/rules/ingestion.md`), mais timeout:
 *  1. retry com backoff exponencial + jitter SO em erros transitorios
 *     (429 com Retry-After, 5xx, rede/timeout); 4xx (exceto 429) NUNCA retenta;
 *  2. rate limit por provider — throttle de intervalo minimo derivado de `maxRps`;
 *  3. circuit breaker POR API — cada instancia tem seu proprio estado, entao
 *     estourar uma fonte nunca suspende as outras;
 *  4. cache local — responsabilidade do worker (ver `buildCacheKey`/`hashPayload`);
 *  5. hash de payload — idem.
 *
 * SEGREDO: a `x-rapidapi-key` viaja SO em header. Nunca entra na URL, no erro,
 * no log ou no relatorio. Ver `errors.ts`.
 *
 * `transport`/`now`/`sleep`/`random` sao INJETAVEIS: throttle, backoff e breaker
 * ficam testaveis sem rede e sem tempo real.
 */

import {
  RapidApiCircuitOpenError,
  RapidApiHttpError,
  RapidApiInvalidPayloadError,
} from './errors.js'

/** Requisicao HTTP de baixo nivel (apenas GET nesta fase). */
export interface HttpRequest {
  readonly url: string
  readonly method: 'GET'
  readonly headers: Record<string, string>
}

/** Resposta HTTP normalizada. `headers` deve ter chaves em minusculas. */
export interface HttpResponse {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: string
}

/** Transporte injetavel: leva uma requisicao e devolve uma resposta. */
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>

/** Parametros de query (valores `undefined` sao omitidos). */
export type QueryParams = Record<string, string | number | undefined>

/**
 * Configuracao resolvida de um client RapidAPI.
 *
 * `apiKey` NUNCA e logado, serializado ou interpolado em URL/erro.
 */
export interface RapidApiClientConfig {
  /** Fornecedor tecnico (`api_providers.key`). NUNCA e a fonte editorial. */
  readonly providerApi: string
  readonly baseUrl: string
  readonly host: string
  readonly apiKey: string
  readonly maxRps: number
  readonly maxRetries: number
  readonly breakerThreshold: number
  readonly breakerCooldownMs: number
  readonly timeoutMs: number
  /** TTL do `api_cache` para este provider (usado pelo worker, nao pelo client). */
  readonly cacheTtlMs: number
}

/** Dependencias injetaveis (transporte + relogio + sleep + random). */
export interface RapidApiHttpDeps {
  readonly transport: HttpTransport
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
}

/** Base do backoff exponencial em ms. */
export const BACKOFF_BASE_MS = 250
/** Teto absoluto de espera entre tentativas, em ms. */
export const BACKOFF_MAX_MS = 10_000

/** Header canonico da chave RapidAPI (minusculo, como o transporte normaliza). */
export const RAPIDAPI_KEY_HEADER = 'x-rapidapi-key'
/** Header canonico do host RapidAPI. */
export const RAPIDAPI_HOST_HEADER = 'x-rapidapi-host'

/**
 * Transporte padrao com timeout, usando o `fetch` global (Node 22).
 *
 * Um timeout aborta a requisicao e lanca — o executor trata como transitorio e
 * retenta com backoff.
 */
export function createRapidApiFetchTransport(timeoutMs: number): HttpTransport {
  return async (request) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        signal: controller.signal,
      })
      const body = await response.text()
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })
      return { status: response.status, headers, body }
    } finally {
      clearTimeout(timer)
    }
  }
}

/** 4xx (exceto 429) e erro permanente: requisicao invalida, nao retenta. */
function isPermanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429
}

/** Converte `Retry-After` (segundos) em ms; ignora formato de data HTTP. */
export function parseRetryAfterMs(value: string | undefined): number | null {
  if (value == null) return null
  const seconds = Number.parseInt(value, 10)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return seconds * 1000
}

/**
 * Executor HTTP de um provider RapidAPI: throttle + retry/backoff + breaker.
 *
 * Uma instancia == uma API. O breaker e o throttle sao POR INSTANCIA, logo
 * isolados por provider (regra de ingestao: "estourar cota de um provider nao
 * pode bloquear os outros").
 */
export class RapidApiHttpClient {
  private readonly config: RapidApiClientConfig
  private readonly transport: HttpTransport
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly random: () => number
  private readonly minIntervalMs: number

  private nextAllowedAt = 0
  private consecutiveFailures = 0
  private openUntil: number | null = null
  /** Requisicoes efetivamente disparadas (observabilidade / quota_cost). */
  private requestCount = 0

  constructor(config: RapidApiClientConfig, deps: RapidApiHttpDeps) {
    this.config = config
    this.transport = deps.transport
    this.now = deps.now ?? (() => Date.now())
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.random = deps.random ?? (() => Math.random())
    this.minIntervalMs = Math.ceil(1000 / config.maxRps)
  }

  /** Estado atual do circuito (observabilidade/log). */
  isCircuitOpen(): boolean {
    return this.openUntil !== null && this.now() < this.openUntil
  }

  /** Quantas requisicoes HTTP foram efetivamente disparadas (inclui retries). */
  getRequestCount(): number {
    return this.requestCount
  }

  /** GET em `path` com `params`; devolve o JSON parseado como `unknown`. */
  async request(path: string, params: QueryParams = {}): Promise<unknown> {
    this.assertCircuitClosed()

    const url = this.buildUrl(path, params)
    const headers = this.buildHeaders()
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      await this.throttle()
      this.requestCount += 1

      let response: HttpResponse
      try {
        response = await this.transport({ url, method: 'GET', headers })
      } catch (error) {
        // Rede/timeout/abort: transitorio. NUNCA propaga o erro cru do fetch
        // (poderia carregar a URL/headers em `cause`).
        lastError =
          error instanceof RapidApiHttpError
            ? error
            : new Error(
                `RapidAPI ${this.config.providerApi} falhou no transporte em ${path} ` +
                  `(rede/timeout).`,
              )
        if (attempt < this.config.maxRetries) {
          await this.backoff(attempt, null)
          continue
        }
        break
      }

      if (response.status >= 200 && response.status < 300) {
        const parsed = this.parseJson(response.body, path)
        this.onSuccess()
        return parsed
      }

      const retryAfterMs =
        response.status === 429 ? parseRetryAfterMs(response.headers['retry-after']) : null

      if (isPermanentStatus(response.status)) {
        // 4xx (401/403/404/...): nao retenta e NAO conta para o breaker.
        throw new RapidApiHttpError({
          status: response.status,
          body: response.body,
          permanent: true,
          providerApi: this.config.providerApi,
          endpoint: path,
        })
      }

      // Transitorio (429/5xx): retenta com backoff, respeitando Retry-After.
      lastError = new RapidApiHttpError({
        status: response.status,
        body: response.body,
        permanent: false,
        providerApi: this.config.providerApi,
        endpoint: path,
        retryAfterMs,
      })
      if (attempt < this.config.maxRetries) {
        await this.backoff(attempt, retryAfterMs)
        continue
      }
    }

    // Retries transitorios esgotados: degradacao da fonte -> conta para o breaker.
    this.onFailure()
    throw (
      lastError ??
      new Error(`RapidAPI ${this.config.providerApi} falhou sem erro capturado em ${path}.`)
    )
  }

  private assertCircuitClosed(): void {
    if (this.openUntil !== null && this.now() < this.openUntil) {
      throw new RapidApiCircuitOpenError(this.config.providerApi, this.openUntil)
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0
    this.openUntil = null
  }

  private onFailure(): void {
    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= this.config.breakerThreshold) {
      this.openUntil = this.now() + this.config.breakerCooldownMs
    }
  }

  private async throttle(): Promise<void> {
    const wait = this.nextAllowedAt - this.now()
    if (wait > 0) await this.sleep(wait)
    this.nextAllowedAt = this.now() + this.minIntervalMs
  }

  private async backoff(attempt: number, retryAfterMs: number | null): Promise<void> {
    if (retryAfterMs !== null) {
      await this.sleep(Math.min(retryAfterMs, BACKOFF_MAX_MS))
      return
    }
    const exponential = BACKOFF_BASE_MS * 2 ** attempt
    const jitter = this.random() * BACKOFF_BASE_MS
    await this.sleep(Math.min(exponential + jitter, BACKOFF_MAX_MS))
  }

  /**
   * Monta a URL. A chave NUNCA entra aqui (nem como query param) — so header.
   * `path` ja vem montado pelo client (ex.: `/shows/movie/278`).
   */
  private buildUrl(path: string, params: QueryParams): string {
    const url = new URL(this.config.baseUrl + path)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  private buildHeaders(): Record<string, string> {
    return {
      accept: 'application/json',
      [RAPIDAPI_KEY_HEADER]: this.config.apiKey,
      [RAPIDAPI_HOST_HEADER]: this.config.host,
    }
  }

  private parseJson(body: string, path: string): unknown {
    try {
      const parsed: unknown = JSON.parse(body)
      return parsed
    } catch {
      throw new RapidApiInvalidPayloadError(this.config.providerApi, path)
    }
  }
}
