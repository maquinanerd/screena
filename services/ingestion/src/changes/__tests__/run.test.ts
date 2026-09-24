/**
 * Testes da execucao de `/changes` (PURO: checkpoint fake, sem rede/DB).
 *
 * Cobre o exigido pelo §4: falha no meio da pagina, retry, retomada, duplicidade,
 * janela repetida e checkpoint NAO avancado em rollback.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  changesEndpoint,
  changesJobName,
  changesLogStatus,
  changesParamsHash,
  extractChangedIds,
  resolveWindow,
  runChangesSync,
  type ChangesCatalogPort,
  type ChangesCheckpointPort,
  type ChangesCheckpointState,
  type ChangesCommitInput,
  type ChangesPage,
} from '../run.js'
import { createInMemoryMetricsSink } from '../../metrics/index.js'
import type { SyncLogInput, SyncLogPort } from '../../ports.js'
import type { ChangesKind } from '../../discovery/changes-plan.js'

const NOW = new Date('2026-07-16T12:00:00.000Z')

/** Checkpoint fake que espelha a semantica atomica do adapter real. */
function createFakeCheckpoint(seed: Record<string, ChangesCheckpointState> = {}) {
  const state = new Map<string, ChangesCheckpointState>(Object.entries(seed))
  const commits: ChangesCommitInput[] = []
  const enqueuedKeys = new Set<string>()
  let failNextCommit = false
  const port: ChangesCheckpointPort = {
    async read(job, paramsHash) {
      return state.get(`${job}|${paramsHash}`) ?? null
    },
    async commit(input) {
      if (failNextCommit) {
        failNextCommit = false
        // Rollback: NADA e gravado (nem jobs, nem checkpoint).
        throw new Error('commit falhou (simulado)')
      }
      commits.push(input)
      let enqueued = 0
      for (const job of input.enqueue) {
        if (enqueuedKeys.has(job.idempotencyKey)) continue // ON CONFLICT DO NOTHING
        enqueuedKeys.add(job.idempotencyKey)
        enqueued += 1
      }
      state.set(`${input.job}|${input.paramsHash}`, {
        lastPage: input.lastPage,
        totalPages: input.totalPages,
        done: input.done,
        cursor: input.cursor,
      })
      return { enqueued }
    },
  }
  return {
    port,
    commits,
    state,
    failNext: () => {
      failNextCommit = true
    },
  }
}

/**
 * Catalogo fake. `null` = todo id perguntado existe (o comportamento que os
 * testes anteriores ao filtro pressupunham); lista = so esses ids existem.
 */
function createFakeCatalog(known: Partial<Record<ChangesKind, readonly number[]>> | null = null) {
  const asked: { kind: ChangesKind; ids: number[] }[] = []
  let failNext = false
  const port: ChangesCatalogPort = {
    async existingTmdbIds(kind, ids) {
      asked.push({ kind, ids: [...ids] })
      if (failNext) {
        failNext = false
        throw new Error('consulta ao catalogo falhou (simulado)')
      }
      if (known === null) return new Set(ids)
      const list = known[kind] ?? []
      return new Set(ids.filter((id) => list.includes(id)))
    },
  }
  return {
    port,
    asked,
    failNext: () => {
      failNext = true
    },
  }
}

/** Sync log fake: guarda as linhas que iriam para `api_sync_logs`. */
function createFakeSyncLog() {
  const rows: SyncLogInput[] = []
  const port: SyncLogPort = {
    async write(input) {
      rows.push(input)
    },
  }
  return { port, rows }
}

const page = (ids: number[], pageNo: number, totalPages: number): ChangesPage => ({
  results: ids.map((id) => ({ id })),
  page: pageNo,
  total_pages: totalPages,
})

describe('extractChangedIds', () => {
  it('extrai e deduplica ids validos', () => {
    expect(extractChangedIds({ results: [{ id: 1 }, { id: 2 }, { id: 1 }] })).toEqual([1, 2])
  })

  it('descarta id invalido', () => {
    expect(extractChangedIds({ results: [{ id: 0 }, { id: -1 }, {}, { id: 5 }] })).toEqual([5])
  })

  it('descarta conteudo adulto (fail-closed)', () => {
    expect(
      extractChangedIds({
        results: [
          { id: 1, adult: true },
          { id: 2, adult: false },
        ],
      }),
    ).toEqual([2])
  })

  it('payload vazio => []', () => {
    expect(extractChangedIds({})).toEqual([])
  })
})

describe('resolveWindow', () => {
  it('default: ultimas 24h', () => {
    const { from, to } = resolveWindow({}, NOW)
    expect(to).toEqual(NOW)
    expect(NOW.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('trunca janela maior que o maximo de 14 dias do TMDB', () => {
    const from = new Date('2026-01-01T00:00:00.000Z')
    const resolved = resolveWindow({ from, to: NOW }, NOW)
    const days = (NOW.getTime() - resolved.from.getTime()) / (24 * 60 * 60 * 1000)
    expect(days).toBe(14)
  })
})

describe('runChangesSync', () => {
  const baseDeps = (
    fetchChanges: ChangesRunFetch,
    checkpoint: ChangesCheckpointPort,
    catalog: ChangesCatalogPort = createFakeCatalog().port,
    syncLog: SyncLogPort = createFakeSyncLog().port,
  ) => ({
    fetchChanges,
    checkpoint,
    catalog,
    syncLog,
    metrics: createInMemoryMetricsSink(),
    now: () => NOW,
  })
  type ChangesRunFetch = (
    kind: 'movie' | 'tv' | 'person',
    params: { start_date: string; end_date: string; page: number },
  ) => Promise<ChangesPage>

  it('pagina e enfileira os ids alterados, commitando por pagina', async () => {
    const cp = createFakeCheckpoint()
    const fetch: ChangesRunFetch = async (_k, p) =>
      p.page === 1 ? page([10, 11], 1, 2) : page([12], 2, 2)
    const report = await runChangesSync(baseDeps(fetch, cp.port), { kinds: ['movie'] })
    expect(report.kinds[0]?.pages).toBe(2)
    expect(report.kinds[0]?.changedIds).toBe(3)
    expect(report.kinds[0]?.enqueued).toBe(3)
    expect(report.kinds[0]?.done).toBe(true)
    expect(cp.commits).toHaveLength(2)
    // O checkpoint so marca done na ULTIMA pagina.
    expect(cp.commits[0]?.done).toBe(false)
    expect(cp.commits[1]?.done).toBe(true)
  })

  it('CHECKPOINT NAO AVANCA quando o commit do lote falha (rollback)', async () => {
    const cp = createFakeCheckpoint()
    const fetch: ChangesRunFetch = async () => page([10], 1, 3)
    cp.failNext()
    await expect(runChangesSync(baseDeps(fetch, cp.port), { kinds: ['movie'] })).rejects.toThrow(
      /commit falhou/,
    )
    // Nenhum checkpoint gravado: a retomada reprocessa a pagina 1.
    const job = changesJobName('movie')
    const hash = changesParamsHash('2026-07-15', '2026-07-16')
    expect(await cp.port.read(job, hash)).toBeNull()
    expect(cp.commits).toHaveLength(0)
  })

  it('retoma da pagina seguinte ao checkpoint (resume)', async () => {
    const job = changesJobName('movie')
    const hash = changesParamsHash('2026-07-15', '2026-07-16')
    const cp = createFakeCheckpoint({
      [`${job}|${hash}`]: { lastPage: 2, totalPages: 3, done: false, cursor: hash },
    })
    const seen: number[] = []
    const fetch: ChangesRunFetch = async (_k, p) => {
      seen.push(p.page)
      return page([99], p.page, 3)
    }
    const report = await runChangesSync(baseDeps(fetch, cp.port), { kinds: ['movie'] })
    expect(seen).toEqual([3]) // pulou 1 e 2
    expect(report.kinds[0]?.done).toBe(true)
  })

  it('janela ja concluida e noop (idempotencia de janela)', async () => {
    const job = changesJobName('person')
    const hash = changesParamsHash('2026-07-15', '2026-07-16')
    const cp = createFakeCheckpoint({
      [`${job}|${hash}`]: { lastPage: 3, totalPages: 3, done: true, cursor: hash },
    })
    const fetch = vi.fn(async () => page([1], 1, 1))
    const report = await runChangesSync(baseDeps(fetch as never, cp.port), { kinds: ['person'] })
    expect(fetch).not.toHaveBeenCalled()
    expect(report.kinds[0]?.skipped).toBe(true)
    expect(report.totalEnqueued).toBe(0)
  })

  it('reexecutar a MESMA janela nao duplica jobs (enqueue idempotente)', async () => {
    const cp = createFakeCheckpoint()
    const fetch: ChangesRunFetch = async () => page([10, 11], 1, 1)
    const first = await runChangesSync(baseDeps(fetch, cp.port), { kinds: ['movie'] })
    expect(first.totalEnqueued).toBe(2)
    // resume=false forca reprocessar a mesma janela: os jobs ja existem => 0 novos.
    const second = await runChangesSync(baseDeps(fetch, cp.port), {
      kinds: ['movie'],
      resume: false,
    })
    expect(second.totalEnqueued).toBe(0)
  })

  it('respeita o teto de paginas (maxPages)', async () => {
    const cp = createFakeCheckpoint()
    const fetch: ChangesRunFetch = async (_k, p) => page([p.page], p.page, 10)
    const report = await runChangesSync(baseDeps(fetch, cp.port), {
      kinds: ['movie'],
      maxPages: 2,
    })
    expect(report.kinds[0]?.pages).toBe(2)
    expect(report.kinds[0]?.done).toBe(false)
  })

  it('cobre os 3 kinds por padrao', async () => {
    const cp = createFakeCheckpoint()
    const fetch: ChangesRunFetch = async () => page([1], 1, 1)
    const report = await runChangesSync(baseDeps(fetch, cp.port), {})
    expect(report.kinds.map((k) => k.kind)).toEqual(['movie', 'tv', 'person'])
  })
})

/**
 * A PORTA DO CATALOGO (2026-09-24): `/changes` so re-sincroniza o que ja existe.
 * Medido em producao: ~2.090 titulos novos por dia entravam por aqui, porque
 * todo id alterado no TMDB virava `sync_details`, e o `sync_details` de um id
 * desconhecido CRIAVA o titulo.
 */
describe('runChangesSync — so re-sincroniza o que ja esta no catalogo', () => {
  type Fetch = (
    kind: ChangesKind,
    params: { start_date: string; end_date: string; page: number },
  ) => Promise<ChangesPage>
  const deps = (
    fetchChanges: Fetch,
    checkpoint: ChangesCheckpointPort,
    catalog: ChangesCatalogPort,
    syncLog: SyncLogPort,
  ) => ({
    fetchChanges,
    checkpoint,
    catalog,
    syncLog,
    metrics: createInMemoryMetricsSink(),
    now: () => NOW,
  })

  const enqueuedIds = (cp: ReturnType<typeof createFakeCheckpoint>) =>
    cp.commits.flatMap((c) => c.enqueue.map((j) => j.externalId))

  it('id FORA do catalogo nao vira job (e e contado como descartado)', async () => {
    const cp = createFakeCheckpoint()
    const catalog = createFakeCatalog({ movie: [] })
    const log = createFakeSyncLog()
    const report = await runChangesSync(
      deps(async () => page([501, 502], 1, 1), cp.port, catalog.port, log.port),
      { kinds: ['movie'] },
    )
    expect(enqueuedIds(cp)).toEqual([])
    expect(report.totalEnqueued).toBe(0)
    expect(report.kinds[0]).toMatchObject({
      changedIds: 2,
      inCatalog: 0,
      discardedNotInCatalog: 2,
      enqueued: 0,
      done: true,
    })
    expect(report.totalDiscardedNotInCatalog).toBe(2)
    // O checkpoint avanca mesmo sem job: a pagina foi processada (e descartada).
    expect(cp.commits).toHaveLength(1)
    expect(cp.commits[0]?.done).toBe(true)
  })

  it('id NO catalogo vira `sync_details` com reason changes', async () => {
    const cp = createFakeCheckpoint()
    const catalog = createFakeCatalog({ tv: [700] })
    const report = await runChangesSync(
      deps(async () => page([700], 1, 1), cp.port, catalog.port, createFakeSyncLog().port),
      { kinds: ['tv'] },
    )
    expect(report.totalEnqueued).toBe(1)
    const job = cp.commits[0]?.enqueue[0]
    expect(job?.jobType).toBe('sync_details')
    expect(job?.externalId).toBe('700')
    expect(job?.payload).toMatchObject({ entityType: 'tv', tmdbId: 700, reason: 'changes' })
  })

  it('pagina MISTA: enfileira so os do catalogo, UMA consulta em lote por pagina', async () => {
    const cp = createFakeCheckpoint()
    const catalog = createFakeCatalog({ movie: [10, 12, 30] })
    const log = createFakeSyncLog()
    const fetch: Fetch = async (_k, p) =>
      p.page === 1 ? page([10, 11, 12], 1, 2) : page([30, 31], 2, 2)
    const report = await runChangesSync(deps(fetch, cp.port, catalog.port, log.port), {
      kinds: ['movie'],
    })
    expect(enqueuedIds(cp)).toEqual(['10', '12', '30'])
    expect(catalog.asked).toEqual([
      { kind: 'movie', ids: [10, 11, 12] },
      { kind: 'movie', ids: [30, 31] },
    ])
    expect(report.kinds[0]).toMatchObject({
      changedIds: 5,
      inCatalog: 3,
      discardedNotInCatalog: 2,
      enqueued: 3,
    })
  })

  it('PESSOA segue a mesma regra (o upsert de pessoa nao tem porta e criaria a linha)', async () => {
    const cp = createFakeCheckpoint()
    const catalog = createFakeCatalog({ person: [9001] })
    const report = await runChangesSync(
      deps(async () => page([9001, 9002], 1, 1), cp.port, catalog.port, createFakeSyncLog().port),
      { kinds: ['person'] },
    )
    expect(enqueuedIds(cp)).toEqual(['9001'])
    expect(report.kinds[0]?.discardedNotInCatalog).toBe(1)
  })

  it('porta de catalogo que FALHA nao avanca o checkpoint (nem enfileira nada)', async () => {
    const cp = createFakeCheckpoint()
    const catalog = createFakeCatalog({ movie: [10] })
    const log = createFakeSyncLog()
    catalog.failNext()
    await expect(
      runChangesSync(
        deps(async () => page([10], 1, 3), cp.port, catalog.port, log.port),
        {
          kinds: ['movie'],
        },
      ),
    ).rejects.toThrow(/consulta ao catalogo falhou/)
    expect(cp.commits).toHaveLength(0)
    const hash = changesParamsHash('2026-07-15', '2026-07-16')
    expect(await cp.port.read(changesJobName('movie'), hash)).toBeNull()
    // A falha tambem gera log — sem esconder que o TMDB foi chamado.
    expect(log.rows).toEqual([
      expect.objectContaining({
        endpoint: '/movie/changes',
        status: 'failed',
        itemsProcessed: 1,
        itemsUpdated: 0,
        itemsCreated: 0,
        quotaCost: 1,
      }),
    ])
  })

  it('retomada depois da falha da porta reprocessa a MESMA pagina e enfileira', async () => {
    const cp = createFakeCheckpoint()
    const catalog = createFakeCatalog({ movie: [10] })
    catalog.failNext()
    const fetch: Fetch = async () => page([10], 1, 1)
    await expect(
      runChangesSync(deps(fetch, cp.port, catalog.port, createFakeSyncLog().port), {
        kinds: ['movie'],
      }),
    ).rejects.toThrow()
    const report = await runChangesSync(
      deps(fetch, cp.port, catalog.port, createFakeSyncLog().port),
      { kinds: ['movie'] },
    )
    expect(report.totalEnqueued).toBe(1)
    expect(report.kinds[0]?.done).toBe(true)
  })

  it('grava UMA linha por kind em api_sync_logs: vieram / no catalogo / enfileirados', async () => {
    const cp = createFakeCheckpoint()
    const catalog = createFakeCatalog({ movie: [1, 2], tv: [] })
    const log = createFakeSyncLog()
    const fetch: Fetch = async (kind) =>
      kind === 'movie' ? page([1, 2, 3, 4], 1, 1) : kind === 'tv' ? page([5], 1, 1) : page([], 1, 1)
    await runChangesSync(deps(fetch, cp.port, catalog.port, log.port), {})
    expect(log.rows.map((r) => [r.endpoint, r.status])).toEqual([
      ['/movie/changes', 'success'],
      ['/tv/changes', 'success'],
      ['/person/changes', 'empty'],
    ])
    const movie = log.rows[0]!
    expect(movie.itemsProcessed).toBe(4) // vieram
    expect(movie.itemsUpdated).toBe(2) // no catalogo
    expect(movie.itemsCreated).toBe(2) // enfileirados
    // descartados = items_processed - items_updated
    expect(movie.itemsProcessed! - movie.itemsUpdated!).toBe(2)
    expect(movie.quotaCost).toBe(1)
    expect(log.rows[1]).toMatchObject({ itemsProcessed: 1, itemsUpdated: 0, itemsCreated: 0 })
  })

  it('janela ja concluida nao chama o TMDB nem grava log', async () => {
    const job = changesJobName('movie')
    const hash = changesParamsHash('2026-07-15', '2026-07-16')
    const cp = createFakeCheckpoint({
      [`${job}|${hash}`]: { lastPage: 1, totalPages: 1, done: true, cursor: hash },
    })
    const log = createFakeSyncLog()
    const catalog = createFakeCatalog()
    await runChangesSync(
      deps(async () => page([1], 1, 1), cp.port, catalog.port, log.port),
      {
        kinds: ['movie'],
      },
    )
    expect(log.rows).toEqual([])
    expect(catalog.asked).toEqual([])
  })
})

describe('changesLogStatus / changesEndpoint', () => {
  it('status do ciclo', () => {
    expect(changesLogStatus(0, true)).toBe('empty')
    expect(changesLogStatus(3, true)).toBe('success')
    expect(changesLogStatus(3, false)).toBe('partial')
  })

  it('endpoint por kind', () => {
    expect(changesEndpoint('movie')).toBe('/movie/changes')
    expect(changesEndpoint('tv')).toBe('/tv/changes')
    expect(changesEndpoint('person')).toBe('/person/changes')
  })
})
