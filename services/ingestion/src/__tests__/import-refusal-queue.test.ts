/**
 * Recusa de idioma NA FILA: conclui o job na primeira tentativa (PURO: fila,
 * cache, store e sync log em memoria; sem rede, sem banco).
 *
 * Medido em producao em 24/09/2026: 12.993 `sync_details` em dead_letter com
 * `last_error_code: 'empty'` em 7 dias. A recusa do recorte de idioma voltava
 * como `status: 'empty'` + `refused`, `assertImportOk` a transformava em
 * excecao transitoria, o worker tentava 5 vezes e o job morria. Cada tentativa
 * gravava mais uma linha `empty` em `api_sync_logs`.
 *
 * O teste roda o caminho de verdade: worker -> `SyncDetailsHandler` ->
 * `importMovie` (real) -> `refusedDetailOutcome`/`assertImportOk` (reais), do
 * mesmo jeito que `persistence/catalog-services.ts` os encadeia.
 */

import { describe, expect, it } from 'vitest'
import { runCatalogWorker } from '../catalog-jobs/worker.js'
import { createCatalogJobRegistry, type CatalogJobHandler } from '../catalog-jobs/handler.js'
import { SyncDetailsHandler } from '../catalog-jobs/handlers/sync-details-handler.js'
import type { CatalogDetailSyncPort } from '../catalog-jobs/handlers/ports.js'
import type {
  CatalogJobStorePort,
  ClaimedCatalogJob,
  EnqueueCatalogJobInput,
  ResolvedFailure,
} from '../catalog-jobs/store-port.js'
import { buildCoverageJob } from '../entity-coverage/entry.js'
import { assertImportOk, refusedDetailOutcome } from '../import/assert-ok.js'
import { importMovie } from '../import/index.js'
import type { ImportContext, ImportResult } from '../import/types.js'
import { createInMemoryMetricsSink } from '../metrics/index.js'
import { createCatalogAdmissionPolicy } from '../persistence/admission.js'
import type {
  CacheFetchInput,
  CachePort,
  CacheResult,
  EntityStorePort,
  EntityUpsertResult,
  StoreMovieInput,
  SyncLogInput,
  TmdbReadPort,
} from '../ports.js'
import { emptyDetailWatchReport } from '../watch-providers/from-detail.js'
import { hashPayload } from '../utils/hash.js'

/** Linha mutavel da fila fake. */
interface Row {
  readonly job: EnqueueCatalogJobInput
  status: 'pending' | 'running' | 'retry_wait' | 'succeeded' | 'dead_letter'
  attempts: number
  failure?: ResolvedFailure
}

/**
 * Fila fake que REIVINDICA DE NOVO o que esta em `retry_wait` (ignorando o
 * `available_at`): e exatamente o que faria a fila real depois do backoff, e e o
 * que torna visivel o "tentou 5 vezes" que o defeito produzia.
 */
function createRetryingStore(job: EnqueueCatalogJobInput): CatalogJobStorePort & { row: Row } {
  const row: Row = { job, status: 'pending', attempts: 0 }
  return {
    row,
    async enqueue() {
      return { id: '0', created: false }
    },
    async claimNext(): Promise<ClaimedCatalogJob | null> {
      if (row.status !== 'pending' && row.status !== 'retry_wait') return null
      row.status = 'running'
      row.attempts += 1
      return {
        id: '1',
        jobType: job.jobType,
        entityType: job.entityType ?? null,
        externalId: job.externalId ?? null,
        payload: (job.payload ?? {}) as Record<string, unknown>,
        attempts: row.attempts,
        maxAttempts: job.maxAttempts ?? 5,
        runId: job.runId ?? null,
      }
    },
    async heartbeat() {},
    async complete() {
      row.status = 'succeeded'
    },
    async applyFailure(_id, failure) {
      row.status = failure.status
      row.failure = failure
    },
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

/** Cache fake com semantica de hash: a 2a leitura do mesmo payload e `changed: false`. */
class FakeCache implements CachePort {
  private readonly hashes = new Map<string, string>()
  async getOrFetch<T>(input: CacheFetchInput<T>): Promise<CacheResult<T>> {
    const data = await input.fetcher()
    const payloadHash = hashPayload(data)
    const changed = this.hashes.get(input.endpoint) !== payloadHash
    this.hashes.set(input.endpoint, payloadHash)
    return { data, fromCache: !changed, payloadHash, changed }
  }
}

/** Store fake com a MESMA porta de admissao do adapter real (gate de criacao). */
function createAdmittingStore(): EntityStorePort {
  const admission = createCatalogAdmissionPolicy(['pt', 'en', 'es', 'ja', 'ko'])
  const movies = new Set<number>()
  const notUsed = async (): Promise<never> => {
    throw new Error('nao usado neste teste')
  }
  return {
    async upsertMovie(input: StoreMovieInput): Promise<EntityUpsertResult> {
      if (!movies.has(input.movie.tmdbId)) {
        const refusal = admission.admit(input.movie.originalLanguage)
        if (refusal !== null) return { refused: refusal }
      }
      const created = !movies.has(input.movie.tmdbId)
      movies.add(input.movie.tmdbId)
      return {
        id: String(input.movie.tmdbId),
        created,
        credits: {
          castReplaced: false,
          crewReplaced: false,
          castLinked: 0,
          crewLinked: 0,
          castDropped: 0,
          crewDropped: 0,
        },
      }
    },
    async touchMovie(tmdbId) {
      return movies.has(tmdbId)
    },
    upsertTvShow: notUsed,
    touchTvShow: notUsed,
    upsertSeasonWithEpisodes: notUsed,
    touchSeason: notUsed,
    upsertPerson: notUsed,
    touchPerson: notUsed,
    async fillMissingTitleCountries() {
      return 0
    },
  }
}

function tmdbWithLanguage(language: string): TmdbReadPort {
  const notUsed = async (): Promise<never> => {
    throw new Error('nao usado neste teste')
  }
  return {
    getMovie: async (id) => ({ id, original_title: 'Filme', original_language: language }),
    getTvShow: notUsed,
    getTvSeason: notUsed,
    getTvEpisode: notUsed,
    getPerson: notUsed,
    getUpcomingMovies: notUsed,
  }
}

/** O `syncDetail` de filme exatamente como `catalog-services.ts` o encadeia. */
function detailSyncFor(runImport: (tmdbId: number) => Promise<ImportResult>): CatalogDetailSyncPort {
  return {
    async syncDetail({ tmdbId }) {
      const imported = await runImport(tmdbId)
      const refused = refusedDetailOutcome(imported)
      if (refused !== null) return refused
      const result = assertImportOk(imported, `importMovie(${tmdbId})`)
      return {
        created: result.created,
        updated: result.changed && !result.created,
        unchanged: !result.changed,
        entityId: result.id,
        skipped: false,
        skipReason: null,
        watchOutcome: result.watch.outcome,
        watchOffers: result.watch.offersUpserted,
      }
    },
  }
}

function runWorker(store: CatalogJobStorePort, detailSync: CatalogDetailSyncPort) {
  const handler = new SyncDetailsHandler({
    detailSync,
    store: {
      ...store,
      async enqueue() {
        return { id: '0', created: true }
      },
    },
    search: { async reindexEntity() {} },
  })
  return runCatalogWorker(
    {
      store,
      registry: createCatalogJobRegistry([handler as unknown as CatalogJobHandler<never, unknown>]),
      metrics: createInMemoryMetricsSink(),
      now: () => new Date('2026-09-24T12:00:00.000Z'),
      random: () => 0,
      sleep: async () => {},
    },
    { concurrency: 1, drain: true },
  )
}

const coverageJob = (tmdbId: number) =>
  buildCoverageJob({
    kind: 'movie',
    tmdbId,
    locale: 'pt-BR',
    reason: 'discovery',
    scope: '2026-09-24',
    runId: 'teste',
  })

describe('recusa de idioma na fila', () => {
  it('import RECUSADO = 1 tentativa, job concluido (fora do dead_letter), 1 linha de log', async () => {
    const logs: SyncLogInput[] = []
    const ctx: ImportContext = {
      tmdb: tmdbWithLanguage('th'),
      cache: new FakeCache(),
      store: createAdmittingStore(),
      syncLog: {
        async write(input) {
          logs.push(input)
        },
      },
      now: () => new Date('2026-09-24T12:00:00.000Z'),
      staleAfter: () => null,
    }
    const store = createRetryingStore(coverageJob(424242))

    const report = await runWorker(
      store,
      detailSyncFor((id) => importMovie(ctx, id)),
    )

    expect(store.row.attempts).toBe(1)
    expect(store.row.status).toBe('succeeded')
    expect(report).toMatchObject({ claimed: 1, succeeded: 1, retried: 0, deadLettered: 0 })
    // A recusa continua contavel: UMA linha `empty` com o codigo do idioma.
    expect(logs).toEqual([
      expect.objectContaining({
        endpoint: '/movie/424242',
        status: 'empty',
        errorCode: 'language_not_allowed:th',
      }),
    ])
  })

  it('idioma ADMITIDO segue sendo criado (a recusa nao engole o caminho normal)', async () => {
    const ctx: ImportContext = {
      tmdb: tmdbWithLanguage('ko'),
      cache: new FakeCache(),
      store: createAdmittingStore(),
      syncLog: { async write() {} },
      now: () => new Date('2026-09-24T12:00:00.000Z'),
      staleAfter: () => null,
    }
    const store = createRetryingStore(coverageJob(515151))
    await runWorker(
      store,
      detailSyncFor((id) => importMovie(ctx, id)),
    )
    expect(store.row).toMatchObject({ status: 'succeeded', attempts: 1 })
  })

  it("'empty' SEM `refused` mantem o comportamento de antes: excecao e retry", async () => {
    const emptyWithoutRefusal: ImportResult = {
      entityType: 'movie',
      tmdbId: 1,
      status: 'empty',
      changed: false,
      created: false,
      id: null,
      quotaCost: 0,
      watch: emptyDetailWatchReport('unrecognized'),
    }
    expect(refusedDetailOutcome(emptyWithoutRefusal)).toBeNull()
    expect(() => assertImportOk(emptyWithoutRefusal, 'importMovie(1)')).toThrow(/empty/)

    const store = createRetryingStore(coverageJob(1))
    const report = await runWorker(
      store,
      detailSyncFor(async () => emptyWithoutRefusal),
    )
    // Sem recusa, o 'empty' continua sendo erro: esgota as tentativas.
    expect(store.row.attempts).toBe(5)
    expect(store.row.status).toBe('dead_letter')
    expect(store.row.failure?.lastErrorCode).toBe('empty')
    expect(report.deadLettered).toBe(1)
  })

  it('refusedDetailOutcome: motivo legivel com o codigo da recusa', () => {
    const outcome = refusedDetailOutcome({
      entityType: 'tv',
      tmdbId: 9,
      status: 'empty',
      changed: false,
      created: false,
      id: null,
      refused: { reason: 'language_unknown', language: null },
      quotaCost: 1,
      watch: emptyDetailWatchReport('unresolved'),
    })
    expect(outcome).toEqual({
      created: false,
      updated: false,
      unchanged: false,
      entityId: null,
      skipped: true,
      skipReason: 'titulo recusado pelo recorte de idioma (language_unknown)',
      watchOutcome: 'unresolved',
      watchOffers: 0,
    })
  })
})
