/**
 * refresh-cache-by-reason.test.ts — Quem afirma mudanca nao aceita a copia velha.
 *
 * REGRESSAO QUE ESTE ARQUIVO TRAVA (medida em producao em 2026-10-29): o
 * `/changes` rodou as 00:01 UTC, 18 h depois da coleta anterior, e o
 * `sync_details` que ele enfileirou reaplicou o payload de `api_cache` ainda
 * dentro do TTL de 24 h — 380 de 1.973 filmes e 255 de 941 series daquele lote
 * ficaram com o dado de ANTES da mudanca, e o job terminou "com sucesso". O
 * payload trazia `reason: 'changes'`, e o validador o descartava.
 *
 * Trava, ponta a ponta sem banco:
 *  - o validador LE o motivo do payload montado por `buildCoverageJob`;
 *  - o handler pede `refreshCache` para `changes` e `on_demand`, e so para eles;
 *  - o adapter de cache vai a rede com `bypassFresh` mesmo com copia valida, e
 *    sem ele continua servindo a copia (controle negativo).
 */

import { describe, expect, it } from 'vitest'

import { buildCoverageJob, COVERAGE_REASONS, coverageRefreshesCache } from '../../../entity-coverage/entry.js'
import { createPrismaCache } from '../../../persistence/cache.js'
import { SyncDetailsHandler } from '../sync-details-handler.js'
import { createFakeContext, createHandlerFakes } from './fakes.js'

describe('motivo do job decide se o cache vale', () => {
  it('so `changes` e `on_demand` vao a rede; motivo ausente ou estranho nao', () => {
    const table = Object.fromEntries(COVERAGE_REASONS.map((r) => [r, coverageRefreshesCache(r)]))
    expect(table).toEqual({ discovery: false, changes: true, on_demand: true, scheduled: false })
    expect(coverageRefreshesCache(null)).toBe(false)
    expect(coverageRefreshesCache('outro')).toBe(false)
  })

  for (const reason of COVERAGE_REASONS) {
    it(`o handler repassa refreshCache=${String(coverageRefreshesCache(reason))} para "${reason}"`, async () => {
      const fakes = createHandlerFakes()
      const handler = new SyncDetailsHandler({
        detailSync: fakes.deps.detailSync,
        store: fakes.store,
        search: fakes.deps.search,
      })
      // O payload REAL que a fila grava, nao um montado a mao.
      const job = buildCoverageJob({
        kind: 'movie',
        tmdbId: 1400940,
        locale: 'pt-BR',
        reason,
        scope: '2026-10-28:2026-10-29',
      })
      const input = handler.validateInput(job.payload)
      expect(input.reason).toBe(reason)

      await handler.execute(createFakeContext().context, input)
      expect(fakes.calls.detail[0]?.refreshCache).toBe(coverageRefreshesCache(reason))
    })
  }

  it('payload antigo, sem motivo, continua usando o cache', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })
    const input = handler.validateInput({ entityType: 'movie', tmdbId: 603 })
    expect(input.reason).toBeNull()
    await handler.execute(createFakeContext().context, input)
    expect(fakes.calls.detail[0]?.refreshCache).toBe(false)
  })
})

/** Prisma FAKE de `api_cache`: uma linha guardada, dentro do TTL. */
function fakeCachePrisma(payload: unknown) {
  const row = {
    payload,
    payloadHash: 'hash-velho',
    fetchedAt: new Date('2026-10-28T05:53:02Z'),
    expiresAt: new Date('2026-10-29T05:53:02Z'),
  }
  const upserts: unknown[] = []
  const prisma = {
    apiCache: {
      findUnique: async () => row,
      upsert: async (args: unknown) => {
        upserts.push(args)
        return row
      },
    },
  }
  return { prisma, upserts }
}

describe('cache com bypassFresh', () => {
  const now = () => new Date('2026-10-29T00:01:44Z')

  it('CONTROLE NEGATIVO: sem bypass, a copia dentro do TTL e servida e a rede nao e tocada', async () => {
    const { prisma, upserts } = fakeCachePrisma({ runtime: 106 })
    const cache = createPrismaCache(prisma as never, { ttlMs: 86_400_000, now })
    let fetched = 0
    const result = await cache.getOrFetch({
      endpoint: '/movie/1400940',
      fetcher: async () => {
        fetched += 1
        return { runtime: 109 }
      },
    })
    expect(result.fromCache).toBe(true)
    expect(result.data).toEqual({ runtime: 106 })
    expect(fetched).toBe(0)
    expect(upserts).toHaveLength(0)
  })

  it('com bypass, vai a rede mesmo com copia valida e grava a resposta nova', async () => {
    const { prisma, upserts } = fakeCachePrisma({ runtime: 106 })
    const cache = createPrismaCache(prisma as never, { ttlMs: 86_400_000, now })
    let fetched = 0
    const result = await cache.getOrFetch({
      endpoint: '/movie/1400940',
      bypassFresh: true,
      fetcher: async () => {
        fetched += 1
        return { runtime: 109 }
      },
    })
    expect(fetched).toBe(1)
    expect(result.fromCache).toBe(false)
    expect(result.data).toEqual({ runtime: 109 })
    expect(result.changed).toBe(true)
    expect(upserts).toHaveLength(1)
  })
})
