/**
 * http.ts — Executor HTTP resiliente do client TMDB.
 *
 * Implementa os requisitos obrigatorios de todo client externo (worker-only):
 *  - throttle (token-bucket simplificado por intervalo minimo) por `maxRps`;
 *  - retry com backoff exponencial + jitter SO em erros transitorios
 *    (429 com Retry-After, 5xx, falha de rede); 4xx (exceto 429) NUNCA retenta;
 *  - circuit breaker por fonte: abre apos N falhas consecutivas, cooldown,
 *    half-open de prova.
 *
 * O transporte HTTP e INJETAVEL (`HttpTransport`) para testes deterministas sem
 * rede. `now`/`sleep`/`random` tambem sao injetaveis para tornar throttle,
 * backoff e breaker testaveis sem tempo real.
 */

import type { TmdbConfig } from './config.js'

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

/** Parametros de query (valores nulos/undefined sao omitidos). */
export type TmdbQueryParams = Record<string, string | number | undefined>

/** Teto do trecho de corpo que entra na MENSAGEM do erro. */
const BODY_IN_MESSAGE_MAX = 160

/**
 * O que o TMDB disse, em uma linha curta.
 *
 * O corpo de erro do TMDB e JSON com `status_message` (`{"success":false,
 * "status_code":34,"status_message":"The resource you requested could not be
 * found."}`) — e essa frase que diz se o job morreu por id inexistente, por
 * chave invalida ou por cota. Quando o corpo nao e esse JSON (HTML de gateway,
 * texto de proxy), cai para um trecho colapsado do proprio corpo.
 */
function describeBody(body: string): string {
  const texto = body.trim()
  if (texto === '') return ''
  try {
    const parsed: unknown = JSON.parse(texto)
    if (typeof parsed === 'object' && parsed !== null) {
      const message: unknown = (parsed as { status_message?: unknown }).status_message
      if (typeof message === 'string' && message.trim() !== '') {
        return message.trim().slice(0, BODY_IN_MESSAGE_MAX)
      }
    }
  } catch {
    // Corpo nao-JSON: segue para o trecho cru abaixo.
  }
  return texto.replace(/\s+/g, ' ').slice(0, BODY_IN_MESSAGE_MAX)
}

/**
 * Erro de resposta TMDB. `permanent=true` para 4xx (exceto 429) — nao retenta.
 *
 * A MENSAGEM CARREGA O MOTIVO. Ate 2026-08-25 o corpo da resposta ficava so na
 * propriedade `body`, que ninguem lia: a mensagem era `TMDB HTTP 401` e nada
 * mais, entao `last_error_safe` guardava o codigo e perdia a frase que
 * distingue "chave invalida" de "id inexistente" de "cota estourada". Mesmo
 * defeito da #218 — a causa existia na memoria do processo e morria na
 * formatacao. `body` continua intacto para quem quiser o corpo inteiro.
 */
export class TmdbHttpError extends Error {
  readonly status: number
  readonly body: string
  readonly permanent: boolean

  constructor(status: number, body: string, permanent: boolean) {
    const motivo = describeBody(body)
    super(`TMDB HTTP ${status}${permanent ? ' (permanente)' : ''}${motivo === '' ? '' : `: ${motivo}`}`)
    this.name = 'TmdbHttpError'
    this.status = status
    this.body = body
    this.permanent = permanent
  }
}

/** Erro lancado quando o circuito esta aberto (fonte degradada). */
export class TmdbCircuitOpenError extends Error {
  readonly openUntil: number

  constructor(openUntil: number) {
    super('TMDB circuit breaker aberto: chamadas suspensas ate cooldown.')
    this.name = 'TmdbCircuitOpenError'
    this.openUntil = openUntil
  }
}

/** Dependencias injetaveis (transporte + relogio + sleep + random). */
export interface TmdbHttpDeps {
  readonly transport: HttpTransport
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
}

const BACKOFF_BASE_MS = 250
const BACKOFF_MAX_MS = 10_000

/** Cria o transporte padrao usando o `fetch` global (Node 22). Nao usado em teste. */
export function createFetchTransport(): HttpTransport {
  return async (request) => {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
    })
    const body = await response.text()
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    return { status: response.status, headers, body }
  }
}

/** 4xx (exceto 429) e erro permanente: requisicao invalida, nao retenta. */
function isPermanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429
}

/** Converte Retry-After (segundos) em ms; ignora formato de data. */
function parseRetryAfterMs(value: string | undefined): number | undefined {
  if (value == null) return undefined
  const seconds = Number.parseInt(value, 10)
  if (!Number.isFinite(seconds) || seconds < 0) return undefined
  return seconds * 1000
}

/** Executor HTTP do TMDB com throttle, retry e circuit breaker. */
export class TmdbHttpClient {
  private readonly config: TmdbConfig
  private readonly transport: HttpTransport
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly random: () => number
  private readonly minIntervalMs: number

  private nextAllowedAt = 0
  private consecutiveFailures = 0
  private openUntil: number | null = null

  constructor(config: TmdbConfig, deps: TmdbHttpDeps) {
    this.config = config
    this.transport = deps.transport
    this.now = deps.now ?? (() => Date.now())
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.random = deps.random ?? (() => Math.random())
    this.minIntervalMs = Math.ceil(1000 / config.maxRps)
  }

  /** Estado atual do circuito (para observabilidade/log). */
  isCircuitOpen(): boolean {
    return this.openUntil !== null && this.now() < this.openUntil
  }

  /** Faz GET em `path` com `params`, devolvendo o JSON parseado como `unknown`. */
  async request(path: string, params: TmdbQueryParams = {}): Promise<unknown> {
    this.assertCircuitClosed()

    const url = this.buildUrl(path, params)
    const headers = this.buildHeaders()
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      await this.throttle()

      let response: HttpResponse
      try {
        response = await this.transport({ url, method: 'GET', headers })
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt < this.config.maxRetries) {
          await this.backoff(attempt, undefined)
          continue
        }
        break
      }

      if (response.status >= 200 && response.status < 300) {
        const parsed = this.parseJson(response.body)
        this.onSuccess()
        return parsed
      }

      if (isPermanentStatus(response.status)) {
        // Erro de cliente (4xx): nao retenta e NAO conta para o breaker.
        throw new TmdbHttpError(response.status, response.body, true)
      }

      // Transitorio (429/5xx): retenta com backoff (respeitando Retry-After em 429).
      lastError = new TmdbHttpError(response.status, response.body, false)
      if (attempt < this.config.maxRetries) {
        const retryAfterMs =
          response.status === 429 ? parseRetryAfterMs(response.headers['retry-after']) : undefined
        await this.backoff(attempt, retryAfterMs)
        continue
      }
    }

    // Retries transitorios esgotados: degradacao da fonte -> conta para o breaker.
    this.onFailure()
    throw lastError ?? new Error('TMDB request falhou sem erro capturado.')
  }

  private assertCircuitClosed(): void {
    if (this.openUntil !== null && this.now() < this.openUntil) {
      throw new TmdbCircuitOpenError(this.openUntil)
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

  private async backoff(attempt: number, retryAfterMs: number | undefined): Promise<void> {
    if (retryAfterMs !== undefined) {
      await this.sleep(retryAfterMs)
      return
    }
    const exponential = BACKOFF_BASE_MS * 2 ** attempt
    const jitter = this.random() * BACKOFF_BASE_MS
    await this.sleep(Math.min(exponential + jitter, BACKOFF_MAX_MS))
  }

  private buildUrl(path: string, params: TmdbQueryParams): string {
    const url = new URL(this.config.baseUrl + path)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    if (this.config.auth.mode === 'v3') {
      url.searchParams.set('api_key', this.config.auth.apiKey)
    }
    return url.toString()
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (this.config.auth.mode === 'v4') {
      headers.authorization = `Bearer ${this.config.auth.token}`
    }
    return headers
  }

  private parseJson(body: string): unknown {
    try {
      const parsed: unknown = JSON.parse(body)
      return parsed
    } catch {
      throw new Error('TMDB respondeu 2xx com JSON invalido.')
    }
  }
}
