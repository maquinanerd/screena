/**
 * handlers — Handlers reais dos 11 tipos de job do catalogo (Backend A).
 *
 * Barrel do lado TIPADO: schemas (validacao de payload), ports (contratos dos
 * servicos), support (classificacao de erro / labels seguras), os 11 handlers e
 * a composicao de producao (`createCatalogHandlerRegistry`).
 *
 * O wiring com Prisma/TMDB real vive em `bin/catalog.ts` (fora do typecheck).
 */

export * from './schemas.js'
export * from './ports.js'
export * from './support.js'
export * from './bootstrap-handler.js'
export * from './discover-ids-handler.js'
export * from './sync-details-handler.js'
export * from './sync-credits-handler.js'
export * from './sync-external-ids-handler.js'
export * from './sync-media-handler.js'
export * from './sync-seasons-handler.js'
export * from './sync-episodes-handler.js'
export * from './sync-lists-handler.js'
export * from './sync-changes-handler.js'
export * from './reprocess-raw-handler.js'
export * from './registry.js'
