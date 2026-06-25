/**
 * persistence/index.ts — Montagem dos adapters Prisma. EXCLUIDO do typecheck.
 *
 * Une cache (`api_cache`), sync-log (`api_sync_logs`) e store (entidades) sobre
 * um unico Prisma Client server-only. Usado apenas pelo `bin/` em runtime; o
 * render NUNCA importa este modulo.
 */

import { getPrismaClient, type PrismaClient } from '@screena/db/server'
import type { CachePort, EntityStorePort, SyncLogPort } from '../ports.js'
import { createPrismaCache } from './cache.js'
import { createPrismaStore } from './store.js'
import { createPrismaSyncLog } from './sync-log.js'

/** Adapters de persistencia prontos para a orquestracao. */
export interface PersistenceAdapters {
  readonly prisma: PrismaClient
  readonly cache: CachePort
  readonly syncLog: SyncLogPort
  readonly store: EntityStorePort
}

/** Opcoes de montagem da persistencia. */
export interface PersistenceOptions {
  readonly ttlMs: number
  readonly now?: () => Date
}

/** Monta os adapters Prisma (cache/sync-log/store) sobre o client singleton. */
export function createPersistence(options: PersistenceOptions): PersistenceAdapters {
  const prisma = getPrismaClient()
  const now = options.now ?? (() => new Date())
  return {
    prisma,
    cache: createPrismaCache(prisma, { ttlMs: options.ttlMs, now }),
    syncLog: createPrismaSyncLog(prisma),
    store: createPrismaStore(prisma),
  }
}
