/**
 * Testes da orquestracao pura de promocao movie tmdb_raw -> tabelas tipadas
 * (P0-00f.1): reuso de normalizeMovie + upsertMovie + finalize (slug/traducao),
 * idempotencia de re-run, falha por item que nao aborta o lote e dry-run que so
 * conta. Sem rede, sem DB — portas fakes em memoria.
 */

import { describe, expect, it } from 'vitest'
import type { EntityStorePort, StoreMovieInput, UpsertOutcome } from '../ports.js'
import { promoteMoviesFromRaw, readMovieDisplayFields } from '../raw-promote/run.js'
import type { CatalogFinalizePort, RawMovieRow, RawMovieSource } from '../raw-promote/types.js'

const NOW = () => new Date('2026-07-09T00:00:00.000Z')
const FETCHED = new Date('2026-07-01T00:00:00.000Z')

/** Payload de filme minimo e valido para normalizeMovie (+ campos de exibicao). */
function movieRow(id: number, payloadOverrides: Record<string, unknown> = {}): RawMovieRow {
  return {
    tmdbId: id,
    baseLanguage: 'pt-BR',
    fetchedAt: FETCHED,
    payload: {
      id,
      title: `Filme ${id}`,
      original_title: `Movie ${id}`,
      release_date: '2020-05-01',
      overview: `Sinopse ${id}`,
      ...payloadOverrides,
    },
  }
}

function makeSource(rows: readonly RawMovieRow[]): RawMovieSource & { listed: number[] } {
  const listed: number[] = []
  return {
    listed,
    countMovies: () => Promise.resolve(rows.length),
    listMoviePayloads: (limit: number) => {
      const slice = rows.slice(0, Math.max(0, limit))
      listed.push(slice.length)
      return Promise.resolve(slice)
    },
  }
}

/** Store fake: upsertMovie idempotente (created na 1a vez, updated depois). */
function makeStore(seeded: number[] = []) {
  const seen = new Set<number>(seeded)
  const calls: Array<{ tmdbId: number; created: boolean }> = []
  let idSeq = 100
  const store: EntityStorePort = {
    upsertMovie(input: StoreMovieInput): Promise<UpsertOutcome> {
      const tmdbId = input.movie.tmdbId
      const created = !seen.has(tmdbId)
      seen.add(tmdbId)
      idSeq += 1
      calls.push({ tmdbId, created })
      return Promise.resolve({ id: String(idSeq), created })
    },
    touchMovie: () => Promise.reject(new Error('n/a')),
    upsertTvShow: () => Promise.reject(new Error('n/a')),
    touchTvShow: () => Promise.reject(new Error('n/a')),
    upsertSeasonWithEpisodes: () => Promise.reject(new Error('n/a')),
    touchSeason: () => Promise.reject(new Error('n/a')),
    upsertPerson: () => Promise.reject(new Error('n/a')),
    touchPerson: () => Promise.reject(new Error('n/a')),
  }
  return { store, calls }
}

function makeFinalize() {
  const slugCalls: Array<{ entityType: string; entityId: string; desiredSlug: string; tmdbId: number }> = []
  const translationCalls: Array<{ entityType: string; entityId: string; title: string; summary: string | null }> = []
  const finalize: CatalogFinalizePort = {
    upsertCanonicalSlug(entityType, entityId, desiredSlug, tmdbId) {
      slugCalls.push({ entityType, entityId, desiredSlug, tmdbId })
      return Promise.resolve(desiredSlug)
    },
    upsertTranslation(entityType, entityId, title, summary) {
      translationCalls.push({ entityType, entityId, title, summary })
      return Promise.resolve()
    },
  }
  return { finalize, slugCalls, translationCalls }
}

type PromoteOpts = Parameters<typeof promoteMoviesFromRaw>[0]

/** Monta as opcoes completas exigindo as portas; o resto tem defaults. */
function opts(
  over: Pick<PromoteOpts, 'source' | 'store' | 'finalize'> & Partial<PromoteOpts>,
): PromoteOpts {
  return { baseLanguage: 'pt-BR', limit: 100, now: NOW, dryRun: false, ...over }
}

describe('readMovieDisplayFields', () => {
  it('le title (com fallback a original_title), overview e ano', () => {
    expect(readMovieDisplayFields({ title: 'Ola', overview: 'x', release_date: '2019-01-02' })).toEqual({
      title: 'Ola',
      overview: 'x',
      year: 2019,
    })
    expect(readMovieDisplayFields({ original_title: 'Only Original' })).toEqual({
      title: 'Only Original',
      overview: null,
      year: null,
    })
    expect(readMovieDisplayFields({ title: '   ', original_title: 'Fallback' }).title).toBe('Fallback')
    expect(readMovieDisplayFields(null)).toEqual({ title: '', overview: null, year: null })
  })
})

describe('promoteMoviesFromRaw', () => {
  it('promove: normaliza -> upsertMovie -> slug + traducao (created)', async () => {
    const source = makeSource([movieRow(1), movieRow(2)])
    const { store, calls } = makeStore()
    const { finalize, slugCalls, translationCalls } = makeFinalize()

    const report = await promoteMoviesFromRaw(opts({ source, store, finalize }))

    expect(report.counts).toEqual({ created: 2, updated: 0, failed: 0 })
    expect(report.available).toBe(2)
    expect(report.selected).toBe(2)
    expect(calls.map((c) => c.tmdbId)).toEqual([1, 2])
    // slug deterministico: slugify(title)-ano.
    expect(slugCalls.map((s) => s.desiredSlug)).toEqual(['filme-1-2020', 'filme-2-2020'])
    expect(slugCalls.every((s) => s.entityType === 'movie')).toBe(true)
    // traducao com title + summary do payload.
    expect(translationCalls[0]).toMatchObject({ entityType: 'movie', title: 'Filme 1', summary: 'Sinopse 1' })
  })

  it('idempotencia de re-run: 2a execucao vira updated (mesmo estado final)', async () => {
    const rows = [movieRow(1), movieRow(2)]
    const { store, calls } = makeStore()
    const { finalize } = makeFinalize()

    const r1 = await promoteMoviesFromRaw(opts({ source: makeSource(rows), store, finalize }))
    expect(r1.counts).toEqual({ created: 2, updated: 0, failed: 0 })

    const r2 = await promoteMoviesFromRaw(opts({ source: makeSource(rows), store, finalize }))
    expect(r2.counts).toEqual({ created: 0, updated: 2, failed: 0 })
    // upsert foi chamado nas duas execucoes (idempotente); nada aborta.
    expect(calls).toHaveLength(4)
  })

  it('falha de um item vira failed e NAO aborta o lote', async () => {
    // movie 2 tem payload sem id -> normalizeMovie lanca -> failed.
    const source = makeSource([movieRow(1), { tmdbId: 2, baseLanguage: 'pt-BR', fetchedAt: FETCHED, payload: { title: 'sem id' } }, movieRow(3)])
    const { store, calls } = makeStore()
    const { finalize } = makeFinalize()

    const report = await promoteMoviesFromRaw(opts({ source, store, finalize }))

    expect(report.counts).toEqual({ created: 2, updated: 0, failed: 1 })
    expect(report.failedIds).toEqual([2])
    // so os validos chegaram ao store.
    expect(calls.map((c) => c.tmdbId)).toEqual([1, 3])
  })

  it('respeita o limite (selected <= limit)', async () => {
    const source = makeSource([movieRow(1), movieRow(2), movieRow(3), movieRow(4), movieRow(5)])
    const { store } = makeStore()
    const { finalize } = makeFinalize()
    const report = await promoteMoviesFromRaw(opts({ source, store, finalize, limit: 2 }))
    expect(report.available).toBe(5)
    expect(report.selected).toBe(2)
    expect(report.counts.created).toBe(2)
  })

  it('dry-run: so CONTA (nao le payload, nao toca store/finalize)', async () => {
    const source = makeSource([movieRow(1), movieRow(2), movieRow(3), movieRow(4), movieRow(5)])
    const { store, calls } = makeStore()
    const { finalize, slugCalls } = makeFinalize()

    const report = await promoteMoviesFromRaw(opts({ source, store, finalize, limit: 3, dryRun: true }))

    expect(report.mode).toBe('dry-run')
    expect(report.available).toBe(5)
    expect(report.selected).toBe(3) // min(available, limit)
    expect(report.counts).toEqual({ created: 0, updated: 0, failed: 0 })
    // nem listMoviePayloads, nem store, nem finalize foram chamados.
    expect(source.listed).toEqual([])
    expect(calls).toHaveLength(0)
    expect(slugCalls).toHaveLength(0)
  })

  it('fetchedAt do raw vira last_synced_at do tipado (frescor herdada)', async () => {
    const seen: Array<{ lastSyncedAt: Date; staleAfter: Date | null }> = []
    const store: EntityStorePort = {
      upsertMovie(input) {
        seen.push({ ...input.timestamps })
        return Promise.resolve({ id: '1', created: true })
      },
      touchMovie: () => Promise.reject(new Error('n/a')),
      upsertTvShow: () => Promise.reject(new Error('n/a')),
      touchTvShow: () => Promise.reject(new Error('n/a')),
      upsertSeasonWithEpisodes: () => Promise.reject(new Error('n/a')),
      touchSeason: () => Promise.reject(new Error('n/a')),
      upsertPerson: () => Promise.reject(new Error('n/a')),
      touchPerson: () => Promise.reject(new Error('n/a')),
    }
    const { finalize } = makeFinalize()
    await promoteMoviesFromRaw(opts({ source: makeSource([movieRow(7)]), store, finalize }))
    expect(seen[0]?.lastSyncedAt).toEqual(FETCHED)
    expect(seen[0]?.staleAfter).toBeNull()
  })
})
