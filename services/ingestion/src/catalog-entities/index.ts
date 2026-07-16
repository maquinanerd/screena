/**
 * catalog-entities — Entidades de referencia do catalogo (Backend A §6).
 *
 * Barrel dos modulos PUROS (normalizadores + porta). O adapter Prisma vive em
 * services/ingestion/src/persistence/catalog-entities-store.ts.
 */

export * from './normalize.js'
export * from './store-port.js'
