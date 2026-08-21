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
import {
  createPrismaTmdbWatchOfferStore,
  createPrismaWatchEntityResolver,
} from './persistence/watch-providers-store.js'
import { DEFAULT_WATCH_TERRITORIES } from './watch-providers/territories.js'
import type { ImportContext } from './import/types.js'

/** Janela de frescor do catalogo geral (7 dias) — espelha @screena/sync. */
const STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Janela de frescor da OFERTA (1 dia). Menor que a do detalhe de proposito:
 * "onde assistir" e o dado volatil da lista de periodicidades em
 * `.claude/rules/ingestion.md`; herdar os 7 dias do detalhe faria uma oferta
 * revogada continuar parecendo fresca por uma semana.
 */
const WATCH_STALE_WINDOW_MS = 24 * 60 * 60 * 1000

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
    // Mesmo sink do runtime do catalogo: sem ele, `bin/import`, `bin/sync-tmdb`
    // e o `services/sync` continuariam baixando `watch/providers` no payload de
    // detalhe e jogando fora. Toda linha nasce `display_allowed=false`.
    watch: {
      store: createPrismaTmdbWatchOfferStore(persistence.prisma),
      resolver: createPrismaWatchEntityResolver(persistence.prisma),
      territories: DEFAULT_WATCH_TERRITORIES,
      staleAfterMs: WATCH_STALE_WINDOW_MS,
    },
  }

  return { context, disconnect: disconnectPrisma }
}

export { importMovie, importPerson, importTvShow } from './import/index.js'
export { DEV_SEED_IDS } from './seed-ids.js'

/**
 * Reexports para o AGENDADOR (`@screena/sync`).
 *
 * `buildIdempotencyKey` e `ingestWatchProvidersFromDetail` sao as duas pecas que
 * o agendador precisa para enfileirar sem duplicar e para gravar a oferta pelo
 * MESMO escritor das outras cadeias. Reexporta-las aqui (e nao deixar o
 * agendador alcancar `src/**` por caminho profundo) mantem a fronteira do
 * pacote: `@screena/ingestion/runtime` continua sendo a UNICA porta de entrada
 * do runtime worker-only.
 */
export { buildIdempotencyKey } from './catalog-jobs/idempotency.js'
export {
  buildCoverageJob,
  buildCoverageJobs,
  COVERAGE_PRIORITY,
  COVERAGE_REASONS,
  popularityPriorityOffset,
  type CoverableKind,
  type CoverageReason,
  type CoverageRequest,
} from './entity-coverage/entry.js'
export { createCatalogServices, type CatalogServices } from './persistence/catalog-services.js'
export {
  ingestWatchProvidersFromDetail,
  type DetailWatchOutcome,
  type DetailWatchReport,
  type DetailWatchSink,
} from './watch-providers/from-detail.js'
