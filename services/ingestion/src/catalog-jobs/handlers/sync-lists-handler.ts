/**
 * sync-lists-handler.ts — `sync_lists` (Backend A §12).
 *
 * Captura uma lista de descoberta (trending/popular/top_rated/upcoming/
 * now_playing/airing_today/on_the_air/discover) e persiste um SNAPSHOT imutavel.
 *
 * Tres propriedades que o render depende:
 *  - hash-noop: lista inalterada nao cria snapshot novo (`created=false`). Sem
 *    isso, cada ciclo empilharia um snapshot identico por lista.
 *  - itens de entidade nao promovida sao IGNORADOS pelo store — um snapshot
 *    nunca aponta para entidade que nao existe (link morto no render).
 *  - o render le o ultimo snapshot VALIDO; nunca chama o TMDB (invariante 3).
 */

import { CATALOG_METRIC_NAMES } from '../../metrics/index.js'
import {
  extractListItems,
  planDiscoverySnapshot,
  type DiscoveryItemPlan,
  type DiscoverySnapshotStorePort,
} from '../../discovery-snapshots/index.js'
import { hashPayload } from '../../utils/hash.js'
import type { CatalogJobContext, CatalogJobHandler } from '../handler.js'
import type { DiscoveryListFetchPort } from './ports.js'
import { validateSyncListsInput, type SyncListsInput } from './schemas.js'
import { classifySafeError, throwIfAborted } from './support.js'

/** Resultado serializavel do `sync_lists`. */
export interface SyncListsResult {
  readonly listType: string
  readonly entityType: string
  readonly locale: string
  readonly pages: number
  readonly items: number
  /** false = lista inalterada (hash-noop): nenhum snapshot novo foi criado. */
  readonly created: boolean
  readonly persistedItems: number
  readonly snapshotId: string | null
}

/** Dependencias do handler. */
export interface SyncListsHandlerDeps {
  readonly listFetch: DiscoveryListFetchPort
  readonly snapshots: DiscoverySnapshotStorePort
  readonly now?: () => Date
}

/** Teto de paginas por captura (uma lista de descoberta e um topo, nao um dump). */
const DEFAULT_MAX_PAGES = 5

/** Handler de `sync_lists`. */
export class SyncListsHandler implements CatalogJobHandler<SyncListsInput, SyncListsResult> {
  readonly type = 'sync_lists' as const

  constructor(private readonly deps: SyncListsHandlerDeps) {}

  validateInput(value: unknown): SyncListsInput {
    return validateSyncListsInput(value)
  }

  async execute(context: CatalogJobContext, input: SyncListsInput): Promise<SyncListsResult> {
    const now = this.deps.now ?? (() => new Date())
    const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES
    throwIfAborted(context.signal)
    await context.heartbeat()

    const items: DiscoveryItemPlan[] = []
    const rawPages: unknown[] = []
    let pages = 0

    try {
      for (let page = 1; page <= maxPages; page += 1) {
        throwIfAborted(context.signal)
        const response = await this.deps.listFetch.fetchPage({
          listType: input.listType,
          entityType: input.entityType,
          locale: input.locale,
          country: input.country,
          window: input.window,
          page,
          signal: context.signal,
        })
        context.metrics.increment(CATALOG_METRIC_NAMES.tmdbRequestsTotal, 1, {
          endpoint: 'discovery_list',
          list_type: input.listType,
          entity_type: input.entityType,
        })

        rawPages.push(response)
        // `startPosition` continua da pagina anterior: a ordem da lista e o dado.
        const pageItems = extractListItems(response, items.length)
        items.push(...pageItems)
        pages += 1
        await context.heartbeat()

        const totalPages =
          typeof response.total_pages === 'number' && response.total_pages > 0
            ? response.total_pages
            : null
        if (pageItems.length === 0) break
        if (totalPages !== null && page >= totalPages) break
      }
    } catch (error) {
      context.metrics.increment(CATALOG_METRIC_NAMES.jobsFailedTotal, 1, {
        job_type: this.type,
        entity_type: input.entityType,
        list_type: input.listType,
        error_class: classifySafeError(error),
      })
      throw error
    }

    // O hash cobre o CONTEUDO paginado, nao a resposta crua: `page`/`total_pages`
    // do provider podem oscilar sem a lista mudar.
    const payloadHash = hashPayload(
      items.map((item) => [item.entityTmdbId, item.position, item.providerScore]),
    )

    const capturedAt = now()
    const plan = planDiscoverySnapshot({
      listType: input.listType,
      entityType: input.entityType,
      locale: input.locale,
      country: input.country,
      window: input.window,
      items,
      payloadHash,
      capturedAt,
    })

    const saved = await this.deps.snapshots.saveSnapshot(plan)

    context.metrics.gauge(CATALOG_METRIC_NAMES.discoverySnapshotAgeSeconds, 0, {
      list_type: input.listType,
      entity_type: input.entityType,
      locale: input.locale,
    })
    context.metrics.increment(CATALOG_METRIC_NAMES.entitiesSyncedTotal, saved.items, {
      job_type: this.type,
      entity_type: input.entityType,
      list_type: input.listType,
      result: saved.created ? 'created' : 'unchanged',
    })

    context.log.log('info', saved.created ? 'catalog_snapshot_created' : 'catalog_snapshot_noop', {
      jobId: context.jobId,
      listType: input.listType,
      entityType: input.entityType,
      pages,
      items: items.length,
      persisted: saved.items,
    })

    return {
      listType: input.listType,
      entityType: input.entityType,
      locale: input.locale,
      pages,
      items: items.length,
      created: saved.created,
      persistedItems: saved.items,
      snapshotId: saved.id,
    }
  }
}
