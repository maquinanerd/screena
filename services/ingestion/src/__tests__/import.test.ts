/**
 * Testes da orquestracao de import com fakes em memoria (sem rede, sem DB).
 * Cobrem: idempotencia, short-circuit por hash, log sempre presente,
 * falha/aborted sem derrubar o pipeline, e import de serie com temporadas.
 */

import { describe, expect, it } from 'vitest'
import type { TmdbEndpoints } from '@screena/tmdb-client'
import { importMovie, importPerson, importTvShow } from '../import/index.js'
import type { ImportContext } from '../import/types.js'
import type {
  CacheFetchInput,
  CachePort,
  CacheResult,
  EntityStorePort,
  SeasonUpsertOutcome,
  StoreMovieInput,
  StorePersonInput,
  StoreSeasonInput,
  StoreTvShowInput,
  SyncLogInput,
  SyncLogPort,
  TmdbReadPort,
  UpsertOutcome,
} from '../ports.js'
import { hashPayload } from '../utils/hash.js'

/** Cache fake: sempre "busca", compara hash por endpoint (ignora TTL). */
class FakeCache implements CachePort {
  private readonly hashes = new Map<string, string>()
  networkCalls = 0

  async getOrFetch<T>(input: CacheFetchInput<T>): Promise<CacheResult<T>> {
    const data = await input.fetcher()
    this.networkCalls += 1
    const payloadHash = hashPayload(data)
    const changed = this.hashes.get(input.endpoint) !== payloadHash
    this.hashes.set(input.endpoint, payloadHash)
    return { data, fromCache: false, payloadHash, changed }
  }
}

/** Store fake: conta upserts/touches e guarda entidades por tmdbId. */
class FakeStore implements EntityStorePort {
  readonly movies = new Map<number, true>()
  readonly tvShows = new Map<number, true>()
  readonly seasons = new Map<string, true>()
  readonly people = new Map<number, true>()
  upsertMovieCount = 0
  touchMovieCount = 0
  upsertTvCount = 0
  touchTvCount = 0
  upsertSeasonCount = 0
  touchSeasonCount = 0
  upsertPersonCount = 0
  touchPersonCount = 0

  async upsertMovie(input: StoreMovieInput): Promise<UpsertOutcome> {
    this.upsertMovieCount += 1
    const created = !this.movies.has(input.movie.tmdbId)
    this.movies.set(input.movie.tmdbId, true)
    return { id: `movie-${input.movie.tmdbId}`, created }
  }
  async touchMovie(tmdbId: number): Promise<boolean> {
    this.touchMovieCount += 1
    return this.movies.has(tmdbId)
  }
  async upsertTvShow(input: StoreTvShowInput): Promise<UpsertOutcome> {
    this.upsertTvCount += 1
    const created = !this.tvShows.has(input.tvShow.tmdbId)
    this.tvShows.set(input.tvShow.tmdbId, true)
    return { id: `tv-${input.tvShow.tmdbId}`, created }
  }
  async touchTvShow(tmdbId: number): Promise<boolean> {
    this.touchTvCount += 1
    return this.tvShows.has(tmdbId)
  }
  async upsertSeasonWithEpisodes(input: StoreSeasonInput): Promise<SeasonUpsertOutcome> {
    this.upsertSeasonCount += 1
    const key = `${input.tvShowTmdbId}:${input.season.seasonNumber}`
    const created = !this.seasons.has(key)
    this.seasons.set(key, true)
    return { id: key, created, episodesUpserted: input.episodes.length }
  }
  async touchSeason(tvShowTmdbId: number, seasonNumber: number): Promise<boolean> {
    this.touchSeasonCount += 1
    return this.seasons.has(`${tvShowTmdbId}:${seasonNumber}`)
  }
  async upsertPerson(input: StorePersonInput): Promise<UpsertOutcome> {
    this.upsertPersonCount += 1
    const created = !this.people.has(input.person.tmdbId)
    this.people.set(input.person.tmdbId, true)
    return { id: `person-${input.person.tmdbId}`, created }
  }
  async touchPerson(tmdbId: number): Promise<boolean> {
    this.touchPersonCount += 1
    return this.people.has(tmdbId)
  }
}

/** Log fake: acumula as entradas escritas. */
class FakeSyncLog implements SyncLogPort {
  readonly entries: SyncLogInput[] = []
  async write(input: SyncLogInput): Promise<void> {
    this.entries.push(input)
  }
}

function makeTmdb(overrides: Partial<TmdbReadPort> = {}): TmdbReadPort {
  const base: TmdbReadPort = {
    getMovie: async (id) => ({
      id,
      original_title: 'Filme',
      original_language: 'en',
      external_ids: { imdb_id: 'tt1' },
      credits: { cast: [{ id: 1, name: 'Ator' }], crew: [] },
    }),
    getTvShow: async (id) => ({
      id,
      original_name: 'Serie',
      external_ids: {},
      credits: {},
      seasons: [{ season_number: 1 }, { season_number: 2 }],
    }),
    getTvSeason: async (_id, seasonNumber) => ({
      season_number: seasonNumber,
      episodes: [{ episode_number: 1 }, { episode_number: 2 }],
    }),
    getPerson: async (id) => ({ id, name: 'Pessoa', external_ids: { imdb_id: 'nm1' } }),
    getUpcomingMovies: async () => ({ page: 1, results: [], total_pages: 1, total_results: 0 }),
  }
  return { ...base, ...overrides }
}

function makeContext(tmdb: TmdbReadPort) {
  const cache = new FakeCache()
  const store = new FakeStore()
  const syncLog = new FakeSyncLog()
  const fixedNow = new Date('2026-06-25T00:00:00.000Z')
  const ctx: ImportContext = {
    tmdb,
    cache,
    store,
    syncLog,
    now: () => fixedNow,
    staleAfter: (now) => new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
  }
  return { ctx, cache, store, syncLog }
}

describe('importMovie', () => {
  it('cria na primeira vez e e idempotente (touch) na segunda', async () => {
    const { ctx, store, syncLog } = makeContext(makeTmdb())
    const first = await importMovie(ctx, 27205)
    const second = await importMovie(ctx, 27205)

    expect(first).toMatchObject({ status: 'success', changed: true, created: true })
    expect(second).toMatchObject({ status: 'success', changed: false, created: false })
    expect(store.upsertMovieCount).toBe(1)
    expect(store.touchMovieCount).toBe(1)
    expect(store.movies.size).toBe(1)
    expect(syncLog.entries).toHaveLength(2)
    expect(syncLog.entries.every((entry) => entry.status === 'success')).toBe(true)
  })

  it('falha de rede e logada (failed) sem relancar', async () => {
    const tmdb = makeTmdb({
      getMovie: async () => {
        throw new Error('rede caiu')
      },
    })
    const { ctx, syncLog, store } = makeContext(tmdb)
    const result = await importMovie(ctx, 1)
    expect(result.status).toBe('failed')
    expect(store.upsertMovieCount).toBe(0)
    expect(syncLog.entries[0]?.status).toBe('failed')
  })

  it('circuit breaker aberto vira status aborted', async () => {
    const circuitError = new Error('aberto')
    circuitError.name = 'TmdbCircuitOpenError'
    const tmdb = makeTmdb({
      getMovie: async () => {
        throw circuitError
      },
    })
    const { ctx, syncLog } = makeContext(tmdb)
    const result = await importMovie(ctx, 1)
    expect(result.status).toBe('aborted')
    expect(syncLog.entries[0]?.status).toBe('aborted')
  })
})

describe('importTvShow', () => {
  it('importa serie + temporadas + episodios e conta a cota de rede', async () => {
    const { ctx, store } = makeContext(makeTmdb())
    const result = await importTvShow(ctx, 1399)
    expect(result.status).toBe('success')
    expect(result.seasons).toBe(2)
    expect(result.episodes).toBe(4)
    expect(result.quotaCost).toBe(3)
    expect(store.upsertTvCount).toBe(1)
    expect(store.upsertSeasonCount).toBe(2)
  })

  it('na segunda execucao faz touch (sem reescrever) serie e temporadas', async () => {
    const { ctx, store } = makeContext(makeTmdb())
    await importTvShow(ctx, 1399)
    const second = await importTvShow(ctx, 1399)
    expect(second.changed).toBe(false)
    expect(store.upsertTvCount).toBe(1)
    expect(store.upsertSeasonCount).toBe(2)
    expect(store.touchTvCount).toBe(1)
    expect(store.touchSeasonCount).toBe(2)
  })
})

describe('importPerson', () => {
  it('cria pessoa e registra log de sucesso', async () => {
    const { ctx, store, syncLog } = makeContext(makeTmdb())
    const result = await importPerson(ctx, 287)
    expect(result).toMatchObject({ status: 'success', created: true })
    expect(store.people.size).toBe(1)
    expect(syncLog.entries[0]?.status).toBe('success')
  })
})

describe('contrato TmdbReadPort', () => {
  it('o client TMDB real (TmdbEndpoints) satisfaz o TmdbReadPort da ingestao', () => {
    // Asserção em tempo de COMPILAÇÃO: se o client deixar de cobrir um método do
    // port (ex.: getUpcomingMovies), o typecheck falha AQUI. composition.ts faz
    // esse assign (tmdb: client.endpoints) em runtime, mas é excluído do
    // typecheck — este teste tranca o contrato tipo <-> runtime.
    const asPort = (client: TmdbEndpoints): TmdbReadPort => client
    expect(typeof asPort).toBe('function')
  })
})
