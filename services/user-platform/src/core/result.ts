/**
 * Resultado de dominio compartilhado da user platform.
 *
 * PURO: nao faz rede, DB nem IO. Segue o estilo do repo (packages/schemas):
 * acumulacao de erros com mensagens pt-BR + wrapper de assert na fronteira
 * de escrita.
 */

/** Codigos estaveis de erro de dominio (contrato para a borda HTTP futura). */
export type DomainErrorCode =
  | "validation_failed"
  | "not_found"
  | "conflict"
  | "version_conflict" // optimistic locking (Expected-Version defasada)
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "locked_out"
  | "csrf_mismatch"
  | "idempotency_replay"
  | "precondition_failed"
  | "limit_exceeded";

export interface DomainError {
  readonly code: DomainErrorCode;
  /** Mensagem pt-BR SEGURA para o usuario final (nunca vaza segredo/enumeracao). */
  readonly message: string;
  /** Detalhes de validacao (quando code = validation_failed). */
  readonly details?: readonly string[];
}

export type DomainResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DomainError };

export function ok<T>(value: T): DomainResult<T> {
  return { ok: true, value };
}

export function err<T = never>(
  code: DomainErrorCode,
  message: string,
  details?: readonly string[],
): DomainResult<T> {
  return { ok: false, error: { code, message, details } };
}

/** Resultado de validacao pura no estilo packages/schemas. */
export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: string[];
}

export function validationOk(): ValidationResult {
  return { ok: true, errors: [] };
}

export function collect(errors: string[]): ValidationResult {
  return { ok: errors.length === 0, errors };
}
