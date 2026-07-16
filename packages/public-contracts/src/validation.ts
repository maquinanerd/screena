/**
 * validation.ts — Toolkit PURO de validacao dos contratos publicos.
 *
 * Sem zod (o repo nao usa zod — ver ADR 0012) e sem Prisma. Cada validador de
 * payload acumula erros com estes helpers e devolve um `ValidationResult`.
 * A forma segue o padrao de packages/schemas (funcoes puras, retorno
 * `{ ok, errors }`).
 */

/** Resultado de uma validacao: ok + erros + valor tipado quando ok. */
export interface ValidationResult<T> {
  readonly ok: boolean
  readonly errors: readonly string[]
  readonly value: T | null
}

/** Constroi um resultado de sucesso. */
export function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, errors: [], value }
}

/** Constroi um resultado de falha (sem valor). */
export function fail<T>(errors: readonly string[]): ValidationResult<T> {
  return { ok: false, errors, value: null }
}

/** Type guard: objeto simples (nao array, nao null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Erro se `value` nao for string nao-vazia. */
export function requireString(value: unknown, label: string): string[] {
  if (typeof value !== 'string') return [`${label}: esperado string`]
  if (value.length === 0) return [`${label}: string vazia nao permitida`]
  return []
}

/** Erro se `value` (quando presente) nao for string. undefined/null sao ok. */
export function optionalString(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return []
  if (typeof value !== 'string') return [`${label}: quando presente deve ser string`]
  return []
}

/** Erro se `value` nao for number finito, ou (quando permitido) null. */
export function requireNumberOrNull(value: unknown, label: string): string[] {
  if (value === null) return []
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return [`${label}: esperado number finito ou null`]
  }
  return []
}

/** Erro se `value` nao for boolean. */
export function requireBoolean(value: unknown, label: string): string[] {
  if (typeof value !== 'boolean') return [`${label}: esperado boolean`]
  return []
}

/** Erro se `value` nao pertencer ao conjunto `allowed`. */
export function requireEnum(value: unknown, label: string, allowed: readonly string[]): string[] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    return [`${label}: esperado um de [${allowed.join(', ')}]`]
  }
  return []
}

/**
 * Erro se `value` nao for array; valida cada item com `check` (que devolve os
 * erros do item ja rotulados por indice).
 */
export function requireArray(
  value: unknown,
  label: string,
  check: (item: unknown, index: number) => string[],
): string[] {
  if (!Array.isArray(value)) return [`${label}: esperado array`]
  const errors: string[] = []
  value.forEach((item, index) => {
    errors.push(...check(item, index))
  })
  return errors
}
