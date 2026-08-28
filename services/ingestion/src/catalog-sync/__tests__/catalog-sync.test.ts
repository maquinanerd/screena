/**
 * catalog-sync.test.ts — Testes PUROS dos workers de midia (Fase 7), execucao
 * paginada com checkpoint (Fase 8) e normalizacao de generos (Fase 6). Fakes em
 * memoria; sem rede/DB.
 */

import { describe, expect, it } from 'vitest'

import type { CacheFetchInput, CacheResult, SyncLogInput } from '../../ports.js'
import { normalizeGenres } from '../genres-normalize.js'
import { normalizeImages, normalizeVideos } from '../media-normalize.js'
import { runMediaSync, type MediaStorePort, type MediaTarget } from '../media-sync.js'
import { DARK_MEDIA_BIRTH_POLICY } from '../../media-promotion/birth.js'
import { runListSync, type CheckpointState, type CheckpointStorePort } from '../list-sync.js'

function fakeCache() {
  const store = new Map<string, string>()
  return {
    async getOrFetch<T>(input: CacheFetchInput<T>): Promise<CacheResult<T>> {
      const data = await input.fetcher()
      const key = `${input.endpoint}?${JSON.stringify(input.params ?? {})}`
      const payloadHash = JSON.stringify(data)
      const changed = store.get(key) !== payloadHash
      store.set(key, payloadHash)
      return { data, fromCache: false, payloadHash, changed }
    },
    size: () => store.size,
  }
}

function fakeLog() {
  const writes: SyncLogInput[] = []
  return { log: { async write(i: SyncLogInput) { writes.push(i) } }, writes }
}

function fakeMediaStore() {
  const images = new Map<string, string>()
  const videos = new Map<string, string>()
  const store: MediaStorePort = {
    async upsertImages(rows) {
      let created = 0, updated = 0, unchanged = 0
      for (const r of rows) {
        const k = `${r.entityType}:${r.tmdbId}:${r.imageType}:${r.filePath}`
        if (!images.has(k)) { images.set(k, r.payloadHash); created++ }
        else if (images.get(k) !== r.payloadHash) { images.set(k, r.payloadHash); updated++ }
        else unchanged++
      }
      return { created, updated, unchanged }
    },
    async upsertVideos(rows) {
      let created = 0, updated = 0, unchanged = 0
      for (const r of rows) {
        const k = `${r.entityType}:${r.tmdbId}:${r.tmdbVideoId}`
        if (!videos.has(k)) { videos.set(k, r.payloadHash); created++ }
        else if (videos.get(k) !== r.payloadHash) { videos.set(k, r.payloadHash); updated++ }
        else unchanged++
      }
      return { created, updated, unchanged }
    },
  }
  return { store, images, videos }
}

const IMAGES_PAYLOAD = {
  id: 1,
  posters: [{ file_path: '/p.jpg', iso_639_1: 'pt', width: 500, height: 750, aspect_ratio: 0.667, vote_average: 5.1, vote_count: 10 }],
  backdrops: [{ file_path: '/b.jpg', iso_639_1: null }, { iso_639_1: 'en' }],
  logos: [],
}
const VIDEOS_PAYLOAD = {
  id: 1,
  results: [
    { id: 'v1', key: 'abc', site: 'YouTube', name: 'Trailer', type: 'Trailer', official: true, iso_639_1: 'en', iso_3166_1: 'US', size: 1080, published_at: '2020-01-01T00:00:00.000Z' },
    { id: 'v2', site: 'YouTube' }, // sem key -> descartado
  ],
}

describe('normalizadores de midia/genero', () => {
  it('normalizeImages parseia buckets e descarta sem file_path', () => {
    const rows = normalizeImages('movie', 1, IMAGES_PAYLOAD as never)
    expect(rows).toHaveLength(2) // 1 poster + 1 backdrop com file_path; o backdrop sem file_path e descartado
    expect(rows.find((r) => r.imageType === 'poster')?.filePath).toBe('/p.jpg')
    expect(rows.find((r) => r.imageType === 'poster')?.width).toBe(500)
  })

  it('normalizeVideos parseia results, descarta sem key e parseia data', () => {
    const rows = normalizeVideos('movie', 1, VIDEOS_PAYLOAD as never)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.videoKey).toBe('abc')
    expect(rows[0]?.publishedAt).toBeInstanceOf(Date)
  })

  it('normalizeGenres descarta itens sem id/nome', () => {
    const rows = normalizeGenres('movie', { genres: [{ id: 28, name: 'Acao' }, { name: 'sem id' }, { id: 12 }] })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ mediaType: 'movie', tmdbId: 28, name: 'Acao' })
  })
})

describe('runMediaSync', () => {
  it('captura imagens+videos, loga, normaliza e faz upsert', async () => {
    const cache = fakeCache()
    const { log, writes } = fakeLog()
    const { store } = fakeMediaStore()
    const target: MediaTarget = {
      entityType: 'movie', tmdbId: 1,
      endpointBase: '/movie/1',
      fetchImages: async () => IMAGES_PAYLOAD,
      fetchVideos: async () => VIDEOS_PAYLOAD,
    }
    const r = await runMediaSync(target, { cache, log, store, now: () => new Date(0), birth: DARK_MEDIA_BIRTH_POLICY })
    expect(r.images.captured).toBe(true)
    expect(r.images.rows).toBe(2)
    expect(r.images.created).toBe(2)
    expect(r.videos?.created).toBe(1)
    expect(writes).toHaveLength(2) // 1 log imagens + 1 log videos

    // Segundo ciclo: mesmos payloads -> tudo unchanged (idempotente).
    const r2 = await runMediaSync(target, { cache, log, store, now: () => new Date(0), birth: DARK_MEDIA_BIRTH_POLICY })
    expect(r2.images.created).toBe(0)
    expect(r2.images.unchanged).toBe(2)
    expect(r2.videos?.unchanged).toBe(1)
  })

  it('pessoa (sem fetchVideos) nao sincroniza videos', async () => {
    const cache = fakeCache()
    const { log } = fakeLog()
    const { store } = fakeMediaStore()
    const target: MediaTarget = {
      entityType: 'person', tmdbId: 5,
      endpointBase: '/person/5',
      fetchImages: async () => ({ id: 5, profiles: [{ file_path: '/x.jpg' }] }),
    }
    const r = await runMediaSync(target, { cache, log, store, now: () => new Date(0), birth: DARK_MEDIA_BIRTH_POLICY })
    expect(r.videos).toBeNull()
    expect(r.images.rows).toBe(1)
  })
})

function fakeCheckpointStore() {
  const map = new Map<string, CheckpointState>()
  const store: CheckpointStorePort = {
    async load(job, ph) { return map.get(`${job}:${ph}`) ?? null },
    async save(job, ph, state) { map.set(`${job}:${ph}`, state) },
  }
  return { store, map }
}

describe('runListSync', () => {
  const fetchPage = async (page: number) => ({ page, total_pages: 3, results: [{ id: page * 10 }, { id: page * 10 + 1 }] })

  it('pagina ate maxPages, deduplica ids, salva checkpoint e retoma', async () => {
    const cache = fakeCache()
    const { log, writes } = fakeLog()
    const { store, map } = fakeCheckpointStore()
    const deps = { cache, log, checkpoint: store, now: () => new Date(0) }
    const opts = { job: 'list:movie/popular', endpoint: '/movie/popular', paramsHash: 'h', fetchPage, maxPages: 2, resume: false }

    const r1 = await runListSync(opts, deps)
    expect(r1.startPage).toBe(1)
    expect(r1.pagesFetched).toBe(2)
    expect(r1.lastPage).toBe(2)
    expect(r1.totalPages).toBe(3)
    expect(r1.done).toBe(false)
    expect(r1.uniqueIds).toBe(4)
    expect(cache.size()).toBe(2) // 1 chave por pagina
    expect(writes).toHaveLength(2)
    expect(map.get('list:movie/popular:h')?.lastPage).toBe(2)

    // Retoma do checkpoint: comeca na pagina 3, termina (3>=3).
    const r2 = await runListSync({ ...opts, resume: true }, deps)
    expect(r2.startPage).toBe(3)
    expect(r2.pagesFetched).toBe(1)
    expect(r2.lastPage).toBe(3)
    expect(r2.done).toBe(true)
    expect(cache.size()).toBe(3)
  })

  it('checkpoint done -> ciclo seguinte nao busca nada', async () => {
    const cache = fakeCache()
    const { log } = fakeLog()
    const { store } = fakeCheckpointStore()
    const deps = { cache, log, checkpoint: store, now: () => new Date(0) }
    const opts = { job: 'discover:movie', endpoint: '/discover/movie', paramsHash: 'h', fetchPage, maxPages: 10, resume: true }
    const full = await runListSync(opts, deps) // busca 1..3, done
    expect(full.done).toBe(true)
    const again = await runListSync(opts, deps)
    expect(again.pagesFetched).toBe(0)
    expect(again.done).toBe(true)
  })
})
