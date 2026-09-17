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
 * E a PARADA DO PROCESSO (`stopSignal`): depois do SIGTERM nenhuma requisicao
 * nova sai — nem retentativa —, as esperas de throttle e backoff acabam na hora,
 * e a requisicao que ja estava em voo tem `stopGraceMs` para voltar antes de ser
 * cortada. Ver `RapidApiHttpDeps.stopSignal`.
 *
 * SEGREDO — dois modos de auth, e a diferenca importa:
 *
 *  - `rapidapi-headers` (DEFAULT, usado por todos os clients RapidAPI): a
 *    `x-rapidapi-key` viaja SO em header. Nunca entra na URL.
 *  - `query-param`: a chave viaja na QUERYSTRING, porque o provedor nao oferece
 *    outra forma (caso da OMDb: `?apikey=...`). NAO e um afrouxamento da regra —
 *    e o unico mecanismo que aquele upstream aceita.
 *
 * Em AMBOS os modos o segredo continua fora de erro, log, relatorio e
 * `api_cache`, e isso e ESTRUTURAL, nao disciplina:
 *  - `RapidApiHttpError` carrega `endpoint` (o PATH), nunca a URL montada;
 *  - a falha de transporte e substituida por uma mensagem sintetica, entao o
 *    erro cru do `fetch` (que carrega a URL em `cause`) nunca propaga;
 *  - a chave e injetada em `buildUrl` e NUNCA entra no `params` que o client
 *    passa a `buildCacheKey` — logo jamais chega a `api_cache.request_key`.
 * Travado por `__tests__/http-auth.test.ts`.
 *
 * `transport`/`now`/`sleep`/`random` sao INJETAVEIS: throttle, backoff e breaker
 * ficam testaveis sem rede e sem tempo real.
 */

import {
  RapidApiCircuitOpenError,
  RapidApiHttpError,
  RapidApiInvalidPayloadError,
  RapidApiStoppedError,
} from './errors.js'

/** Requisicao HTTP de baixo nivel (apenas GET nesta fase). */
export interface HttpRequest {
  readonly url: string
  readonly method: 'GET'
  readonly headers: Record<string, string>
  /** Abortado = cortar ESTA requisicao (a carencia de parada acabou). */
  readonly signal?: AbortSignal
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
 * Como a chave e apresentada ao upstream.
 *
 * `rapidapi-headers` e o DEFAULT e mantem o comportamento historico intacto:
 * um chamador que nao conhece este campo continua enviando `x-rapidapi-key` +
 * `x-rapidapi-host`, exatamente como antes.
 */
export type ExternalApiAuthMode =
  | { readonly kind: 'rapidapi-headers' }
  /**
   * Chave na querystring, sob o nome `param` (ex.: `apikey` da OMDb). Usado so
   * quando o provedor nao aceita header — nunca por conveniencia.
   */
  | { readonly kind: 'query-param'; readonly param: string }

/**
 * Configuracao resolvida de um client HTTP externo.
 *
 * `apiKey` NUNCA e logado, serializado ou interpolado em erro. Sob
 * `auth.kind === 'query-param'` ela entra na URL enviada ao upstream (unico
 * mecanismo daquele provedor) e em nenhum outro lugar.
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
  /**
   * Modo de auth. AUSENTE => `rapidapi-headers` (compatibilidade: todo client
   * escrito antes deste campo continua funcionando sem alteracao).
   */
  readonly auth?: ExternalApiAuthMode
}

/** Dependencias injetaveis (transporte + relogio + sleep + random + parada). */
export interface RapidApiHttpDeps {
  readonly transport: HttpTransport
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
  /**
   * PEDIDO DE PARADA do processo — o SIGTERM do orquestrador, traduzido pela CLI.
   *
   * Abortado, o client para ENTRE requisicoes: nenhuma tentativa nova sai (nem a
   * retentativa de uma que falhou), e a espera de throttle ou de backoff termina
   * na hora — com o timer limpo, senao o processo esperaria ate 10 s de backoff
   * para sair. A chamada que parou lanca `RapidApiStoppedError`.
   *
   * A requisicao que JA estava em voo nao e cortada no ato: ela ja foi paga, e
   * a resposta dela ainda vira dado. Ela tem `stopGraceMs` para voltar.
   */
  readonly stopSignal?: AbortSignal
  /** Carencia da requisicao em voo depois da parada. Default `STOP_IN_FLIGHT_GRACE_MS`. */
  readonly stopGraceMs?: number
}

/** Base do backoff exponencial em ms. */
export const BACKOFF_BASE_MS = 250
/** Teto absoluto de espera entre tentativas, em ms. */
export const BACKOFF_MAX_MS = 10_000

/**
 * Quanto a requisicao EM VOO ainda pode durar depois do pedido de parada.
 *
 * O teto vem da carencia do orquestrador, nao do fornecedor: o Swarm manda
 * SIGKILL 10 s depois do SIGTERM, para o container INTEIRO, e dentro desses 10 s
 * cabem esta espera, a escrita do item que voltou, a linha de `api_sync_logs`, o
 * fim deste processo e o desligamento do agendador que o spawnou. Sem teto, o
 * timeout de uma requisicao pendurada (15 s na OMDb) passaria da carencia — e o
 * SIGKILL levaria justamente a linha que registra a cota gasta.
 */
export const STOP_IN_FLIGHT_GRACE_MS = 3_000

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
    // O corte pedido por quem chamou (carencia de parada esgotada) aborta a MESMA
    // requisicao que o timeout abortaria.
    const onCallerAbort = (): void => controller.abort()
    if (request.signal?.aborted === true) controller.abort()
    else request.signal?.addEventListener('abort', onCallerAbort, { once: true })
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
      request.signal?.removeEventListener('abort', onCallerAbort)
    }
  }
}

/**
 * `setTimeout` que ACORDA no pedido de parada e LIMPA o proprio timer. Um sleep
 * que so resolvesse mais cedo deixaria o timer pendurado, e o processo esperaria
 * o backoff inteiro para sair.
 */
function sleepUnlessStopped(ms: number, stopSignal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (stopSignal?.aborted === true) {
      resolve()
      return
    }
    const wake = (): void => {
      clearTimeout(timer)
      stopSignal?.removeEventListener('abort', wake)
      resolve()
    }
    const timer = setTimeout(wake, ms)
    stopSignal?.addEventListener('abort', wake, { once: true })
  })
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
  private readonly stopSignal: AbortSignal | undefined
  private readonly stopGraceMs: number

  private nextAllowedAt = 0
  private consecutiveFailures = 0
  private openUntil: number | null = null
  /** Requisicoes efetivamente disparadas (observabilidade / quota_cost). */
  private requestCount = 0

  constructor(config: RapidApiClientConfig, deps: RapidApiHttpDeps) {
    this.config = config
    this.transport = deps.transport
    this.now = deps.now ?? (() => Date.now())
    this.sleep = deps.sleep ?? ((ms) => sleepUnlessStopped(ms, deps.stopSignal))
    this.random = deps.random ?? (() => Math.random())
    this.minIntervalMs = Math.ceil(1000 / config.maxRps)
    this.stopSignal = deps.stopSignal
    this.stopGraceMs = deps.stopGraceMs ?? STOP_IN_FLIGHT_GRACE_MS
  }

  /** Estado atual do circuito (observabilidade/log). */
  isCircuitOpen(): boolean {
    return this.openUntil !== null && this.now() < this.openUntil
  }

  /** Quantas requisicoes HTTP foram efetivamente disparadas (inclui retries). */
  getRequestCount(): number {
    return this.requestCount
  }

  /**
   * Abre o circuito POR DECISAO DE QUEM LE O CORPO, nao pelo status HTTP.
   *
   * Existe porque nem todo fornecedor sinaliza degradacao no status. A OMDb
   * responde **HTTP 200** com `{"Response":"False","Error":"Request limit
   * reached!"}` — para `request()` isso e sucesso, `onSuccess()` roda e o
   * breaker literalmente nao pode saber. Sem esta porta, a unica alternativa
   * seria ensinar este executor generico a interpretar o corpo de um provider
   * especifico, e ai o modulo que existe para NAO conhecer providers passaria a
   * conhecer um.
   *
   * A separacao de responsabilidades fica: o executor sabe ABRIR o circuito;
   * quem entende o vocabulario do fornecedor (`services/ratings/src/omdb/
   * error-response.ts`) sabe QUANDO pedir. O cooldown e o mesmo de qualquer
   * abertura — nao ha politica nova aqui.
   *
   * Idempotente: chamar duas vezes so estende o cooldown a partir de agora.
   */
  tripCircuit(): void {
    this.consecutiveFailures = this.config.breakerThreshold
    this.openUntil = this.now() + this.config.breakerCooldownMs
  }

  /** GET em `path` com `params`; devolve o JSON parseado como `unknown`. */
  async request(path: string, params: QueryParams = {}): Promise<unknown> {
    this.assertNotStopped(path)
    this.assertCircuitClosed()

    const url = this.buildUrl(path, params)
    const headers = this.buildHeaders()
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      await this.throttle()
      // A parada pedida durante a espera barra a PROXIMA requisicao — inclusive a
      // retentativa desta. E aqui que "parar entre requisicoes" acontece.
      this.assertNotStopped(path)
      this.requestCount += 1

      const inFlight = this.watchInFlight()
      let response: HttpResponse
      try {
        response = await this.transport(
          inFlight.signal === undefined
            ? { url, method: 'GET', headers }
            : { url, method: 'GET', headers, signal: inFlight.signal },
        )
        inFlight.dispose()
      } catch (error) {
        const cutByStop = inFlight.signal?.aborted === true
        inFlight.dispose()
        // Cortada pela carencia: a parada, nao o fornecedor. Nao retenta, nao
        // conta para o breaker — e `requestCount` ja a contou, porque ela saiu.
        if (cutByStop) throw new RapidApiStoppedError(this.config.providerApi, path, true)
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

  private stopRequested(): boolean {
    return this.stopSignal?.aborted === true
  }

  private assertNotStopped(path: string): void {
    if (this.stopRequested()) {
      throw new RapidApiStoppedError(this.config.providerApi, path, false)
    }
  }

  /**
   * A carencia da requisicao EM VOO: se a parada chegar enquanto ela esta na
   * rede, ela ainda tem `stopGraceMs` para voltar; depois disso e abortada.
   * `dispose` solta o ouvinte e o timer assim que a requisicao termina.
   */
  private watchInFlight(): {
    readonly signal: AbortSignal | undefined
    readonly dispose: () => void
  } {
    const stop = this.stopSignal
    if (stop === undefined) return { signal: undefined, dispose: () => undefined }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    const onStop = (): void => {
      timer = setTimeout(() => controller.abort(), this.stopGraceMs)
    }
    stop.addEventListener('abort', onStop, { once: true })
    return {
      signal: controller.signal,
      dispose: () => {
        stop.removeEventListener('abort', onStop)
        if (timer !== null) clearTimeout(timer)
      },
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
    // Parado, nao ha proxima requisicao para espacar: esperar so atrasaria a saida.
    if (wait > 0 && !this.stopRequested()) await this.sleep(wait)
    this.nextAllowedAt = this.now() + this.minIntervalMs
  }

  private async backoff(attempt: number, retryAfterMs: number | null): Promise<void> {
    if (this.stopRequested()) return
    if (retryAfterMs !== null) {
      await this.sleep(Math.min(retryAfterMs, BACKOFF_MAX_MS))
      return
    }
    const exponential = BACKOFF_BASE_MS * 2 ** attempt
    const jitter = this.random() * BACKOFF_BASE_MS
    await this.sleep(Math.min(exponential + jitter, BACKOFF_MAX_MS))
  }

  /** Modo de auth efetivo (ausente => headers RapidAPI, comportamento historico). */
  private authMode(): ExternalApiAuthMode {
    return this.config.auth ?? { kind: 'rapidapi-headers' }
  }

  /**
   * Monta a URL enviada ao upstream. `path` ja vem montado pelo client.
   *
   * Sob `rapidapi-headers` a chave NUNCA entra aqui. Sob `query-param` ela e
   * injetada AQUI e so aqui — depois de `params`, que e o objeto que o client
   * usa para a chave de `api_cache`. Essa ordem e o que garante que a chave
   * nunca seja persistida: quem monta o cache key nunca ve este valor.
   */
  private buildUrl(path: string, params: QueryParams): string {
    const url = new URL(this.config.baseUrl + path)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const auth = this.authMode()
    if (auth.kind === 'query-param') {
      url.searchParams.set(auth.param, this.config.apiKey)
    }
    return url.toString()
  }

  private buildHeaders(): Record<string, string> {
    // Sob `query-param` os headers RapidAPI seriam ruido inutil enviado a um
    // host que nao e da RapidAPI — e um deles carregaria o segredo para um
    // destino que nao o pediu. Nao os enviamos.
    if (this.authMode().kind === 'query-param') {
      return { accept: 'application/json' }
    }
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
