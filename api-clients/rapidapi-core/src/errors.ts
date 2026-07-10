/**
 * errors.ts — Erros SANITIZADOS dos clients RapidAPI.
 *
 * REGRA DE SEGURANCA: nenhum erro daqui carrega headers, URL completa ou a
 * `x-rapidapi-key`. O erro so expoe `status`, um trecho TRUNCADO do corpo e o
 * `providerApi`/`endpoint` (caminho, sem querystring). Como a chave viaja
 * exclusivamente em header (nunca em query), a URL nunca a contem — mas mesmo
 * assim a URL nao entra no erro, para que um log futuro nao vaze nada.
 */

/** Tamanho maximo do trecho de corpo preservado num erro. */
export const ERROR_BODY_MAX_CHARS = 300

/** Trunca o corpo do erro para caber num log sem despejar o payload inteiro. */
export function truncateErrorBody(body: string): string {
  if (body.length <= ERROR_BODY_MAX_CHARS) return body
  return `${body.slice(0, ERROR_BODY_MAX_CHARS)}…[truncado]`
}

/**
 * Erro HTTP de um provider RapidAPI.
 *
 * `permanent = true` para 4xx (exceto 429): requisicao invalida/nao autorizada —
 * nunca retenta e nao conta para o circuit breaker.
 */
export class RapidApiHttpError extends Error {
  readonly status: number
  readonly body: string
  readonly permanent: boolean
  readonly providerApi: string
  readonly endpoint: string
  /** Retry-After propagado em 429 (ms), quando o upstream informa. */
  readonly retryAfterMs: number | null

  constructor(input: {
    readonly status: number
    readonly body: string
    readonly permanent: boolean
    readonly providerApi: string
    readonly endpoint: string
    readonly retryAfterMs?: number | null
  }) {
    super(
      `RapidAPI HTTP ${input.status}${input.permanent ? ' (permanente)' : ''} em ` +
        `${input.providerApi} ${input.endpoint}`,
    )
    this.name = 'RapidApiHttpError'
    this.status = input.status
    this.body = truncateErrorBody(input.body)
    this.permanent = input.permanent
    this.providerApi = input.providerApi
    this.endpoint = input.endpoint
    this.retryAfterMs = input.retryAfterMs ?? null
  }
}

/** Erro lancado quando o circuito daquele provider esta aberto (fonte degradada). */
export class RapidApiCircuitOpenError extends Error {
  readonly openUntil: number
  readonly providerApi: string

  constructor(providerApi: string, openUntil: number) {
    super(`RapidAPI circuit breaker aberto em ${providerApi}: chamadas suspensas ate cooldown.`)
    this.name = 'RapidApiCircuitOpenError'
    this.providerApi = providerApi
    this.openUntil = openUntil
  }
}

/** Erro de configuracao (ex.: chave ausente). NUNCA interpola o valor do segredo. */
export class RapidApiConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RapidApiConfigError'
  }
}

/** Erro de payload: 2xx com corpo que nao e JSON valido. */
export class RapidApiInvalidPayloadError extends Error {
  readonly providerApi: string
  readonly endpoint: string

  constructor(providerApi: string, endpoint: string) {
    super(`RapidAPI ${providerApi} respondeu 2xx com JSON invalido em ${endpoint}.`)
    this.name = 'RapidApiInvalidPayloadError'
    this.providerApi = providerApi
    this.endpoint = endpoint
  }
}

/** O erro sinaliza circuito aberto? Deteccao ESTRUTURAL (nao acopla a classe). */
export function isCircuitOpenError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  if ((error as { name?: unknown }).name === 'RapidApiCircuitOpenError') return true
  return typeof (error as { openUntil?: unknown }).openUntil === 'number'
}

/** Status HTTP do erro, quando houver. */
export function statusOf(error: unknown): number | null {
  if (error !== null && typeof error === 'object') {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  return null
}
