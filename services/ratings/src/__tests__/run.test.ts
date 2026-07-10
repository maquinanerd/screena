/**
 * run.test.ts — Orquestracao PURA do worker de ratings, com fakes em memoria.
 *
 * Regras materializadas e testadas:
 *  - dry-run puro NUNCA toca rede/cache/log/upsert;
 *  - toda execucao que TOCA a rede grava api_cache + api_sync_logs (inclusive
 *    payload ambiguo e inclusive falha) — "todo sync gera log";
 *  - `external_ratings` so recebe linha com mapping inequivoco + entidade
 *    resolvida; sob payload ambiguo NADA e gravado (regra 14);
 *  - a linha gravada separa provider_api (tecnico) de rating_source (editorial)
 *    — invariante 2.
 */

import { describe, it, expect } from 'vitest'

import { FILM_SHOW_RATINGS_PROVIDER_API } from '@screena/film-show-ratings-client'
import { hashPayload } from '@screena/rapidapi-core'

import type {
  CacheWriteInput,
  ExternalRatingUpsertOutcome,
  ResolvedEntity,
  SyncLogInput,
} from '../ports.js'
import type { ExternalRatingRow } from '../film-show-ratings/types.js'
import {
  runFilmShowRatingsSync,
  entityTypeOf,
  type RatingsRunDeps,
  type RatingsRunOptions,
} from '../film-show-ratings/run.js'

const PROVIDER = FILM_SHOW_RATINGS_PROVIDER_API
const FIXED_NOW = new Date('2026-07-10T00:00:00.000Z')

/** Item inequivoco: id imdb + rating imdb valido. */
function unambiguousPayload(): unknown {
  return [{ imdbId: 'tt0111161', ratings: [{ source: 'imdb', metric: 'user_rating', value: 8.4, scale: 10 }] }]
}

interface Captured {
  fetchCalls: number
  cacheInputs: CacheWriteInput[]
  syncInputs: SyncLogInput[]
  upsertRows: ExternalRatingRow[]
  imdbLookups: Array<{ entityType: string; imdbId: string }>
}

interface HarnessOptions {
  readonly fetch?: () => unknown
  readonly resolve?: ResolvedEntity | null
  readonly outcome?: ExternalRatingUpsertOutcome
}

function makeHarness(opts: HarnessOptions = {}): { deps: RatingsRunDeps; captured: Captured } {
  const captured: Captured = {
    fetchCalls: 0,
    cacheInputs: [],
    syncInputs: [],
    upsertRows: [],
    imdbLookups: [],
  }
  const deps: RatingsRunDeps = {
    fetchPopular: async (_type) => {
      captured.fetchCalls += 1
      if (opts.fetch) return opts.fetch()
      return { results: [] }
    },
    cache: {
      write: async (input) => {
        captured.cacheInputs.push(input)
      },
    },
    syncLog: {
      write: async (input) => {
        captured.syncInputs.push(input)
      },
    },
    entities: {
      findByImdbId: async (entityType, imdbId) => {
        captured.imdbLookups.push({ entityType, imdbId })
        return opts.resolve ?? null
      },
      findByTmdbId: async () => opts.resolve ?? null,
    },
    ratings: {
      upsert: async (row) => {
        captured.upsertRows.push(row)
        return opts.outcome ?? { created: true, changed: true }
      },
    },
    now: () => FIXED_NOW,
    requestCount: () => 1,
  }
  return { deps, captured }
}

function options(over: Partial<RatingsRunOptions> = {}): RatingsRunOptions {
  return {
    apply: false,
    sample: false,
    type: 'film',
    limit: null,
    providerApi: PROVIDER,
    cacheTtlMs: 86_400_000,
    ...over,
  }
}

function first<T>(arr: readonly T[]): T {
  const value = arr[0]
  if (value === undefined) throw new Error('esperava ao menos um elemento')
  return value
}

describe('entityTypeOf', () => {
  it('film -> movie, show -> tv', () => {
    expect(entityTypeOf('film')).toBe('movie')
    expect(entityTypeOf('show')).toBe('tv')
  })
})

describe('runFilmShowRatingsSync', () => {
  it('DRY-RUN puro: nao toca rede/cache/log/upsert; status empty, quota 0, touchedNetwork false', async () => {
    const { deps, captured } = makeHarness()
    const result = await runFilmShowRatingsSync(options({ apply: false, sample: false }), deps)

    expect(captured.fetchCalls).toBe(0)
    expect(captured.cacheInputs).toHaveLength(0)
    expect(captured.syncInputs).toHaveLength(0)
    expect(captured.upsertRows).toHaveLength(0)
    expect(result.status).toBe('empty')
    expect(result.quotaCost).toBe(0)
    expect(result.touchedNetwork).toBe(false)
  })

  it('SAMPLE: busca 1x, grava api_cache (com payloadHash) e api_sync_logs; NUNCA upsert; devolve rawPayload', async () => {
    const payload = { results: [] as unknown[] }
    const { deps, captured } = makeHarness({ fetch: () => payload })
    const result = await runFilmShowRatingsSync(options({ sample: true, apply: false }), deps)

    expect(captured.fetchCalls).toBe(1)
    expect(captured.cacheInputs).toHaveLength(1)
    const cacheInput = first(captured.cacheInputs)
    expect(cacheInput.payload).toBe(payload)
    expect(cacheInput.payloadHash).toBe(hashPayload(payload))
    expect(captured.syncInputs).toHaveLength(1)
    // Sample nunca escreve external_ratings.
    expect(captured.upsertRows).toHaveLength(0)
    // rawPayload volta para o bin sanitizar antes de salvar o sample.
    expect(result.rawPayload).toBe(payload)
    expect(result.payloadHash).toBe(hashPayload(payload))
  })

  it('APPLY com payload AMBIGUO (forma irreconhecivel): NUNCA upsert; api_cache e api_sync_logs AINDA gravados (regra 14)', async () => {
    const { deps, captured } = makeHarness({ fetch: () => ({ foo: 1 }) })
    const result = await runFilmShowRatingsSync(options({ apply: true, type: 'film' }), deps)

    expect(captured.upsertRows).toHaveLength(0)
    expect(captured.cacheInputs).toHaveLength(1)
    expect(captured.syncInputs).toHaveLength(1)
    expect(result.recognized).toBe(false)
    expect(result.status).toBe('empty')
  })

  it('APPLY com fixture inequivoco + entidade resolvida: upsert 1x, linha separa provider_api de rating_source (invariante 2)', async () => {
    const payload = unambiguousPayload()
    const { deps, captured } = makeHarness({
      fetch: () => payload,
      resolve: { entityType: 'movie', entityId: '42' },
      outcome: { created: true, changed: true },
    })
    const result = await runFilmShowRatingsSync(options({ apply: true, type: 'film' }), deps)

    expect(captured.upsertRows).toHaveLength(1)
    const row = first(captured.upsertRows)
    expect(row.providerApi).toBe(PROVIDER)
    expect(row.ratingSource).toBe('imdb')
    // provider tecnico != fonte editorial.
    expect(row.providerApi).not.toBe(row.ratingSource)
    expect(row.providerPayloadHash).toBe(hashPayload(payload))
    expect(row.fetchedAt).toBeInstanceOf(Date)
    expect(row.entityType).toBe('movie')

    // Resolveu por id inequivoco (nunca por titulo/ano).
    expect(first(captured.imdbLookups)).toEqual({ entityType: 'movie', imdbId: 'tt0111161' })

    expect(result.counters.ratingsWritten).toBe(1)
    expect(result.counters.ratingsCreated).toBe(1)
    expect(result.status).toBe('success')
  })

  it('APPLY onde a entidade NAO resolve: upsert nunca chamado; recusa entity-not-found', async () => {
    const { deps, captured } = makeHarness({ fetch: () => unambiguousPayload(), resolve: null })
    const result = await runFilmShowRatingsSync(options({ apply: true, type: 'film' }), deps)

    expect(captured.upsertRows).toHaveLength(0)
    expect(result.rejections.map((r) => r.reason)).toContain('entity-not-found')
  })

  it('IDEMPOTENCIA: outcome {created:false, changed:false} incrementa ratingsUnchanged e mantem ratingsWritten em 0', async () => {
    const { deps, captured } = makeHarness({
      fetch: () => unambiguousPayload(),
      resolve: { entityType: 'movie', entityId: '42' },
      outcome: { created: false, changed: false },
    })
    const result = await runFilmShowRatingsSync(options({ apply: true, type: 'film' }), deps)

    // Upsert foi chamado, mas nada foi reescrito.
    expect(captured.upsertRows).toHaveLength(1)
    expect(result.counters.ratingsUnchanged).toBe(1)
    expect(result.counters.ratingsWritten).toBe(0)
  })

  it('fetch que lanca: status failed; api_sync_logs AINDA gravado com status failed; upsert nunca chamado', async () => {
    const { deps, captured } = makeHarness({
      fetch: () => {
        throw new Error('boom')
      },
    })
    const result = await runFilmShowRatingsSync(options({ apply: true, type: 'film' }), deps)

    expect(result.status).toBe('failed')
    expect(captured.syncInputs).toHaveLength(1)
    expect(first(captured.syncInputs).status).toBe('failed')
    expect(captured.upsertRows).toHaveLength(0)
    // A falha ocorre antes do cache: nada de api_cache neste caso.
    expect(captured.cacheInputs).toHaveLength(0)
  })

  it('apply=true porem type=null: nada gravado + recusa estrutural (guard sem cast)', async () => {
    const { deps, captured } = makeHarness({
      fetch: () => unambiguousPayload(),
      resolve: { entityType: 'movie', entityId: '42' },
    })
    const result = await runFilmShowRatingsSync(options({ apply: true, type: null }), deps)

    expect(captured.upsertRows).toHaveLength(0)
    expect(result.rejections.map((r) => r.reason)).toContain('entity-not-found')
  })
})
