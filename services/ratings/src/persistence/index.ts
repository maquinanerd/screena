/**
 * persistence/index.ts — Adapters Prisma do worker de ratings.
 *
 * EXCLUIDOS do typecheck e do bundle de render. Montados apenas pelo `bin/`.
 */

export * from './cache.js'
export * from './sync-log.js'
export * from './external-ratings-store.js'
export * from './entity-lookup.js'
export * from './entity-candidates.js'
