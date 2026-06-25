/**
 * import/errors.ts — Classificacao de erros da orquestracao.
 *
 * Circuit breaker aberto vira status `aborted` (degradacao da fonte); demais
 * erros viram `failed`. A orquestracao nunca relanca: loga e segue (o pipeline
 * nao cai por uma entidade).
 */

/** Info derivada de um erro capturado. */
export interface ErrorInfo {
  readonly code: string
  readonly message: string
  readonly aborted: boolean
}

/** Descreve um erro desconhecido de forma segura. */
export function describeError(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    return {
      code: error.name,
      message: error.message,
      aborted: error.name === 'TmdbCircuitOpenError',
    }
  }
  return { code: 'UnknownError', message: String(error), aborted: false }
}
