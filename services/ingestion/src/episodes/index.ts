/**
 * episodes — Caminho de episodio do catalogo (Backend A §7).
 *
 * Barrel dos modulos PUROS (normalizadores + porta). O adapter Prisma vive em
 * services/ingestion/src/persistence/episode-store.ts.
 */

export * from './normalize.js'
export * from './store-port.js'
