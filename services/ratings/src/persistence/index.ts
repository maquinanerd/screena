/**
 * persistence/index.ts — Adapters Prisma do worker de ratings.
 *
 * COBERTOS pelo typecheck da raiz E por `tsconfig.runtime.json`; fora do bundle de
 * render. Montados apenas pelo `bin/`.
 */

export * from './cache.js'
export * from './sync-log.js'
export * from './external-ratings-store.js'
export * from './entity-lookup.js'
export * from './entity-candidates.js'
export * from './awards-cache-source.js'
export * from './awards-credit-lookup.js'
export * from './awards-store.js'
