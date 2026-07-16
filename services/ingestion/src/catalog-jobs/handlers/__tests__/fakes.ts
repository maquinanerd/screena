/**
 * fakes.ts — Fakes em memoria dos servicos e do contexto de job.
 *
 * Nenhum fake toca rede ou banco. Cada um REGISTRA suas chamadas, para o teste
 * poder provar que o handler realmente delegou ao servico (e nao devolveu
 * sucesso fingido) e com quais argumentos.
 */

import { createInMemoryMetricsSink, type InMemoryMetricsSink } from '../../../metrics/index.js'
import type { CatalogJobContext, StructuredLogger } from '../../handler.js'
import type {
  CatalogJobStorePort,
  EnqueueCatalogJobInput,
  EnqueueResult,
} from '../../store-port.js'
import type {
  DiscoverySnapshotPlan,
  DiscoverySnapshotStorePort,
  SaveSnapshotResult,
} from '../../../discovery-snapshots/index.js'
import type { ChangesPage } from '../../../changes/run.js'
import type { ChangesKind } from '../../../discovery/changes-plan.js'
import type { CatalogHandlerDependencies } from '../registry.js'
import type {
  CreditsSyncInput,
  DetailSyncInput,
  DetailSyncOutcome,
  DiscoverIdsPortInput,
  DiscoveryListFetchInput,
  EpisodesSyncInput,
  ExternalIdsSyncInput,
  MediaSyncInput,
  ReprocessRawPortInput,
  SeasonsSyncInput,
} from '../ports.js'

/** Fila fake: guarda os enqueues e deduplica por `idempotencyKey`. */
export interface FakeJobStore extends CatalogJobStorePort {
  readonly enqueued: EnqueueCatalogJobInput[]
  readonly keys: Set<string>
}

/** Cria a fila fake (enqueue idempotente, como o unique do banco). */
export function createFakeJobStore(): FakeJobStore {
  const enqueued: EnqueueCatalogJobInput[] = []
  const keys = new Set<string>()
  let nextId = 1

  return {
    enqueued,
    keys,
    async enqueue(input: EnqueueCatalogJobInput): Promise<EnqueueResult> {
      // Chave repetida = mesmo trabalho = noop (espelha o unique de
      // idempotency_key). O teste de resume depende exatamente disto.
      if (keys.has(input.idempotencyKey)) return { id: '0', created: false }
      keys.add(input.idempotencyKey)
      enqueued.push(input)
      return { id: String(nextId++), created: true }
    },
    async claimNext() {
      return null
    },
    async heartbeat() {},
    async complete() {},
    async applyFailure() {},
    async reclaimOrphans() {
      return { requeued: 0, deadLettered: 0 }
    },
    async listDeadLetter() {
      return []
    },
    async replayDeadLetter() {
      return 0
    },
  }
}

/** Contexto de job fake, com contagem de heartbeat e sinal controlavel. */
export interface FakeContext {
  readonly context: CatalogJobContext
  readonly metrics: InMemoryMetricsSink
  readonly logs: { level: string; event: string; fields?: Record<string, unknown> }[]
  heartbeats: () => number
  abort: () => void
}

/** Cria um contexto de job fake. */
export function createFakeContext(overrides: Partial<CatalogJobContext> = {}): FakeContext {
  const metrics = createInMemoryMetricsSink()
  const logs: { level: string; event: string; fields?: Record<string, unknown> }[] = []
  const controller = new AbortController()
  let heartbeats = 0

  const log: StructuredLogger = {
    log(level, event, fields) {
      logs.push({ level, event, fields: fields as Record<string, unknown> | undefined })
    },
  }

  const context: CatalogJobContext = {
    jobId: 'job-1',
    requestId: 'req-1',
    attempt: 1,
    signal: controller.signal,
    async heartbeat() {
      heartbeats += 1
    },
    log,
    metrics,
    ...overrides,
  }

  return {
    context,
    metrics,
    logs,
    heartbeats: () => heartbeats,
    abort: () => controller.abort(),
  }
}

/** Registro de chamadas dos servicos fake. */
export interface FakeCalls {
  detail: DetailSyncInput[]
  credits: CreditsSyncInput[]
  externalIds: ExternalIdsSyncInput[]
  media: MediaSyncInput[]
  seasons: SeasonsSyncInput[]
  episodes: EpisodesSyncInput[]
  discover: DiscoverIdsPortInput[]
  reprocess: ReprocessRawPortInput[]
  listFetch: DiscoveryListFetchInput[]
  snapshots: DiscoverySnapshotPlan[]
  reindex: { entityType: string; entityId: string; locale: string }[]
  changesFetch: { kind: ChangesKind; page: number }[]
}

/** Handles dos fakes, para o teste ajustar comportamento por caso. */
export interface HandlerFakes {
  readonly deps: CatalogHandlerDependencies
  readonly calls: FakeCalls
  readonly store: FakeJobStore
  /** Faz o proximo `syncDetail` lancar o erro dado. */
  failDetailWith: (error: unknown) => void
  /** Define o desfecho do proximo `syncDetail`. */
  setDetailOutcome: (outcome: Partial<DetailSyncOutcome>) => void
  /** Define os ids devolvidos pela descoberta. */
  setDiscoveredIds: (ids: readonly number[]) => void
  /** Define as paginas devolvidas pela busca de lista. */
  setListPages: (pages: readonly { results: unknown[]; page: number; total_pages: number }[]) => void
  /** Define os numeros de temporada devolvidos. */
  setSeasonNumbers: (numbers: readonly number[]) => void
  /** Define o resultado do `saveSnapshot`. */
  setSnapshotResult: (result: SaveSnapshotResult) => void
  /** Define as paginas de `/changes` por kind. */
  setChangesPages: (pages: Readonly<Record<string, readonly ChangesPage[]>>) => void
}

/** Monta o conjunto completo de fakes + as dependencias do registry. */
export function createHandlerFakes(): HandlerFakes {
  const store = createFakeJobStore()
  const calls: FakeCalls = {
    detail: [],
    credits: [],
    externalIds: [],
    media: [],
    seasons: [],
    episodes: [],
    discover: [],
    reprocess: [],
    listFetch: [],
    snapshots: [],
    reindex: [],
    changesFetch: [],
  }

  let detailError: unknown = null
  let detailOutcome: DetailSyncOutcome = {
    created: true,
    updated: false,
    unchanged: false,
    entityId: 'entity-1',
    skipped: false,
    skipReason: null,
  }
  let discoveredIds: readonly number[] = [11, 22]
  let listPages: readonly { results: unknown[]; page: number; total_pages: number }[] = [
    { results: [{ id: 1, popularity: 9 }, { id: 2, popularity: 8 }], page: 1, total_pages: 1 },
  ]
  let seasonNumbers: readonly number[] = [1, 2]
  let snapshotResult: SaveSnapshotResult = { id: 'snap-1', created: true, items: 2 }
  let changesPages: Readonly<Record<string, readonly ChangesPage[]>> = {}

  const checkpointState = new Map<string, { lastPage: number; totalPages: number | null; done: boolean; cursor: string | null }>()

  const deps: CatalogHandlerDependencies = {
    store,
    detailSync: {
      async syncDetail(input) {
        calls.detail.push(input)
        if (detailError !== null) {
          const error = detailError
          detailError = null
          throw error
        }
        return { ...detailOutcome }
      },
    },
    creditsSync: {
      async syncCredits(input) {
        calls.credits.push(input)
        return { cast: 3, crew: 2, guestStars: input.kind === 'episode' ? 1 : 0, skipped: false, skipReason: null }
      },
    },
    externalIdsSync: {
      async syncExternalIds(input) {
        calls.externalIds.push(input)
        return { upserted: 2, changed: 0, skipped: false, skipReason: null }
      },
    },
    mediaSync: {
      async syncMedia(input) {
        calls.media.push(input)
        return { images: 5, videos: 2, skipped: false, skipReason: null }
      },
    },
    seasonsSync: {
      async syncSeasons(input) {
        calls.seasons.push(input)
        return {
          seasons: seasonNumbers.length,
          episodes: 0,
          seasonNumbers,
          skipped: false,
          skipReason: null,
        }
      },
    },
    episodesSync: {
      async syncEpisodes(input) {
        calls.episodes.push(input)
        return {
          episodes: 10,
          cast: 20,
          guestStars: 4,
          crew: 6,
          externalIds: 10,
          stills: 8,
          skippedNoTmdbId: 1,
          skipped: false,
          skipReason: null,
        }
      },
    },
    discovery: {
      async discover(input) {
        calls.discover.push(input)
        return {
          discovered: discoveredIds.length + 1,
          accepted: discoveredIds.length,
          rejectedAdult: 1,
          duplicate: 0,
          ids: discoveredIds,
        }
      },
    },
    reprocessRaw: {
      async reprocess(input) {
        calls.reprocess.push(input)
        return {
          scanned: 4,
          promoted: input.dryRun ? 0 : 3,
          unchanged: 1,
          skipped: 0,
          failed: 0,
          dryRun: input.dryRun,
        }
      },
    },
    listFetch: {
      async fetchPage(input) {
        calls.listFetch.push(input)
        return listPages[input.page - 1] ?? { results: [], page: input.page, total_pages: listPages.length }
      },
    },
    snapshots: createFakeSnapshotStore(calls, () => snapshotResult),
    changes: {
      async fetchChanges(kind, params) {
        calls.changesFetch.push({ kind, page: params.page })
        const pages = changesPages[kind] ?? []
        return pages[params.page - 1] ?? { results: [], page: params.page, total_pages: pages.length || 1 }
      },
      checkpoint: {
        async read(job, paramsHash) {
          return checkpointState.get(`${job}|${paramsHash}`) ?? null
        },
        async commit(input) {
          let enqueued = 0
          for (const job of input.enqueue) {
            const result = await store.enqueue(job)
            if (result.created) enqueued += 1
          }
          checkpointState.set(`${input.job}|${input.paramsHash}`, {
            lastPage: input.lastPage,
            totalPages: input.totalPages,
            done: input.done,
            cursor: input.cursor,
          })
          return { enqueued }
        },
      },
      now: () => new Date('2026-07-16T00:00:00.000Z'),
    },
    search: {
      async reindexEntity(entityType, entityId, locale) {
        calls.reindex.push({ entityType, entityId, locale })
      },
    },
    now: () => new Date('2026-07-16T12:00:00.000Z'),
  }

  return {
    deps,
    calls,
    store,
    failDetailWith: (error) => {
      detailError = error
    },
    setDetailOutcome: (outcome) => {
      detailOutcome = { ...detailOutcome, ...outcome }
    },
    setDiscoveredIds: (ids) => {
      discoveredIds = ids
    },
    setListPages: (pages) => {
      listPages = pages
    },
    setSeasonNumbers: (numbers) => {
      seasonNumbers = numbers
    },
    setSnapshotResult: (result) => {
      snapshotResult = result
    },
    setChangesPages: (pages) => {
      changesPages = pages
    },
  }
}

/** Store de snapshot fake: registra o plano recebido. */
function createFakeSnapshotStore(
  calls: FakeCalls,
  result: () => SaveSnapshotResult,
): DiscoverySnapshotStorePort {
  return {
    async saveSnapshot(plan) {
      calls.snapshots.push(plan)
      return result()
    },
    async readLatestValid() {
      return null
    },
    async ageSeconds() {
      return null
    },
  }
}
