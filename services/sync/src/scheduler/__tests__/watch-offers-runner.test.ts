/**
 * watch-offers-runner.test.ts — A fila `watch_offers` GRAVA o que baixa.
 *
 * REGRESSAO QUE ESTE ARQUIVO TRAVA (medida em producao em 2026-10-29/30): o
 * agendador montava os servicos de catalogo sem o gravador de ofertas, o runner
 * passava `deps.services.watch as never` e o ingest devolvia `not-configured`
 * para todo titulo. O painel mostrou 0 itens processados em 7 dias, com a fila
 * "verde". Trava tambem:
 *  - a resposta passa pelo `api_cache` (na chave do endpoint dedicado), que e a
 *    marca de "conferido" que a selecao le;
 *  - o titulo sem oferta CONTA como processado (o snapshot vazio revoga);
 *  - o desligamento para ENTRE titulos, sem buscar mais nada.
 */

import { describe, expect, it } from 'vitest'

import type { DetailWatchSink } from '@screena/ingestion/runtime'

import { QUEUE_RUNNERS, watchProvidersEndpoint, type RunnerDeps } from '../runtime/runners.js'

const NOW = new Date('2026-10-30T12:00:00.000Z')

interface World {
  readonly deps: RunnerDeps
  readonly cacheKeys: string[]
  readonly fetched: string[]
  readonly written: { entityId: string; countryCode: string; offers: number }[]
}

function world(options: {
  readonly payload: unknown
  readonly withSink?: boolean
  readonly aborted?: boolean
}): World {
  const cacheKeys: string[] = []
  const fetched: string[] = []
  const written: World['written'] = []

  const sink: DetailWatchSink = {
    territories: ['BR'],
    staleAfterMs: 24 * 60 * 60 * 1000,
    resolver: {
      async resolve(_entityType, tmdbIds) {
        return tmdbIds.map((tmdbId) => ({ tmdbId, entityId: String(tmdbId * 10) }))
      },
    },
    store: {
      async replaceSnapshot(input) {
        written.push({ entityId: input.entityId, countryCode: input.countryCode, offers: input.offers.length })
        return { upserted: input.offers.length, revoked: 0 }
      },
    },
  }

  const controller = new AbortController()
  if (options.aborted === true) controller.abort()

  const prisma = {
    // A selecao faz duas consultas (filmes e series): um filme, nenhuma serie.
    $queryRawUnsafe: async (sql: string) => (sql.includes('"movies"') ? [{ tmdb_id: 7 }] : []),
  } as unknown as RunnerDeps['prisma']

  const deps: RunnerDeps = {
    prisma,
    services: {
      store: { enqueue: async () => ({ created: true }) },
      watch: options.withSink === false ? undefined : sink,
      cache: {
        async getOrFetch(input) {
          cacheKeys.push(input.endpoint)
          return { data: await input.fetcher(), fromCache: false }
        },
      },
    },
    catalogEndpoints: {
      getMovieWatchProviders: async (tmdbId) => {
        fetched.push(`movie:${String(tmdbId)}`)
        return options.payload
      },
      getTvWatchProviders: async (tmdbId) => {
        fetched.push(`tv:${String(tmdbId)}`)
        return options.payload
      },
    },
    now: () => NOW,
    log: { log: () => undefined },
    locale: 'pt-BR',
    batchLimit: 2000,
    discoveryLimit: 10,
    repoRoot: '/repositorio-de-teste',
    apply: true,
    shutdownSignal: controller.signal,
    github: { token: null, repository: 'maquinanerd/screena' },
  }
  return { deps, cacheKeys, fetched, written }
}

const BR_OFFER = {
  results: {
    BR: {
      link: 'https://www.themoviedb.org/movie/7/watch?locale=BR',
      flatrate: [{ provider_id: 8, provider_name: 'Netflix', display_priority: 1, logo_path: '/n.jpg' }],
    },
  },
}

describe('fila watch_offers', () => {
  it('grava a oferta baixada pelo gravador do import (nao descarta)', async () => {
    const w = world({ payload: BR_OFFER })
    const tally = await QUEUE_RUNNERS.watch_offers(w.deps)
    expect(w.written).toEqual([{ entityId: '70', countryCode: 'BR', offers: 1 }])
    expect(tally.processed).toBe(1)
    expect(tally.skipped).toBe(0)
  })

  it('a resposta passa pelo api_cache na chave do endpoint dedicado', async () => {
    const w = world({ payload: BR_OFFER })
    const tally = await QUEUE_RUNNERS.watch_offers(w.deps)
    expect(w.cacheKeys).toEqual([watchProvidersEndpoint('movie', 7)])
    expect(w.cacheKeys[0]).toBe('/movie/7/watch/providers')
    expect(tally.spend).toEqual([{ providerApi: 'tmdb', requests: 1 }])
  })

  it('titulo sem oferta no Brasil conta como processado e grava o snapshot vazio', async () => {
    const w = world({ payload: { results: {} } })
    const tally = await QUEUE_RUNNERS.watch_offers(w.deps)
    expect(w.written).toEqual([{ entityId: '70', countryCode: 'BR', offers: 0 }])
    expect(tally.processed).toBe(1)
  })

  it('CONTROLE NEGATIVO: sem gravador, o desfecho e `not-configured` e nada e gravado', async () => {
    const w = world({ payload: BR_OFFER, withSink: false })
    const tally = await QUEUE_RUNNERS.watch_offers(w.deps)
    expect(w.written).toHaveLength(0)
    expect(tally.processed).toBe(0)
    expect(tally.skipped).toBe(1)
  })

  it('desligamento pedido: nenhuma busca, titulo contado como nao conferido', async () => {
    const w = world({ payload: BR_OFFER, aborted: true })
    const tally = await QUEUE_RUNNERS.watch_offers(w.deps)
    expect(w.fetched).toHaveLength(0)
    expect(tally.skipped).toBe(1)
    expect(tally.processed).toBe(0)
  })
})
