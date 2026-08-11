/**
 * retrying-object-store.ts — Decorador que da retry com backoff exponencial a
 * QUALQUER {@link RawObjectStore}. Modulo PURO (sleep e random injetaveis).
 *
 * Por que decorador e nao codigo dentro do adapter S3: assim o retry e provado
 * UMA vez, contra o store em memoria, e vale para todo adapter presente e
 * futuro. Um retry escondido dentro do SDK seria intestavel.
 *
 * O que e retentado: `RawStoreUnavailableError` (rede, 5xx, throttling). O que
 * NAO e: erro de chave (`RawStoreKeyError`) e qualquer erro permanente — insistir
 * num pedido malformado so queima tempo. Esgotadas as tentativas, o ULTIMO erro
 * e RELANCADO: um lote nunca prossegue achando que a escrita deu certo.
 */

import type { RawObjectHead, RawObjectStore } from './object-store.js'
import { isRawStoreUnavailableError } from './object-store.js'

/** Base do backoff exponencial, em ms. */
export const RAW_STORE_BACKOFF_BASE_MS = 250
/** Teto do backoff, em ms. */
export const RAW_STORE_BACKOFF_MAX_MS = 8_000
/** Fator de crescimento. */
export const RAW_STORE_BACKOFF_FACTOR = 2

/** Configuracao do decorador. */
export interface RetryingObjectStoreOptions {
  /** Total de tentativas por operacao (1 = sem retry). */
  readonly maxAttempts: number
  readonly sleep: (ms: number) => Promise<void>
  readonly baseMs?: number
  readonly maxMs?: number
  readonly factor?: number
  /** Jitter aleatorio somado ao backoff, para nao sincronizar workers. */
  readonly jitterMs?: number
  readonly random?: () => number
  /** Observabilidade: chamado a cada retentativa. */
  readonly onRetry?: (info: {
    readonly operation: string
    readonly attempt: number
    readonly delayMs: number
    readonly error: unknown
  }) => void
}

/** Atraso da tentativa `attempt` (1-based). Puro e deterministico com `random`. */
export function rawStoreBackoffMs(attempt: number, options: RetryingObjectStoreOptions): number {
  const base = options.baseMs ?? RAW_STORE_BACKOFF_BASE_MS
  const max = options.maxMs ?? RAW_STORE_BACKOFF_MAX_MS
  const factor = options.factor ?? RAW_STORE_BACKOFF_FACTOR
  const jitter = options.jitterMs ?? base
  const random = options.random ?? Math.random
  const exponential = base * factor ** Math.max(0, attempt - 1)
  return Math.min(Math.round(exponential + random() * jitter), max)
}

async function withRetry<T>(
  operation: string,
  fn: () => Promise<T>,
  options: RetryingObjectStoreOptions,
): Promise<T> {
  const attempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0 ? options.maxAttempts : 1
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      // Erro permanente (chave invalida, contrato quebrado): insistir e desperdicio.
      if (!isRawStoreUnavailableError(error)) throw error
      if (attempt === attempts) break
      const delayMs = rawStoreBackoffMs(attempt, options)
      options.onRetry?.({ operation, attempt, delayMs, error })
      await options.sleep(delayMs)
    }
  }
  // Relanca o ULTIMO erro: o chamador precisa saber que a operacao NAO ocorreu.
  throw lastError
}

/** Envolve um store de objetos com retry + backoff exponencial. */
export function withObjectStoreRetry(
  inner: RawObjectStore,
  options: RetryingObjectStoreOptions,
): RawObjectStore {
  return {
    driver: inner.driver,
    head: (key: string): Promise<RawObjectHead | null> =>
      withRetry('head', () => inner.head(key), options),
    put: (input): Promise<RawObjectHead> => withRetry('put', () => inner.put(input), options),
    get: (key: string): Promise<string | null> => withRetry('get', () => inner.get(key), options),
    delete: (key: string): Promise<void> => withRetry('delete', () => inner.delete(key), options),
  }
}
