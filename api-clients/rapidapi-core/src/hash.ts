/**
 * hash.ts — Hash estavel de payloads (rastreabilidade + short-circuit de cache).
 *
 * `stableStringify` serializa com chaves ordenadas recursivamente, para que o
 * hash nao dependa da ordem das chaves no JSON original. Usado em
 * `api_cache.payload_hash`, em `external_ratings.provider_payload_hash` e na
 * comparacao "sem mudanca" (regra: nao reescreve a tabela final nem bumpa
 * `updated_at` quando o hash e igual).
 *
 * Espelha `services/ingestion/src/utils/hash.ts` — deliberadamente duplicado por
 * valor, para que os clients RapidAPI nao dependam do servico de ingestao.
 */

import { createHash } from 'node:crypto'

/** Serializa um valor de forma deterministica (chaves de objeto ordenadas). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue)
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortValue(source[key])
    }
    return sorted
  }
  return value
}

/** SHA-256 hex de uma string. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** SHA-256 hex do `stableStringify` de um valor (hash de payload). */
export function hashPayload(value: unknown): string {
  return sha256Hex(stableStringify(value))
}
