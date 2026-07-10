/**
 * run-item.test.ts — Orquestracao PURA do ENRIQUECIMENTO por item (`/item/`).
 *
 * Regras materializadas e testadas:
 *  - dry-run puro NUNCA toca rede/cache/log/upsert/candidatos;
 *  - toda execucao que TOCA a rede grava api_cache (por id) + UM api_sync_logs
 *    por ciclo — "todo sync gera log", e sempre no endpoint `/item/`;
 *  - `--sample` nunca escreve external_ratings;
 *  - `--apply --id=tt...` resolve por IMDb e grava, separando provider_api
 *    (tecnico) de rating_source (editorial) — invariante 2;
 *  - modo candidatos seleciona por tipo/limite e reusa o id local ja conhecido;
 *  - a falha de rede de UM id nao aborta o ciclo (registra e segue);
 *  - nenhuma chamada a `/popular/` acontece no fluxo de item.
 */

import { describe, it, expect } from 'vitest'

import { FILM_SHOW_RATINGS_PROVIDER_API } from '@screena/film-show-ratings-client'
import { hashPayload } from '@screena/rapidapi-core'

import type {
  CacheWriteInput,
  ExternalRatingUpsertOutcome,
  RatingsEntityCandidate,
  ResolvedEntity,
  SyncLogInput,
} from '../ports.js'
import type { ExternalRatingRow, RatingsEntityType } from '../film-show-ratings/types.js'
import {
  runFilmShowRatingsItemSync,
  DEFAULT_ITEM_CANDIDATE_LIMIT,
  type RatingsItemRunDeps,
  type RatingsItemRunOptions,
} from '../film-show-ratings/run.js'

const PROVIDER = FILM_SHOW_RATINGS_PROVIDER_API
const FIXED_NOW = new Date('2026-07-10T00:00:00.000Z')

/** Envelope real do `GET /item/?id=<id>` com os ratings governados. */
function itemEnvelope(id: string): unknown {
  return {
    status: 'success',
    result: {
      title: `Titulo ${id}`,
      type: 'film',
      ratings: {
        IMDb: { audience: { rating: 7.1, count: 234993, bestValue: 10 } },
        'Rotten Tomatoes': {
          audience: { rating: 88, count: 10000, bestValue: 100 },
          critics: { rating: 80, count: 427, bestValue: 100 },
        },
        Metacritic: {
          audience: { rating: 6.8, count: 475, bestValue: 10 },
          critics: { rating: 67, count: 57, bestValue: 100 },
        },
        Letterboxd: { audience: { rating: 3.45, count: 761921, bestValue: 5 } },
        FilmAffinity: { audience: { rating: 6.8, count: 4902, bestValue: 10 } },
        TMDB: { audience: { rating: 7.2, count: 2790, bestValue: 10 } },
      },
      ids: { IMDb: id, TMDB: '575265' },
      links: { IMDb: `https://www.imdb.com/title/${id}` },
    },
  }
}

/** Item minimo governado: 1 rating filmaffinity valido. */
function tinyEnvelope(id: string): unknown {
  return {
    status: 'success',
    result: { ids: { IMDb: id }, ratings: { FilmAffinity: { audience: { rating: 7, bestValue: 10 } } } },
  }
}

interface Captured {
  fetchIds: string[]
  cacheInputs: CacheWriteInput[]
  syncInputs: SyncLogInput[]
  upsertRows: ExternalRatingRow[]
  imdbLookups: Array<{ entityType: string; imdbId: string }>
  selectCalls: Array<{ entityType: RatingsEntityType; limit: number }>
}

interface HarnessOptions {
  readonly fetch?: (id: string) => unknown
  readonly resolve?: ResolvedEntity | null
  readonly outcome?: ExternalRatingUpsertOutcome
  readonly candidates?: readonly RatingsEntityCandidate[]
}

function makeHarness(opts: HarnessOptions = {}): { deps: RatingsItemRunDeps; captured: Captured } {
  const captured: Captured = {
    fetchIds: [],
    cacheInputs: [],
    syncInputs: [],
    upsertRows: [],
    imdbLookups: [],
    selectCalls: [],
  }
  const deps: RatingsItemRunDeps = {
    fetchItem: async (id) => {
      captured.fetchIds.push(id)
      if (opts.fetch) return opts.fetch(id)
      return itemEnvelope(id)
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
    candidates: {
      selectByType: async (entityType, limit) => {
        captured.selectCalls.push({ entityType, limit })
        return (opts.candidates ?? []).slice(0, limit)
      },
    },
    ratings: {
      upsert: async (row) => {
        captured.upsertRows.push(row)
        return opts.outcome ?? { created: true, changed: true }
      },
    },
    now: () => FIXED_NOW,
    requestCount: () => captured.fetchIds.length,
  }
  return { deps, captured }
}

function options(over: Partial<RatingsItemRunOptions> = {}): RatingsItemRunOptions {
  return {
    apply: false,
    sample: false,
    type: 'film',
    id: null,
    limit: null,
    providerApi: PROVIDER,
    cacheTtlMs: 86_400_000,
    ...over,
  }
}

function candidate(imdbId: string, entityId: string): RatingsEntityCandidate {
  return { entityType: 'movie', entityId, imdbId, tmdbId: null }
}

function first<T>(arr: readonly T[]): T {
  const value = arr[0]
  if (value === undefined) throw new Error('esperava ao menos um elemento')
  return value
}

describe('runFilmShowRatingsItemSync — dry-run', () => {
  it('DRY-RUN puro: nao toca rede/cache/log/upsert/candidatos; status empty, quota 0, endpoint /item/', async () => {
    const { deps, captured } = makeHarness()
    const result = await runFilmShowRatingsItemSync(
      options({ apply: false, sample: false, id: 'tt9603208' }),
      deps,
    )
    expect(captured.fetchIds).toHaveLength(0)
    expect(captured.cacheInputs).toHaveLength(0)
    expect(captured.syncInputs).toHaveLength(0)
    expect(captured.upsertRows).toHaveLength(0)
    expect(captured.selectCalls).toHaveLength(0)
    expect(result.status).toBe('empty')
    expect(result.quotaCost).toBe(0)
    expect(result.touchedNetwork).toBe(false)
    expect(result.endpoint).toBe('/item/')
    expect(result.idsQueried).toBe(0)
  })
})

describe('runFilmShowRatingsItemSync — sample por --id', () => {
  it('busca 1x, grava api_cache no endpoint /item/ e UM api_sync_logs; NUNCA upsert; devolve rawPayload', async () => {
    const { deps, captured } = makeHarness()
    const result = await runFilmShowRatingsItemSync(
      options({ sample: true, id: 'tt9603208' }),
      deps,
    )

    expect(captured.fetchIds).toEqual(['tt9603208'])
    expect(captured.cacheInputs).toHaveLength(1)
    const cache = first(captured.cacheInputs)
    expect(cache.endpoint).toBe('/item/')
    expect(cache.requestKey).toBe('/item/?id=tt9603208')
    expect(cache.payloadHash).toBe(hashPayload(itemEnvelope('tt9603208')))
    expect(captured.syncInputs).toHaveLength(1)
    expect(first(captured.syncInputs).endpoint).toBe('/item/')
    // Sample nunca escreve external_ratings.
    expect(captured.upsertRows).toHaveLength(0)
    // rawPayload volta para o bin sanitizar antes de salvar o sample.
    expect(result.items).toHaveLength(1)
    expect(first(result.items).rawPayload).toEqual(itemEnvelope('tt9603208'))
    expect(result.idsQueried).toBe(1)
    // Ha recusas (metacritic audience + TMDB), entao o ciclo e 'partial'.
    expect(result.status).toBe('partial')
  })
})

describe('runFilmShowRatingsItemSync — apply por --id', () => {
  it('resolve por IMDb e grava external_ratings; provider_api != rating_source (invariante 2)', async () => {
    const { deps, captured } = makeHarness({
      resolve: { entityType: 'movie', entityId: '42' },
      outcome: { created: true, changed: true },
    })
    const result = await runFilmShowRatingsItemSync(
      options({ apply: true, type: 'film', id: 'tt9603208' }),
      deps,
    )

    // 6 drafts governados (imdb, RT audience/critics, metacritic critics, letterboxd, filmaffinity).
    expect(captured.upsertRows).toHaveLength(6)
    const row = first(captured.upsertRows)
    expect(row.providerApi).toBe(PROVIDER)
    expect(row.providerApi).not.toBe(row.ratingSource)
    expect(row.entityType).toBe('movie')
    expect(row.entityId).toBe('42')
    expect(row.providerPayloadHash).toBe(hashPayload(itemEnvelope('tt9603208')))

    // Resolveu por IMDb id consultado (nunca por titulo/ano).
    expect(first(captured.imdbLookups)).toEqual({ entityType: 'movie', imdbId: 'tt9603208' })

    expect(result.counters.ratingsWritten).toBe(6)
    expect(result.counters.ratingsCreated).toBe(6)
    expect(result.idsWithoutEntity).toBe(0)
  })

  it('apply --id onde a entidade NAO resolve: upsert nunca chamado; idsWithoutEntity=1 + entity-not-found', async () => {
    const { deps, captured } = makeHarness({ resolve: null })
    const result = await runFilmShowRatingsItemSync(
      options({ apply: true, type: 'film', id: 'tt9603208' }),
      deps,
    )
    expect(captured.upsertRows).toHaveLength(0)
    expect(result.idsWithoutEntity).toBe(1)
    expect(result.rejections.map((r) => r.reason)).toContain('entity-not-found')
  })
})

describe('runFilmShowRatingsItemSync — modo candidatos (sem --id)', () => {
  it('seleciona por (tipo, limit) e consulta um id por candidato', async () => {
    const { deps, captured } = makeHarness({
      candidates: [candidate('tt1', '10'), candidate('tt2', '20'), candidate('tt3', '30')],
      fetch: (id) => tinyEnvelope(id),
    })
    const result = await runFilmShowRatingsItemSync(options({ sample: true, type: 'film', limit: 3 }), deps)

    expect(captured.selectCalls).toEqual([{ entityType: 'movie', limit: 3 }])
    expect(captured.fetchIds).toEqual(['tt1', 'tt2', 'tt3'])
    expect(captured.cacheInputs).toHaveLength(3)
    // Um unico log por ciclo, nunca um por id.
    expect(captured.syncInputs).toHaveLength(1)
    expect(result.idsQueried).toBe(3)
  })

  it('limit e respeitado: selectByType recebe o limite e so os candidatos retornados sao consultados', async () => {
    const { deps, captured } = makeHarness({
      candidates: [candidate('tt1', '10'), candidate('tt2', '20'), candidate('tt3', '30')],
      fetch: (id) => tinyEnvelope(id),
    })
    await runFilmShowRatingsItemSync(options({ sample: true, type: 'film', limit: 2 }), deps)
    expect(first(captured.selectCalls).limit).toBe(2)
    expect(captured.fetchIds).toEqual(['tt1', 'tt2'])
  })

  it('sem --limit usa o default conservador (20)', async () => {
    const { deps, captured } = makeHarness({ candidates: [candidate('tt1', '10')], fetch: (id) => tinyEnvelope(id) })
    await runFilmShowRatingsItemSync(options({ sample: true, type: 'film', limit: null }), deps)
    expect(first(captured.selectCalls).limit).toBe(DEFAULT_ITEM_CANDIDATE_LIMIT)
    expect(DEFAULT_ITEM_CANDIDATE_LIMIT).toBe(20)
  })

  it('apply em candidato reusa o id local ja conhecido (NAO chama findByImdbId)', async () => {
    const { deps, captured } = makeHarness({
      candidates: [candidate('tt1', '10'), candidate('tt2', '20')],
      fetch: (id) => tinyEnvelope(id),
      outcome: { created: true, changed: true },
    })
    const result = await runFilmShowRatingsItemSync(options({ apply: true, type: 'film', limit: 2 }), deps)

    // Entidade veio da selecao local: nenhuma resolucao extra por IMDb.
    expect(captured.imdbLookups).toHaveLength(0)
    expect(captured.upsertRows.map((r) => r.entityId)).toEqual(['10', '20'])
    expect(result.counters.ratingsWritten).toBe(2)
  })

  it('candidato sem IMDb nunca e selecionado (o adapter filtra imdb nao-nulo; a lista so traz imdb)', async () => {
    // A porta de selecao (adapter Prisma) so devolve candidatos COM imdbId. O run
    // consome `candidate.imdbId` como id de consulta — um candidato sem imdb nunca
    // chega aqui, e nao ha caminho para consultar um id vazio.
    const { deps, captured } = makeHarness({
      candidates: [candidate('tt7', '70')],
      fetch: (id) => tinyEnvelope(id),
    })
    await runFilmShowRatingsItemSync(options({ sample: true, type: 'film', limit: 5 }), deps)
    expect(captured.fetchIds).toEqual(['tt7'])
    expect(captured.fetchIds.every((id) => /^tt\d+$/.test(id))).toBe(true)
  })
})

describe('runFilmShowRatingsItemSync — resiliencia e fronteira', () => {
  it('falha de rede de UM id nao aborta o ciclo: registra item-fetch-failed e segue; log unico; sem vazar chave', async () => {
    const { deps, captured } = makeHarness({
      candidates: [candidate('tt1', '10'), candidate('tt2', '20')],
      fetch: (id) => {
        if (id === 'tt1') throw new Error('boom')
        return tinyEnvelope(id)
      },
    })
    const result = await runFilmShowRatingsItemSync(options({ sample: true, type: 'film', limit: 2 }), deps)

    expect(result.idsFailed).toBe(1)
    expect(result.idsQueried).toBe(2)
    // Cache so para o id que respondeu; log unico do ciclo.
    expect(captured.cacheInputs.map((c) => c.requestKey)).toEqual(['/item/?id=tt2'])
    expect(captured.syncInputs).toHaveLength(1)
    const failed = result.rejections.find((r) => r.reason === 'item-fetch-failed')
    expect(failed?.detail).toContain('tt1')
    expect(failed?.detail).toContain('falha')
    // A mensagem cita so id + NOME do erro — nunca a chave, a URL ou o host.
    expect(failed?.detail).not.toMatch(/https?:\/\//)
    expect(failed?.detail?.toLowerCase()).not.toContain('rapidapi')
    expect(failed?.detail?.toLowerCase()).not.toContain('x-rapidapi-key')
    expect(result.status).toBe('partial')
  })

  it('TODOS os ids falham -> status failed; api_sync_logs ainda gravado', async () => {
    const { deps, captured } = makeHarness({
      candidates: [candidate('tt1', '10')],
      fetch: () => {
        throw new Error('boom')
      },
    })
    const result = await runFilmShowRatingsItemSync(options({ sample: true, type: 'film', limit: 1 }), deps)
    expect(result.status).toBe('failed')
    expect(captured.syncInputs).toHaveLength(1)
    expect(first(captured.syncInputs).status).toBe('failed')
  })

  it('nenhuma chamada a /popular/: todo cache/log usa o endpoint /item/', async () => {
    const { deps, captured } = makeHarness()
    await runFilmShowRatingsItemSync(options({ sample: true, id: 'tt9603208' }), deps)
    for (const cache of captured.cacheInputs) {
      expect(cache.endpoint).toBe('/item/')
      expect(cache.requestKey.startsWith('/item/?id=')).toBe(true)
    }
    for (const log of captured.syncInputs) expect(log.endpoint).toBe('/item/')
  })
})
