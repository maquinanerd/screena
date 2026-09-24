/**
 * Testes do worker da fila de catalogo (PURO: store fake em memoria, sem DB).
 * Cobre: sucesso, retry transitorio, dead-letter permanente, sem-handler,
 * timeout, shutdown gracioso, teto de jobs, heartbeat e erro do store (o banco
 * da propria fila) nos modos servico e drain.
 */

import { describe, expect, it, vi } from 'vitest'
import { createCatalogJobRegistry, CatalogJobInputError, PermanentJobError } from '../handler.js'
import { runCatalogWorker, storeErrorBackoffMs } from '../worker.js'
import { createInMemoryMetricsSink, CATALOG_METRIC_NAMES } from '../../metrics/index.js'
import type { CatalogJobStorePort, ResolvedFailure } from '../store-port.js'
import type { CatalogJobHandler } from '../handler.js'
import type { CatalogEntityKind, CatalogJobType } from '../types.js'

/** Linha MUTAVEL do store fake (ClaimedCatalogJob e readonly por contrato). */
interface FakeJob {
  id: string
  jobType: CatalogJobType
  entityType: CatalogEntityKind | null
  externalId: string | null
  payload: Record<string, unknown>
  attempts: number
  maxAttempts: number
  runId: string | null
  status: string
  failure?: ResolvedFailure
  heartbeats: number
}

/** Store fake: fila em memoria que espelha a semantica do adapter real. */
function createFakeStore(jobs: Partial<FakeJob>[]): CatalogJobStorePort & { rows: FakeJob[] } {
  const rows: FakeJob[] = jobs.map((j, i) => ({
    id: String(i + 1),
    jobType: 'sync_details' as CatalogJobType,
    entityType: 'movie' as CatalogEntityKind,
    externalId: String(600 + i),
    payload: {},
    attempts: 0,
    maxAttempts: 5,
    runId: null,
    status: 'pending',
    heartbeats: 0,
    ...j,
  }))
  const find = (id: string) => rows.find((r) => r.id === id)
  return {
    rows,
    async enqueue() {
      return { id: '0', created: false }
    },
    async claimNext() {
      const next = rows.find((r) => r.status === 'pending')
      if (next === undefined) return null
      next.status = 'running'
      next.attempts += 1
      return {
        id: next.id,
        jobType: next.jobType,
        entityType: next.entityType,
        externalId: next.externalId,
        payload: next.payload,
        attempts: next.attempts,
        maxAttempts: next.maxAttempts,
        runId: next.runId,
      }
    },
    async heartbeat(id) {
      const row = find(id)
      if (row) row.heartbeats += 1
    },
    async complete(id) {
      const row = find(id)
      if (row) row.status = 'succeeded'
    },
    async applyFailure(id, failure) {
      const row = find(id)
      if (row) {
        row.status = failure.status
        row.failure = failure
      }
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

/** Le uma linha do store fake, falhando alto se o indice nao existir. */
function row(store: { rows: FakeJob[] }, index: number): FakeJob {
  const found = store.rows[index]
  if (found === undefined) throw new Error(`linha ${index} inexistente no store fake`)
  return found
}

const okHandler = (spy?: () => void): CatalogJobHandler<Record<string, unknown>, void> => ({
  type: 'sync_details',
  validateInput: (input) => input as Record<string, unknown>,
  execute: async () => {
    spy?.()
  },
})

const asHandler = (h: CatalogJobHandler<never, unknown> | unknown) =>
  h as CatalogJobHandler<never, unknown>

const deps = (store: CatalogJobStorePort, handlers: unknown[]) => ({
  store,
  registry: createCatalogJobRegistry(handlers.map(asHandler)),
  metrics: createInMemoryMetricsSink(),
  now: () => new Date('2026-07-16T12:00:00.000Z'),
  random: () => 0,
  sleep: async () => {},
})

describe('createCatalogJobRegistry', () => {
  it('resolve handler por tipo', () => {
    const r = createCatalogJobRegistry([asHandler(okHandler())])
    expect(r.has('sync_details')).toBe(true)
    expect(r.get('sync_details')?.type).toBe('sync_details')
    expect(r.has('sync_media')).toBe(false)
  })

  it('rejeita handler duplicado para o mesmo tipo', () => {
    const r = createCatalogJobRegistry([asHandler(okHandler())])
    expect(() => r.register(asHandler(okHandler()))).toThrow(/duplicado/)
  })
})

describe('runCatalogWorker', () => {
  it('executa o handler e marca succeeded', async () => {
    const store = createFakeStore([{}])
    const spy = vi.fn()
    const report = await runCatalogWorker(deps(store, [okHandler(spy)]), { concurrency: 1 })
    expect(spy).toHaveBeenCalledOnce()
    expect(report.succeeded).toBe(1)
    expect(row(store, 0).status).toBe('succeeded')
  })

  it('drena a fila e sai quando vazia', async () => {
    const store = createFakeStore([{}, {}, {}])
    const report = await runCatalogWorker(deps(store, [okHandler()]), { concurrency: 1 })
    expect(report.claimed).toBe(3)
    expect(report.succeeded).toBe(3)
  })

  it('erro transitorio agenda retry_wait (nao dead-letter enquanto ha tentativa)', async () => {
    const store = createFakeStore([{}])
    const failing: CatalogJobHandler<unknown, void> = {
      type: 'sync_details',
      validateInput: (i) => i,
      execute: async () => {
        throw new Error('upstream 503')
      },
    }
    const report = await runCatalogWorker(deps(store, [failing]), { concurrency: 1 })
    expect(report.retried).toBe(1)
    expect(report.deadLettered).toBe(0)
    expect(row(store, 0).status).toBe('retry_wait')
    expect(row(store, 0).failure?.availableAt).not.toBeNull()
  })

  it('erro PERMANENTE vai direto para dead-letter sem gastar tentativas', async () => {
    const store = createFakeStore([{ attempts: 0, maxAttempts: 5 }])
    const permanent: CatalogJobHandler<unknown, void> = {
      type: 'sync_details',
      validateInput: (i) => i,
      execute: async () => {
        throw new PermanentJobError('tmdb_404', 'entidade nao existe upstream')
      },
    }
    const report = await runCatalogWorker(deps(store, [permanent]), { concurrency: 1 })
    expect(report.failedPermanently).toBe(1)
    expect(row(store, 0).status).toBe('dead_letter')
    expect(row(store, 0).failure?.lastErrorCode).toBe('tmdb_404')
  })

  it('input invalido e falha permanente (dead-letter, sem IO)', async () => {
    const store = createFakeStore([{}])
    const strict: CatalogJobHandler<unknown, void> = {
      type: 'sync_details',
      validateInput: () => {
        throw new CatalogJobInputError('payload sem tmdbId')
      },
      execute: async () => {
        throw new Error('nunca deve executar')
      },
    }
    const report = await runCatalogWorker(deps(store, [strict]), { concurrency: 1 })
    expect(report.failedPermanently).toBe(1)
    expect(row(store, 0).status).toBe('dead_letter')
    expect(row(store, 0).failure?.lastErrorCode).toBe('invalid_job_input')
  })

  it('job sem handler registrado vai para dead-letter (nao trava a fila)', async () => {
    const store = createFakeStore([{ jobType: 'sync_media' }])
    const report = await runCatalogWorker(deps(store, [okHandler()]), { concurrency: 1 })
    expect(report.failedPermanently).toBe(1)
    expect(row(store, 0).status).toBe('dead_letter')
    expect(row(store, 0).failure?.lastErrorCode).toBe('no_handler')
  })

  it('respeita o teto maxJobs', async () => {
    const store = createFakeStore([{}, {}, {}, {}])
    const report = await runCatalogWorker(deps(store, [okHandler()]), {
      concurrency: 1,
      maxJobs: 2,
    })
    expect(report.claimed).toBe(2)
    expect(row(store, 2).status).toBe('pending')
  })

  it('shutdown gracioso para de reivindicar novos jobs', async () => {
    const store = createFakeStore([{}, {}, {}])
    const controller = new AbortController()
    const handler: CatalogJobHandler<unknown, void> = {
      type: 'sync_details',
      validateInput: (i) => i,
      execute: async () => {
        controller.abort() // shutdown durante o 1o job
      },
    }
    const report = await runCatalogWorker(
      { ...deps(store, [handler]), shutdownSignal: controller.signal },
      { concurrency: 1 },
    )
    // O job em voo termina; nenhum novo e reivindicado.
    expect(report.claimed).toBe(1)
    expect(report.succeeded).toBe(1)
    expect(row(store, 1).status).toBe('pending')
  })

  it('timeout de job vira falha transitoria (handler que ignora o signal nao trava)', async () => {
    const store = createFakeStore([{}])
    const hanging: CatalogJobHandler<unknown, void> = {
      type: 'sync_details',
      validateInput: (i) => i,
      execute: () => new Promise<void>(() => {}), // nunca resolve, ignora o signal
    }
    const report = await runCatalogWorker(deps(store, [hanging]), {
      concurrency: 1,
      jobTimeoutMs: 20,
    })
    expect(report.retried).toBe(1)
    expect(row(store, 0).status).toBe('retry_wait')
    expect(row(store, 0).failure?.lastErrorCode).toBe('JobTimeoutError')
  })

  it('handler pode bater heartbeat pelo contexto', async () => {
    const store = createFakeStore([{}])
    const beating: CatalogJobHandler<unknown, void> = {
      type: 'sync_details',
      validateInput: (i) => i,
      execute: async (ctx) => {
        await ctx.heartbeat()
        await ctx.heartbeat()
      },
    }
    await runCatalogWorker(deps(store, [beating]), { concurrency: 1 })
    expect(row(store, 0).heartbeats).toBeGreaterThanOrEqual(2)
  })

  describe('erro do STORE (o banco da propria fila)', () => {
    /** Erro no formato do Prisma: `code` e o que `toSafeError` grava. */
    const prismaTimeout = () =>
      Object.assign(new Error('Transaction already closed: timeout 5000ms'), { code: 'P2028' })

    function captureLog() {
      const events: { level: string; event: string; fields: Record<string, unknown> }[] = []
      return {
        events,
        log: {
          log(level: string, event: string, fields?: Readonly<Record<string, unknown>>) {
            events.push({ level, event, fields: { ...fields } })
          },
        },
      }
    }

    it('modo servico: claim que falha NAO derruba o worker — loga, espera e segue', async () => {
      // Producao, 24/09/2026: o P2028 do claim escapava do loop e o servico saia
      // com exit(1). Aqui a falha acontece duas vezes e o job seguinte e processado.
      const store = createFakeStore([{}])
      const realClaim = store.claimNext.bind(store)
      let failuresLeft = 2
      store.claimNext = async (options) => {
        if (failuresLeft > 0) {
          failuresLeft -= 1
          throw prismaTimeout()
        }
        return realClaim(options)
      }
      const sleeps: number[] = []
      const { events, log } = captureLog()
      const report = await runCatalogWorker(
        { ...deps(store, [okHandler()]), log, sleep: async (ms) => void sleeps.push(ms) },
        { concurrency: 1, drain: false, maxJobs: 1, idleSleepMs: 1_000 },
      )
      expect(report.succeeded).toBe(1)
      expect(row(store, 0).status).toBe('succeeded')
      const warnings = events.filter((e) => e.event === 'catalog_worker_store_error')
      expect(warnings).toHaveLength(2)
      expect(warnings[0]?.level).toBe('warn')
      expect(warnings[0]?.fields.stage).toBe('claim')
      expect(warnings[0]?.fields.code).toBe('P2028')
      // A espera dobra a cada falha SEGUIDA.
      expect(sleeps).toEqual([1_000, 2_000])
    })

    it('modo servico: escrita do destino que falha NAO derruba o worker — o proximo job roda', async () => {
      const store = createFakeStore([{}, {}])
      let completeFailuresLeft = 1
      const realComplete = store.complete.bind(store)
      const realApplyFailure = store.applyFailure.bind(store)
      store.complete = async (id) => {
        if (completeFailuresLeft > 0) {
          completeFailuresLeft -= 1
          throw prismaTimeout()
        }
        return realComplete(id)
      }
      // O banco continua fora no mesmo instante: registrar a falha tambem falha.
      let applyFailuresLeft = 1
      store.applyFailure = async (id, failure) => {
        if (applyFailuresLeft > 0) {
          applyFailuresLeft -= 1
          throw prismaTimeout()
        }
        return realApplyFailure(id, failure)
      }
      const { events, log } = captureLog()
      const report = await runCatalogWorker(
        { ...deps(store, [okHandler()]), log },
        { concurrency: 1, drain: false, maxJobs: 2 },
      )
      // O 1o job fica em `running` (o reclaim de orfaos o devolve a fila); o 2o
      // e processado normalmente.
      expect(row(store, 0).status).toBe('running')
      expect(row(store, 1).status).toBe('succeeded')
      expect(report.claimed).toBe(2)
      const warning = events.find((e) => e.event === 'catalog_worker_store_error')
      expect(warning?.fields.stage).toBe('record')
      expect(warning?.fields.jobId).toBe('1')
    })

    it('modo drain (CLI/CI): o erro do claim continua subindo', async () => {
      const store = createFakeStore([{}])
      store.claimNext = async () => {
        throw prismaTimeout()
      }
      await expect(
        runCatalogWorker(deps(store, [okHandler()]), { concurrency: 1 }),
      ).rejects.toThrow(/Transaction already closed/)
    })

    it('a espera tem teto: falhas seguidas nunca passam de 5 s (abaixo do grace period do Docker)', () => {
      expect(storeErrorBackoffMs(1, 1_000)).toBe(1_000)
      expect(storeErrorBackoffMs(2, 1_000)).toBe(2_000)
      expect(storeErrorBackoffMs(3, 1_000)).toBe(4_000)
      expect(storeErrorBackoffMs(4, 1_000)).toBe(5_000)
      expect(storeErrorBackoffMs(500, 1_000)).toBe(5_000)
      // Intervalo de ociosidade zerado nao vira laco quente.
      expect(storeErrorBackoffMs(1, 0)).toBe(1)
    })
  })

  it('emite metricas por ciclo (total + duracao)', async () => {
    const store = createFakeStore([{}])
    const metrics = createInMemoryMetricsSink()
    await runCatalogWorker({ ...deps(store, [okHandler()]), metrics }, { concurrency: 1 })
    expect(metrics.read(CATALOG_METRIC_NAMES.jobsTotal, { job_type: 'sync_details' })).toBe(1)
    expect(metrics.samples().some((s) => s.name === CATALOG_METRIC_NAMES.syncDurationSeconds)).toBe(
      true,
    )
  })
})
