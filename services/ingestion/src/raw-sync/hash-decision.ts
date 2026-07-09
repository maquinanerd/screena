/**
 * hash-decision.ts — Decisao de gravacao por hash (idempotencia). Modulo PURO.
 *
 * Regra (P0-00d, ingestao "hash de payload"):
 *  - hash AUSENTE (registro novo)         -> create
 *  - hash IGUAL ao armazenado             -> skip (sem update, sem bump de updatedAt)
 *  - hash DIFERENTE                        -> update (payload/hash/fetchedAt)
 *
 * O hash reusa `hashPayload` (stable-stringify + sha256), o MESMO usado por
 * `api_cache` — o hash nao depende da ordem das chaves do JSON, entao um payload
 * equivalente produz sempre o mesmo hash (idempotencia real).
 */

import { hashPayload } from '../utils/hash.js'
import type { RawWriteOutcome } from './types.js'

/** Hash estavel do payload bruto (delegado ao util canonico). */
export function computeRawPayloadHash(payload: unknown): string {
  return hashPayload(payload)
}

/** Decide o desfecho de gravacao comparando o hash existente com o novo. */
export function decideRawOutcome(existingHash: string | null, newHash: string): RawWriteOutcome {
  if (existingHash === null) return 'create'
  return existingHash === newHash ? 'skip' : 'update'
}
