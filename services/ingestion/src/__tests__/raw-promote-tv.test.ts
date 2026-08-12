/**
 * Testes da promocao de SERIE via o core generico (P0-00f.2): a strategy `tv`
 * promove ficha basica + poster/backdrop + external_ids + credits + slug/traducao
 * pt-BR, reusando `promoteFromRaw`. Prova tambem que season/episode NAO sao
 * criados (o normalizer devolve seasonNumbers, mas a promocao os ignora) e que os
 * dois wrappers (movie/tv) passam pelo MESMO core. Sem rede, sem DB — fakes.
 */

import { describe, expect, it } from 'vitest'
import type {
  CreditsWriteOutcome,
  EntityStorePort,
  EntityUpsertOutcome,
  SeasonUpsertOutcome,
  StoreSeasonInput,
  StoreTvShowInput,
} from '../ports.js'
import {
  promoteMoviesFromRaw,
  promoteTvShowsFromRaw,
  readTvDisplayFields,
} from '../raw-promote/run.js'
import type {
  CatalogFinalizePort,
  RawEntityRow,
  RawMovieSource,
  RawTvSource,
} from '../raw-promote/types.js'

const NOW = () => new Date('2026-07-09T00:00:00.000Z')
const FETCHED = new Date('2026-07-01T00:00:00.000Z')

/** Payload de serie valido para normalizeTvShow (+ credits + seasons + external_ids). */
function tvRow(id: number, over: Record<string, unknown> = {}): RawEntityRow {
  return {
    tmdbId: id,
    baseLanguage: 'pt-BR',
    fetchedAt: FETCHED,
    payload: {
      id,
      name: `Serie ${id}`,
      original_name: `Show ${id}`,
      first_air_date: '2019-03-01',
      overview: `Sinopse ${id}`,
      poster_path: `/p${id}.jpg`,
      backdrop_path: `/b${id}.jpg`,
      external_ids: { imdb_id: `tt${1000000 + id}` },
      credits: {
        cast: [{ id: 10, name: 'Ator X', character: 'Heroi', order: 0, credit_id: `c${id}a` }],
        crew: [{ id: 20, name: 'Dir Y', department: 'Directing', job: 'Director', credit_id: `c${id}b` }],
      },
      // A promocao IGNORA seasons (nao cria season/episode).
      seasons: [{ season_number: 1 }, { season_number: 2 }],
      ...over,
    },
  }
}

function makeTvSource(rows: readonly RawEntityRow[]): RawTvSource & { listed: number[] } {
  const listed: number[] = []
  return {
    listed,
    countTvShows: () => Promise.resolve(rows.length),
    listTvShowPayloads: (limit: number) => {
      const slice = rows.slice(0, Math.max(0, limit))
      listed.push(slice.length)
      return Promise.resolve(slice)
    },
  }
}

/** Resumo neutro: o replace-set de creditos e testado no adapter Prisma. */
const NO_CREDITS_WRITTEN: CreditsWriteOutcome = {
  castReplaced: false,
  crewReplaced: false,
  castLinked: 0,
  crewLinked: 0,
  castDropped: 0,
  crewDropped: 0,
}

/** Store fake: upsertTvShow idempotente + spy em upsertSeasonWithEpisodes. */
function makeTvStore(seeded: number[] = []) {
  const seen = new Set<number>(seeded)
  const tvCalls: StoreTvShowInput[] = []
  const seasonCalls: StoreSeasonInput[] = []
  let idSeq = 500
  const store: EntityStorePort = {
    upsertTvShow(input: StoreTvShowInput): Promise<EntityUpsertOutcome> {
      const created = !seen.has(input.tvShow.tmdbId)
      seen.add(input.tvShow.tmdbId)
      idSeq += 1
      tvCalls.push(input)
      return Promise.resolve({ id: String(idSeq), created, credits: NO_CREDITS_WRITTEN })
    },
    upsertSeasonWithEpisodes(input: StoreSeasonInput): Promise<SeasonUpsertOutcome> {
      // Se a promocao chamar isto, o teste "nao cria season" deve falhar.
      seasonCalls.push(input)
      return Promise.resolve({ id: '0', created: true, episodesUpserted: 0 })
    },
    upsertMovie: () => Promise.reject(new Error('n/a')),
    touchMovie: () => Promise.reject(new Error('n/a')),
    touchTvShow: () => Promise.reject(new Error('n/a')),
    touchSeason: () => Promise.reject(new Error('n/a')),
    upsertPerson: () => Promise.reject(new Error('n/a')),
    touchPerson: () => Promise.reject(new Error('n/a')),
  }
  return { store, tvCalls, seasonCalls }
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

const tvOpts = (
  source: RawTvSource,
  store: EntityStorePort,
  finalize: CatalogFinalizePort,
  over: Partial<Parameters<typeof promoteTvShowsFromRaw>[0]> = {},
): Parameters<typeof promoteTvShowsFromRaw>[0] => ({
  source,
  store,
  finalize,
  baseLanguage: 'pt-BR',
  limit: 100,
  now: NOW,
  dryRun: false,
  ...over,
})

describe('readTvDisplayFields', () => {
  it('le name (fallback original_name) e overview; NAO le first_air_date', () => {
    expect(readTvDisplayFields({ name: 'Lost', overview: 'x', first_air_date: '2004-09-22' })).toEqual({
      title: 'Lost',
      overview: 'x',
    })
    expect(readTvDisplayFields({ original_name: 'Only Original' }).title).toBe('Only Original')
    expect(readTvDisplayFields(null)).toEqual({ title: '', overview: null })
  })
})

describe('promoteTvShowsFromRaw', () => {
  it('promove ficha basica + poster/backdrop (via upsertTvShow)', async () => {
    const { store, tvCalls } = makeTvStore()
    const { finalize } = makeFinalize()
    const report = await promoteTvShowsFromRaw(tvOpts(makeTvSource([tvRow(1)]), store, finalize))

    expect(report.entityType).toBe('tv')
    expect(report.counts).toEqual({ created: 1, updated: 0, failed: 0 })
    const input = tvCalls[0]!
    expect(input.tvShow.nameOriginal).toBe('Show 1') // original_name
    expect(input.tvShow.posterPath).toBe('/p1.jpg')
    expect(input.tvShow.backdropPath).toBe('/b1.jpg')
    // Frescor herdada do raw.
    expect(input.timestamps.lastSyncedAt).toEqual(FETCHED)
  })

  it('promove external_ids (imdb) e credits (cast/crew)', async () => {
    const { store, tvCalls } = makeTvStore()
    const { finalize } = makeFinalize()
    await promoteTvShowsFromRaw(tvOpts(makeTvSource([tvRow(1)]), store, finalize))
    const input = tvCalls[0]!
    expect(input.externalIds.length).toBeGreaterThan(0)
    expect(input.externalIds.some((e) => e.source === 'imdb')).toBe(true)
    expect(input.cast.map((c) => c.personTmdbId)).toEqual([10])
    expect(input.crew.map((c) => c.personTmdbId)).toEqual([20])
  })

  it('cria slug canonico + traducao pt-BR do tipo tv', async () => {
    const { store } = makeTvStore()
    const { finalize, slugCalls, translationCalls } = makeFinalize()
    await promoteTvShowsFromRaw(tvOpts(makeTvSource([tvRow(1)]), store, finalize))

    expect(slugCalls[0]).toMatchObject({ entityType: 'tv', desiredSlug: 'serie-1', tmdbId: 1 })
    expect(translationCalls[0]).toMatchObject({ entityType: 'tv', title: 'Serie 1', summary: 'Sinopse 1' })
  })

  it('NAO cria season/episode (ignora seasonNumbers do normalizer)', async () => {
    const { store, tvCalls, seasonCalls } = makeTvStore()
    const { finalize } = makeFinalize()
    await promoteTvShowsFromRaw(tvOpts(makeTvSource([tvRow(1), tvRow(2)]), store, finalize))
    expect(tvCalls).toHaveLength(2)
    expect(seasonCalls).toHaveLength(0) // upsertSeasonWithEpisodes NUNCA chamado
  })

  it('re-run e idempotente: 2a execucao vira updated', async () => {
    const rows = [tvRow(1), tvRow(2)]
    const { store, tvCalls } = makeTvStore()
    const { finalize } = makeFinalize()
    const r1 = await promoteTvShowsFromRaw(tvOpts(makeTvSource(rows), store, finalize))
    expect(r1.counts).toEqual({ created: 2, updated: 0, failed: 0 })
    const r2 = await promoteTvShowsFromRaw(tvOpts(makeTvSource(rows), store, finalize))
    expect(r2.counts).toEqual({ created: 0, updated: 2, failed: 0 })
    expect(tvCalls).toHaveLength(4)
  })

  it('dry-run: so conta (nao chama store nem finalize)', async () => {
    const source = makeTvSource([tvRow(1), tvRow(2), tvRow(3)])
    const { store, tvCalls, seasonCalls } = makeTvStore()
    const { finalize, slugCalls } = makeFinalize()
    const report = await promoteTvShowsFromRaw(tvOpts(source, store, finalize, { limit: 2, dryRun: true }))

    expect(report.mode).toBe('dry-run')
    expect(report.available).toBe(3)
    expect(report.selected).toBe(2)
    expect(source.listed).toEqual([]) // nem leu payloads
    expect(tvCalls).toHaveLength(0)
    expect(seasonCalls).toHaveLength(0)
    expect(slugCalls).toHaveLength(0)
  })
})

describe('wrappers passam pelo core generico (entityType correto)', () => {
  it('movie wrapper -> report.entityType = movie; tv wrapper -> tv', async () => {
    const movieSource: RawMovieSource = {
      countMovies: () => Promise.resolve(0),
      listMoviePayloads: () => Promise.resolve([]),
    }
    const { store } = makeTvStore()
    const { finalize } = makeFinalize()
    const movieReport = await promoteMoviesFromRaw({
      source: movieSource,
      store,
      finalize,
      baseLanguage: 'pt-BR',
      limit: 5,
      now: NOW,
      dryRun: true,
    })
    const tvReport = await promoteTvShowsFromRaw(tvOpts(makeTvSource([]), store, finalize, { dryRun: true }))
    expect(movieReport.entityType).toBe('movie')
    expect(tvReport.entityType).toBe('tv')
  })
})
