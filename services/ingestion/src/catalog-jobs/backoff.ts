/**
 * backoff.ts — Backoff exponencial com jitter para retry de jobs (PURO).
 *
 * Distinto do backoff de HTTP (services/ingestion/src/raw-sync/retry.ts, que
 * reage a 429/Retry-After por REQUISICAO). Aqui e o backoff de AGENDAMENTO de um
 * JOB na fila: quando um job falha e ainda ha tentativas, ele volta a
 * `retry_wait` com `available_at = now + computeJobBackoffMs(attempts)`.
 *
 * Funcao pura: `jitter` (em [0,1)) e injetado para tornar o resultado
 * deterministico e testavel (nada de Math.random aqui).
 */

/** Configuracao do backoff exponencial. */
export interface JobBackoffConfig {
  /** Atraso base da 1a tentativa de retry, em ms. */
  readonly baseMs: number
  /** Fator de crescimento exponencial (>= 1). */
  readonly factor: number
  /** Teto do atraso, em ms (evita esperas absurdas). */
  readonly maxMs: number
}

/** Backoff padrao: 1s base, dobrando, ate 1h. */
export const DEFAULT_JOB_BACKOFF: JobBackoffConfig = {
  baseMs: 1_000,
  factor: 2,
  maxMs: 3_600_000,
}

/** Limita um numero ao intervalo [0, 1). */
function clampJitter(jitter: number): number {
  if (!Number.isFinite(jitter) || jitter < 0) return 0
  if (jitter >= 1) return 0.999999
  return jitter
}

/**
 * Calcula o atraso (ms) antes da tentativa `attempt` (>= 1).
 *
 * base * factor^(attempt-1), limitado a maxMs, com "full jitter" no intervalo
 * [metade, cheio]: o resultado fica em `[capped/2, capped]`. Isso dispersa
 * retries simultaneos (evita thundering herd) sem nunca ultrapassar maxMs.
 */
export function computeJobBackoffMs(
  attempt: number,
  jitter: number,
  config: JobBackoffConfig = DEFAULT_JOB_BACKOFF,
): number {
  const exponent = Math.max(0, Math.floor(attempt) - 1)
  const raw = config.baseMs * Math.pow(config.factor, exponent)
  const capped = Math.min(raw, config.maxMs)
  const jittered = capped / 2 + (capped / 2) * clampJitter(jitter)
  return Math.round(Math.min(jittered, config.maxMs))
}
