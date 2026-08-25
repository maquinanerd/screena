/**
 * import/errors.ts — Classificacao de erros da orquestracao.
 *
 * Circuit breaker aberto vira status `aborted` (degradacao da fonte); demais
 * erros viram `failed`. A orquestracao nunca relanca: loga e segue (o pipeline
 * nao cai por uma entidade).
 *
 * Este e o PRIMEIRO ponto em que a causa de uma falha de import deixa de ser um
 * objeto `Error` e vira dado. O que for descartado aqui esta descartado para
 * sempre — nem o worker nem o banco recuperam depois. Por isso saem TRES campos,
 * nao um: `message` (achatada, com a cadeia de `cause`), `code` (codigo de
 * driver/HTTP quando existe) e `status` (HTTP numerico quando existe).
 *
 * `code` e `status` existem porque `classifySafeError` classifica por eles. Sem
 * carrega-los, uma falha de banco ou um 429 do TMDB dentro do import chegavam a
 * metrica como `error_class: "unknown"`.
 */

import { errorMessageWithCauses, flattenErrorText } from '../utils/error-text.js'

/** Info derivada de um erro capturado. */
export interface ErrorInfo {
  /** Codigo de driver/HTTP quando existe (`P2003`, `ECONNRESET`); senao o `name`. */
  readonly code: string
  /** Mensagem em UMA linha, com a cadeia de `cause` anexada. */
  readonly message: string
  readonly aborted: boolean
  /** Status HTTP quando o erro carrega um (`TmdbHttpError.status`). */
  readonly status: number | null
}

/** Le uma propriedade string nao vazia de um erro (ex.: `code` de driver). */
function readCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const value: unknown = (error as Record<string, unknown>).code
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Le `status` numerico de um erro tipo HTTP sem assumir a classe concreta. */
function readStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const value: unknown = (error as Record<string, unknown>).status
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Descreve um erro desconhecido de forma segura. */
export function describeError(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    return {
      code: readCode(error) ?? error.name,
      message: errorMessageWithCauses(error),
      aborted: error.name === 'TmdbCircuitOpenError',
      status: readStatus(error),
    }
  }
  return {
    code: 'UnknownError',
    message: flattenErrorText(String(error)),
    aborted: false,
    status: null,
  }
}
