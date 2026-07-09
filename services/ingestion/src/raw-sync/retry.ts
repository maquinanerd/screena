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

/** Opcoes do retry do core. */
export interface RetryOptions {
  /** Total de tentativas incluindo a primeira (>= 1). */
  readonly maxAttempts: number
  /** Espera entre tentativas (injetavel; sem timer real em teste). */
  readonly sleep: (ms: number) => Promise<void>
  /** Backoff em ms por tentativa (default: 0). */
  readonly backoffMs?: (attempt: number) => number
  /** Hook de observabilidade a cada retry. */
  readonly onRetry?: (info: { attempt: number; error: unknown; is429: boolean }) => void
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
 * Erro e retentavel? Transitorios sim, permanentes nao:
 *  - `TmdbHttpError` expoe `.permanent` (false = transitorio) -> respeita isso;
 *  - senao, por status: 429 e 5xx sao transitorios; 4xx (exceto 429) nao;
 *  - erro sem status (rede/timeout/desconhecido) -> transitorio.
 */
export function isRetryableError(error: unknown): boolean {
  if (error !== null && typeof error === 'object') {
    const permanent = (error as { permanent?: unknown }).permanent
    if (typeof permanent === 'boolean') return !permanent
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') return status === 429 || status >= 500
  }
  return true
}

/**
 * Executa `fn` com retry para erros transitorios, contando retries/429 em
 * `counters`. Erros permanentes (4xx exceto 429) lancam imediatamente. Ao esgotar
 * as tentativas, relanca o ultimo erro (o chamador conta como `failed`).
 */
export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  counters: RetryCounters,
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts)
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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
      const wait = options.backoffMs ? options.backoffMs(attempt) : 0
      await options.sleep(wait)
    }
  }

  throw lastError
}
