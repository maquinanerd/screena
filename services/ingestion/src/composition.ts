/**
 * composition.ts — Wiring runtime da ingestao. EXCLUIDO do typecheck (toca Prisma).
 *
 * Monta um `ImportContext` real: client TMDB (fetch + env) + adapters Prisma
 * (cache/sync-log/store) + relogio + politica de stale. Usado pelo CLI e pelo
 * runner de sync. NUNCA importado pelo render publico.
 *
 * A janela de stale e mantida local aqui para evitar dependencia ciclica com
 * @screena/sync; a politica canonica (e seus testes) vive em @screena/sync.
 */

import { createTmdbClient, type CreateTmdbClientOptions } from '@screena/tmdb-client'
import { disconnectPrisma } from '@screena/db/server'
import { createPersistence } from './persistence/index.js'
import type { ImportContext } from './import/types.js'

/** Janela de frescor do catalogo geral (7 dias) — espelha @screena/sync. */
const STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** Runtime da ingestao: contexto pronto + funcao de desconexao. */
export interface IngestionRuntime {
  readonly context: ImportContext
  readonly disconnect: () => Promise<void>
}

/** Monta o contexto real (TMDB + Prisma) a partir do ambiente. */
export function createIngestionContext(options: CreateTmdbClientOptions = {}): IngestionRuntime {
  const client = createTmdbClient(options)
  const persistence = createPersistence({ ttlMs: client.config.cacheTtlMs })

  const context: ImportContext = {
    tmdb: client.endpoints,
    cache: persistence.cache,
    store: persistence.store,
    syncLog: persistence.syncLog,
    now: () => new Date(),
    staleAfter: (now) => new Date(now.getTime() + STALE_WINDOW_MS),
  }

  return { context, disconnect: disconnectPrisma }
}

export { importMovie, importPerson, importTvShow } from './import/index.js'
export { DEV_SEED_IDS } from './seed-ids.js'
