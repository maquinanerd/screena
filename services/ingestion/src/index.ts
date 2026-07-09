/**
 * @screena/ingestion — Ingestao de entidades (Fase 2).
 *
 * Superficie PURA (typecheckavel sem Prisma Client): tipos, utils e normalizers.
 * A orquestracao (`import/*`) e os ports tambem sao puros e exportados aqui.
 * Os adapters de persistencia que tocam Prisma vivem em `persistence/*` e NAO
 * sao reexportados (sao montados apenas no `bin/` em runtime).
 *
 * WORKER-ONLY: este pacote NUNCA e importado pelo render publico (apps/web).
 */

export * from './types.js'
export * from './ports.js'
export * from './seed-ids.js'
export * from './utils/normalize.js'
export * from './utils/hash.js'
export * from './utils/cache-key.js'
export * from './normalizers/external-ids.js'
export * from './normalizers/credits.js'
export * from './normalizers/movie.js'
export * from './normalizers/tv.js'
export * from './normalizers/season.js'
export * from './normalizers/episode.js'
export * from './normalizers/person.js'
export * from './discovery/id-exports.js'
export * from './discovery/adult-filter.js'
export * from './discovery/sync-queue.js'
export * from './discovery/changes-plan.js'
export * from './raw-sync/types.js'
export * from './raw-sync/args.js'
export * from './raw-sync/gate.js'
export * from './raw-sync/supported-kinds.js'
export * from './raw-sync/hash-decision.js'
export * from './raw-sync/retry.js'
export * from './raw-sync/queue.js'
export * from './raw-sync/run.js'
export * from './raw-sync/report.js'
export * from './raw-promote/types.js'
export * from './raw-promote/gate.js'
export * from './raw-promote/report.js'
export * from './raw-promote/run.js'
export * from './import/index.js'
