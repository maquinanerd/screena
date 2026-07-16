/**
 * Testes da execucao de `/changes` (PURO: checkpoint fake, sem rede/DB).
 *
 * Cobre o exigido pelo §4: falha no meio da pagina, retry, retomada, duplicidade,
 * janela repetida e checkpoint NAO avancado em rollback.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  changesJobName,
  changesParamsHash,
  extractChangedIds,
  resolveWindow,
  runChangesSync,
  type ChangesCheckpointPort,
  type ChangesCheckpointState,
  type ChangesCommitInput,
  type ChangesPage,
} from '../run.js'
import { createInMemoryMetricsSink } from '../../metrics/index.js'

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
  const baseDeps = (fetchChanges: ChangesRunFetch, checkpoint: ChangesCheckpointPort) => ({
    fetchChanges,
    checkpoint,
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
