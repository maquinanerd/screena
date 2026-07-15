/**
 * run.test.ts — Testa a orquestracao PURA do sync de taxonomia com fakes em
 * memoria (sem rede/DB). Cobre: captura raw dos 8 endpoints + log de cada ciclo,
 * normalizacao do /configuration, change-detection e resiliencia por endpoint.
 */

import { describe, expect, it } from 'vitest'

import type { CacheFetchInput, CacheResult, SyncLogInput } from '../../ports.js'
import { imageConfigEquals, normalizeImageConfig, type ImageConfigRow } from '../normalize.js'
import {
  TAXONOMY_ENDPOINTS,
  runTaxonomySync,
  type ImageConfigStorePort,
  type ImageConfigUpsertOutcome,
  type TaxonomyReadPort,
  type TaxonomySyncDeps,
} from '../run.js'

const CONFIG_PAYLOAD = {
  images: {
    base_url: 'http://image.tmdb.org/t/p/',
    secure_base_url: 'https://image.tmdb.org/t/p/',
    poster_sizes: ['w92', 'w154', 'original'],
    backdrop_sizes: ['w300', 'original'],
    still_sizes: ['w92', 'original'],
    profile_sizes: ['w45', 'original'],
    logo_sizes: ['w45', 'original'],
  },
  change_keys: ['adult', 'air_date'],
}

function fakeRead(configPayload: unknown = CONFIG_PAYLOAD, failing?: string): TaxonomyReadPort {
  const guard = (endpoint: string, value: unknown) => async () => {
    if (failing === endpoint) throw Object.assign(new Error('boom'), { name: 'TmdbHttpError' })
    return value
  }
  return {
    getConfiguration: guard('/configuration', configPayload),
    getMovieGenres: guard('/genre/movie/list', { genres: [{ id: 28, name: 'Acao' }] }),
    getTvGenres: guard('/genre/tv/list', { genres: [{ id: 10759, name: 'Acao & Aventura' }] }),
    getMovieCertifications: guard('/certification/movie/list', { certifications: { BR: [{ certification: '14' }] } }),
    getTvCertifications: guard('/certification/tv/list', { certifications: { BR: [{ certification: '16' }] } }),
    getCountries: guard('/configuration/countries', [{ iso_3166_1: 'BR', english_name: 'Brazil' }]),
    getLanguages: guard('/configuration/languages', [{ iso_639_1: 'pt', english_name: 'Portuguese' }]),
    getJobs: guard('/configuration/jobs', [{ department: 'Directing', jobs: ['Director'] }]),
  }
}

/** Cache fake: sempre chama o fetcher (simula re-sync); change = hash mudou. */
function fakeCache() {
  const store = new Map<string, string>()
  const cache = {
    async getOrFetch<T>(input: CacheFetchInput<T>): Promise<CacheResult<T>> {
      const data = await input.fetcher()
      const payloadHash = JSON.stringify(data)
      const previous = store.get(input.endpoint)
      const changed = previous !== payloadHash
      store.set(input.endpoint, payloadHash)
      return { data, fromCache: false, payloadHash, changed }
    },
  }
  return { cache }
}

function fakeSyncLog() {
  const writes: SyncLogInput[] = []
  return { log: { async write(input: SyncLogInput) { writes.push(input) } }, writes }
}

function fakeImageConfigStore() {
  let current: ImageConfigRow | null = null
  const store: ImageConfigStorePort = {
    async upsert(row: ImageConfigRow): Promise<ImageConfigUpsertOutcome> {
      if (current === null) { current = row; return { created: true, changed: true } }
      if (imageConfigEquals(current, row)) return { created: false, changed: false }
      current = row
      return { created: false, changed: true }
    },
  }
  return { store, get: () => current }
}

function deps(read: TaxonomyReadPort): {
  d: TaxonomySyncDeps
  writes: SyncLogInput[]
  getConfig: () => ImageConfigRow | null
} {
  const { cache } = fakeCache()
  const { log, writes } = fakeSyncLog()
  const { store, get } = fakeImageConfigStore()
  const now = () => new Date('2026-07-15T12:00:00.000Z')
  return { d: { read, cache, log, imageConfigStore: store, now }, writes, getConfig: get }
}

describe('runTaxonomySync', () => {
  it('captura os 8 endpoints, loga cada ciclo e normaliza /configuration', async () => {
    const { d, writes, getConfig } = deps(fakeRead())
    const summary = await runTaxonomySync(d)

    expect(summary.endpoints).toHaveLength(TAXONOMY_ENDPOINTS.length)
    expect(summary.endpoints.every((e) => e.status === 'success')).toBe(true)
    expect(writes).toHaveLength(TAXONOMY_ENDPOINTS.length) // 1 log por endpoint
    expect(summary.imageConfig).toEqual({ normalized: true, created: true, changed: true })

    const row = getConfig()
    expect(row?.secureBaseUrl).toBe('https://image.tmdb.org/t/p/')
    expect(row?.posterSizes).toContain('original')
    expect(row?.changeKeys).toEqual(['adult', 'air_date'])
  })

  it('segundo ciclo com mesmos payloads nao reescreve o config (idempotente)', async () => {
    const read = fakeRead()
    // Reusa o MESMO cache+store entre os dois ciclos para provar no-op.
    const { cache } = fakeCache()
    const { log, writes } = fakeSyncLog()
    const { store, get } = fakeImageConfigStore()
    const base: TaxonomySyncDeps = { read, cache, log, imageConfigStore: store, now: () => new Date(0) }

    const first = await runTaxonomySync(base)
    expect(first.imageConfig.created).toBe(true)

    const second = await runTaxonomySync(base)
    expect(second.imageConfig).toEqual({ normalized: true, created: false, changed: false })
    expect(get()?.secureBaseUrl).toBe('https://image.tmdb.org/t/p/')
    expect(writes).toHaveLength(TAXONOMY_ENDPOINTS.length * 2)
  })

  it('config invalido (sem secure_base_url) marca partial e nao normaliza', async () => {
    const { d } = deps(fakeRead({ images: { poster_sizes: ['w92'] } }))
    const summary = await runTaxonomySync(d)
    const configResult = summary.endpoints.find((e) => e.endpoint === '/configuration')
    expect(configResult?.status).toBe('partial')
    expect(summary.imageConfig.normalized).toBe(false)
  })

  it('falha isolada de um endpoint e logada como failed; o ciclo continua', async () => {
    const { d, writes } = deps(fakeRead(CONFIG_PAYLOAD, '/genre/tv/list'))
    const summary = await runTaxonomySync(d)
    const failed = summary.endpoints.find((e) => e.endpoint === '/genre/tv/list')
    expect(failed?.status).toBe('failed')
    // config ainda normalizado (endpoints independentes)
    expect(summary.imageConfig.normalized).toBe(true)
    expect(writes.find((w) => w.endpoint === '/genre/tv/list')?.status).toBe('failed')
    expect(writes).toHaveLength(TAXONOMY_ENDPOINTS.length)
  })
})

describe('normalizeImageConfig', () => {
  it('retorna null para payload invalido', () => {
    expect(normalizeImageConfig({})).toBeNull()
    expect(normalizeImageConfig({ images: {} })).toBeNull()
    expect(normalizeImageConfig(null)).toBeNull()
  })

  it('usa secure_base_url como fallback de base_url quando ausente', () => {
    const row = normalizeImageConfig({ images: { secure_base_url: 'https://x/' } })
    expect(row?.baseUrl).toBe('https://x/')
    expect(row?.changeKeys).toBeNull()
  })
})
