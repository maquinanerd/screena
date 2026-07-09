/**
 * retry.ts — Retry MINIMO com contagem, para 429/5xx/rede. Modulo PURO.
 *
 * IMPORTANTE (camadas de retry): o `TmdbHttpClient` (api-clients/tmdb) JA aplica
 * throttle + retry/backoff/jitter + Retry-After + circuit breaker na camada de
 * rede. Este retry do core e uma segunda linha, mais fina, cujo papel principal e
 * OBSERVABILIDADE (contar retries/429 que ainda cheguem ao worker) e o contrato
 * de teste com um source fake (que lanca 429 direto no core, sem passar pelo
 * client real). Por isso o default de `maxAttempts` do piloto e baixo.
 *
 * Sem tempo real: `sleep` e injetado; `backoffMs` e opcional e injetavel — os
 * testes rodam sem timers reais.
 */

/** Contadores acumulados entre chamadas (mutados in-place). */
export interface RetryCounters {
  retries: number
  rate429: number
}

/** Contexto de uma decisao de backoff (o que acabou de falhar). */
export interface BackoffInfo {
  /** Numero da tentativa que acabou de falhar (1-based). */
  readonly attempt: number
  /** A falha foi 429 (rate limit)? — recebe backoff mais generoso. */
  readonly is429: boolean
  /** Retry-After em ms extraido do erro, quando o upstream informa (senao null). */
  readonly retryAfterMs: number | null
}

/** Opcoes do retry do core. */
export interface RetryOptions {
  /** Total de tentativas incluindo a primeira (>= 1). */
  readonly maxAttempts: number
  /** Espera entre tentativas (injetavel; sem timer real em teste). */
  readonly sleep: (ms: number) => Promise<void>
  /** Backoff em ms para a proxima tentativa (default: 0). Recebe o contexto da falha. */
  readonly backoffMs?: (info: BackoffInfo) => number
  /** Hook de observabilidade a cada retry. */
  readonly onRetry?: (info: { attempt: number; error: unknown; is429: boolean }) => void
  /**
   * Chamado IMEDIATAMENTE antes de cada tentativa de `fn()`. Serve para o
   * chamador contar requisicoes efetivas (teto de requisicoes do run). Nunca
   * altera o fluxo — apenas observa.
   */
  readonly onAttempt?: () => void
}

/** Extrai o status HTTP do erro, se houver (`TmdbHttpError` expoe `.status`). */
export function statusOf(error: unknown): number | null {
  if (error !== null && typeof error === 'object') {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  return null
}

/**
 * O erro sinaliza circuito aberto? (`TmdbCircuitOpenError` da camada de rede).
 * Detectado ESTRUTURALMENTE (nunca importa o client): pelo `name` ou por expor
 * um `openUntil` numerico. Circuito aberto significa "fonte degradada, chamadas
 * suspensas ate cooldown" — retentar de imediato so gira em falso.
 */
export function isCircuitOpenError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  if ((error as { name?: unknown }).name === 'TmdbCircuitOpenError') return true
  return typeof (error as { openUntil?: unknown }).openUntil === 'number'
}

/**
 * Extrai um Retry-After (em ms) do erro, quando o upstream o propaga. Aceita
 * `retryAfterMs` (ms) direto ou `retryAfter` (segundos). Retorna null quando o
 * erro nao carrega essa informacao (caso comum: o client ja consumiu o
 * Retry-After internamente e o core cai no backoff exponencial).
 */
export function retryAfterMsOf(error: unknown): number | null {
  if (error === null || typeof error !== 'object') return null
  const ms = (error as { retryAfterMs?: unknown }).retryAfterMs
  if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) return ms
  const seconds = (error as { retryAfter?: unknown }).retryAfter
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  return null
}

/**
 * Erro e retentavel? Transitorios sim, permanentes nao:
 *  - circuito aberto -> NUNCA (cooldown pendente; retentar so gira em falso);
 *  - `TmdbHttpError` expoe `.permanent` (false = transitorio) -> respeita isso;
 *  - senao, por status: 429 e 5xx sao transitorios; 4xx (exceto 429) nao;
 *  - erro sem status (rede/timeout/desconhecido) -> transitorio.
 */
export function isRetryableError(error: unknown): boolean {
  if (isCircuitOpenError(error)) return false
  if (error !== null && typeof error === 'object') {
    const permanent = (error as { permanent?: unknown }).permanent
    if (typeof permanent === 'boolean') return !permanent
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') return status === 429 || status >= 500
  }
  return true
}

/** Defaults da politica de backoff do raw sync (2a linha, apos o client). */
export const DEFAULT_BACKOFF_BASE_MS = 500
export const DEFAULT_BACKOFF_MAX_MS = 10_000
export const DEFAULT_BACKOFF_FACTOR = 2

/** Configuracao da politica de backoff (tudo injetavel; puro/deterministico). */
export interface BackoffConfig {
  /** Base do backoff exponencial em ms (default 500). */
  readonly baseMs?: number
  /** Teto absoluto de espera em ms (default 10_000). Limita ate o Retry-After. */
  readonly maxMs?: number
  /** Fator exponencial (default 2). */
  readonly factor?: number
  /** Jitter maximo somado em ms (default = baseMs). Deterministico via `random`. */
  readonly jitterMs?: number
  /** Fonte de aleatoriedade do jitter (default Math.random). Injetavel em teste. */
  readonly random?: () => number
}

/**
 * Politica CLARA de backoff (inclui 429), pura e testavel:
 *  1. se o upstream informou `Retry-After`, respeita-o (limitado ao teto);
 *  2. senao, backoff exponencial `base * factor^expoente` + jitter, com teto;
 *     429 sobe UM degrau no expoente (mais folga para o rate limit ceder).
 */
export function computeBackoffMs(info: BackoffInfo, config: BackoffConfig = {}): number {
  const maxMs = config.maxMs ?? DEFAULT_BACKOFF_MAX_MS
  if (info.retryAfterMs !== null && info.retryAfterMs >= 0) {
    return Math.min(info.retryAfterMs, maxMs)
  }
  const baseMs = config.baseMs ?? DEFAULT_BACKOFF_BASE_MS
  const factor = config.factor ?? DEFAULT_BACKOFF_FACTOR
  const jitterMs = config.jitterMs ?? baseMs
  const random = config.random ?? Math.random
  const exponent = Math.max(0, info.attempt - 1) + (info.is429 ? 1 : 0)
  const exponential = baseMs * factor ** exponent
  const jitter = random() * jitterMs
  return Math.min(exponential + jitter, maxMs)
}

/** Factory: devolve um `backoffMs` (para `RetryOptions`) com a politica canonica. */
export function createRawSyncBackoff(config: BackoffConfig = {}): (info: BackoffInfo) => number {
  return (info: BackoffInfo) => computeBackoffMs(info, config)
}

/**
 * Executa `fn` com retry para erros transitorios, contando retries/429 em
 * `counters`. Erros permanentes (4xx exceto 429) e circuito aberto lancam
 * imediatamente. Ao esgotar as tentativas, relanca o ultimo erro (o chamador
 * conta como `failed`). `onAttempt` dispara antes de cada `fn()` para o teto de
 * requisicoes; `backoffMs` recebe o contexto (attempt/is429/retryAfterMs).
 */
export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  counters: RetryCounters,
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts)
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    options.onAttempt?.()
    try {
      return await fn()
    } catch (error) {
      lastError = error
      const is429 = statusOf(error) === 429
      if (!isRetryableError(error) || attempt >= maxAttempts) {
        throw error
      }
      counters.retries += 1
      if (is429) counters.rate429 += 1
      options.onRetry?.({ attempt, error, is429 })
      const retryAfterMs = retryAfterMsOf(error)
      const wait = options.backoffMs ? options.backoffMs({ attempt, is429, retryAfterMs }) : 0
      await options.sleep(wait)
    }
  }

  throw lastError
}
