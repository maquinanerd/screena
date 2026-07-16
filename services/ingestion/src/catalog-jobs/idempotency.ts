/**
 * idempotency.ts — Chave de idempotencia de enfileiramento (PURO).
 *
 * Dois enfileiramentos com a MESMA chave sao o mesmo trabalho: o segundo e um
 * noop (o unique de `idempotency_key` no banco garante isso; o adapter trata a
 * colisao como created=false). A chave e deterministica e legivel — reexecutar
 * o mesmo plano de bootstrap/sync nunca cria duplicatas.
 */

import type { CatalogEntityKind, CatalogJobType } from './types.js'

/** Entrada para derivar a chave de idempotencia de um job. */
export interface IdempotencyInput {
  readonly jobType: CatalogJobType
  /** Alvo do job (null para jobs sem alvo unico, ex.: bootstrap). */
  readonly entityType?: CatalogEntityKind | null
  /** ID externo (ex.: tmdb_id como texto). */
  readonly externalId?: string | null
  /**
   * Discriminador que distingue jobs do mesmo alvo/tipo mas escopo diferente
   * (ex.: janela de changes "2026-07-10:2026-07-16", pagina "p3", locale).
   * Sem discriminador, todos os jobs do mesmo (tipo, alvo) colapsam num so.
   */
  readonly discriminator?: string | null
}

/** Normaliza um segmento da chave: vazio/nulo vira "-"; espacos viram "_". */
function segment(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  if (trimmed.length === 0) return '-'
  return trimmed.replace(/\s+/g, '_')
}

/**
 * Deriva a chave de idempotencia deterministica de um job.
 *
 * Formato: `<jobType>:<entityType>:<externalId>:<discriminator>`. Puro e
 * estavel — a mesma entrada sempre produz a mesma chave.
 */
export function buildIdempotencyKey(input: IdempotencyInput): string {
  return [
    segment(input.jobType),
    segment(input.entityType ?? null),
    segment(input.externalId ?? null),
    segment(input.discriminator ?? null),
  ].join(':')
}
