/**
 * catalog-jobs — Dominio PURO da fila duravel de jobs do catalogo (Backend A).
 *
 * Barrel dos contratos + planejadores puros. Os adapters Prisma (claim FOR
 * UPDATE SKIP LOCKED, heartbeat, reclaim, dead-letter) ficam em
 * services/ingestion/src/persistence/catalog-job-store.ts (excluido do
 * typecheck), consumindo estes planejadores.
 */

export * from './types.js'
export * from './idempotency.js'
export * from './backoff.js'
export * from './transitions.js'
export * from './store-port.js'
