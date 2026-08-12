/**
 * watch-providers-run.test.ts — Contrato da orquestracao do reprocessamento.
 *
 * Foco: os cinco desfechos sao DISTINGUIVEIS, o erro nunca evapora, e
 * "tudo falhou" nunca e reportado como "nada a fazer".
 */

import { describe, expect, it, vi } from 'vitest'

import {
  classifyWatchError,
  deriveWatchReprocessStatus,
  runWatchProvidersReprocess,
  safeWatchErrorMessage,
} from '../watch-providers/run.js'
import type {
  RawWatchSource,
  RawWatchSourceRow,
  WatchEntityResolver,
  WatchOfferStore,
  WatchReprocessCounts,
} from '../watch-providers/types.js'

const FIXED_NOW = new Date('2026-08-11T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function payloadWith(offers: Record<string, unknown>): unknown {
  return { 'watch/providers': { results: { BR: offers } } }
}

function makeSource(rows: readonly RawWatchSourceRow[]): RawWatchSource {
  return {
    count: async () => rows.length,
    list: async (_type, limit) => rows.slice(0, limit),
  }
}

function makeResolver(known: readonly number[]): WatchEntityResolver {
  return {
    resolve: async (_type, tmdbIds) =>
      tmdbIds.filter((id) => known.includes(id)).map((id) => ({ tmdbId: id, entityId: String(id * 10) })),
  }
}

function makeStore(overrides: Partial<WatchOfferStore> = {}): WatchOfferStore {
  return {
    replaceSnapshot: async (input) => ({ upserted: input.offers.length, revoked: 0 }),
    ...overrides,
  }
}

function baseOptions(rows: readonly RawWatchSourceRow[], known: readonly number[]) {
  return {
    entityType: 'movie' as const,
    source: makeSource(rows),
    resolver: makeResolver(known),
    store: makeStore(),
    limit: 100,
    staleAfterMs: DAY_MS,
    now: () => FIXED_NOW,
    dryRun: false,
  }
}

describe('runWatchProvidersReprocess — os cinco desfechos sao distinguiveis', () => {
  it('separa applied / empty / unrecognized / unresolved em um unico lote', async () => {
    const rows: RawWatchSourceRow[] = [
      {
        tmdbId: 1,
        baseLanguage: 'pt-BR',
        payload: payloadWith({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] }),
      },
      { tmdbId: 2, baseLanguage: 'pt-BR', payload: { 'watch/providers': { results: {} } } },
      { tmdbId: 3, baseLanguage: 'pt-BR', payload: { id: 3 } },
      {
        tmdbId: 4,
        baseLanguage: 'pt-BR',
        payload: payloadWith({ rent: [{ provider_id: 2, provider_name: 'Apple TV' }] }),
      },
    ]
    const seen: Record<number, string> = {}
    const report = await runWatchProvidersReprocess({
      ...baseOptions(rows, [1]),
      onItem: (id, outcome) => {
        seen[id] = outcome
      },
    })

    expect(seen).toEqual({ 1: 'applied', 2: 'empty', 3: 'unrecognized', 4: 'unresolved' })
    expect(report.counts).toMatchObject({
      scanned: 4,
      applied: 1,
      empty: 1,
      unrecognized: 1,
      unresolved: 1,
      failed: 0,
      offersUpserted: 1,
    })
  })

  it('payload NAO reconhecido nunca chama o store (snapshot bom preservado)', async () => {
    const replaceSnapshot = vi.fn(async () => ({ upserted: 0, revoked: 0 }))
    const rows: RawWatchSourceRow[] = [{ tmdbId: 3, baseLanguage: 'pt-BR', payload: { id: 3 } }]
    const report = await runWatchProvidersReprocess({
      ...baseOptions(rows, [3]),
      store: makeStore({ replaceSnapshot }),
    })
    expect(replaceSnapshot).not.toHaveBeenCalled()
    expect(report.counts.unrecognized).toBe(1)
  })

  it('entidade nao promovida nunca chama o store (FK protegida)', async () => {
    const replaceSnapshot = vi.fn(async () => ({ upserted: 0, revoked: 0 }))
    const rows: RawWatchSourceRow[] = [
      {
        tmdbId: 99,
        baseLanguage: 'pt-BR',
        payload: payloadWith({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] }),
      },
    ]
    const report = await runWatchProvidersReprocess({
      ...baseOptions(rows, []),
      store: makeStore({ replaceSnapshot }),
    })
    expect(replaceSnapshot).not.toHaveBeenCalled()
    expect(report.counts.unresolved).toBe(1)
  })

  it('dry-run le e reconhece mas NAO escreve', async () => {
    const replaceSnapshot = vi.fn(async () => ({ upserted: 0, revoked: 0 }))
    const rows: RawWatchSourceRow[] = [
      {
        tmdbId: 1,
        baseLanguage: 'pt-BR',
        payload: payloadWith({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] }),
      },
    ]
    const report = await runWatchProvidersReprocess({
      ...baseOptions(rows, [1]),
      store: makeStore({ replaceSnapshot }),
      dryRun: true,
    })
    expect(replaceSnapshot).not.toHaveBeenCalled()
    expect(report.dryRun).toBe(true)
    expect(report.counts.applied).toBe(1)
    expect(report.counts.offersUpserted).toBe(1)
  })

  it('agrupa por pais: um replace por (entidade, pais)', async () => {
    const calls: string[] = []
    const rows: RawWatchSourceRow[] = [
      {
        tmdbId: 1,
        baseLanguage: 'pt-BR',
        payload: {
          'watch/providers': {
            results: {
              BR: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] },
              US: { flatrate: [{ provider_id: 1899, provider_name: 'Max' }] },
            },
          },
        },
      },
    ]
    await runWatchProvidersReprocess({
      ...baseOptions(rows, [1]),
      store: makeStore({
        replaceSnapshot: async (input) => {
          calls.push(`${input.entityId}:${input.countryCode}:${input.offers.length}`)
          return { upserted: input.offers.length, revoked: 0 }
        },
      }),
    })
    expect(calls.sort()).toEqual(['10:BR:1', '10:US:1'])
  })

  it('propaga fetchedAt/staleAfter a partir do relogio injetado', async () => {
    let captured: { fetchedAt: Date; staleAfter: Date } | null = null
    const rows: RawWatchSourceRow[] = [
      {
        tmdbId: 1,
        baseLanguage: 'pt-BR',
        payload: payloadWith({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] }),
      },
    ]
    await runWatchProvidersReprocess({
      ...baseOptions(rows, [1]),
      store: makeStore({
        replaceSnapshot: async (input) => {
          captured = { fetchedAt: input.fetchedAt, staleAfter: input.staleAfter }
          return { upserted: 1, revoked: 0 }
        },
      }),
    })
    expect(captured).not.toBeNull()
    expect(captured!.fetchedAt.toISOString()).toBe('2026-08-11T12:00:00.000Z')
    expect(captured!.staleAfter.toISOString()).toBe('2026-08-12T12:00:00.000Z')
  })
})

describe('runWatchProvidersReprocess — o erro nunca evapora (B-H)', () => {
  it('falha de escrita preserva classe E mensagem, e conta como failed', async () => {
    class TriggerRejection extends Error {
      constructor() {
        super('watch_availability_display_guard: attribution_text ausente')
        this.name = 'TriggerRejection'
      }
    }
    const rows: RawWatchSourceRow[] = [
      {
        tmdbId: 1,
        baseLanguage: 'pt-BR',
        payload: payloadWith({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] }),
      },
    ]
    const report = await runWatchProvidersReprocess({
      ...baseOptions(rows, [1]),
      store: makeStore({
        replaceSnapshot: async () => {
          throw new TriggerRejection()
        },
      }),
    })

    expect(report.counts.failed).toBe(1)
    expect(report.counts.applied).toBe(0)
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0]).toMatchObject({ tmdbId: 1, errorClass: 'TriggerRejection' })
    // A causa REAL chega ao relatorio; e este o elo que faltava no `catch {}`
    // do watch-review-store, que devolvia `updated: 0` indistinguivel.
    expect(report.failures[0]?.message).toContain('attribution_text ausente')
  })

  it('uma falha nao aborta o lote: os itens seguintes continuam', async () => {
    const rows: RawWatchSourceRow[] = [1, 2, 3].map((tmdbId) => ({
      tmdbId,
      baseLanguage: 'pt-BR',
      payload: payloadWith({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] }),
    }))
    const report = await runWatchProvidersReprocess({
      ...baseOptions(rows, [1, 2, 3]),
      store: makeStore({
        replaceSnapshot: async (input) => {
          if (input.entityId === '20') throw new Error('falha do meio')
          return { upserted: input.offers.length, revoked: 0 }
        },
      }),
    })
    expect(report.counts).toMatchObject({ scanned: 3, applied: 2, failed: 1 })
  })

  it('limita a amostra de falhas mas nunca o CONTADOR', async () => {
    const rows: RawWatchSourceRow[] = Array.from({ length: 60 }, (_, i) => ({
      tmdbId: i + 1,
      baseLanguage: 'pt-BR',
      payload: payloadWith({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] }),
    }))
    const report = await runWatchProvidersReprocess({
      ...baseOptions(
        rows,
        rows.map((r) => r.tmdbId),
      ),
      store: makeStore({
        replaceSnapshot: async () => {
          throw new Error('sempre falha')
        },
      }),
    })
    expect(report.counts.failed).toBe(60)
    expect(report.failures).toHaveLength(50)
  })
})

describe('runWatchProvidersReprocess — relatorio de recusas e provedores', () => {
  it('agrega recusas por motivo (nenhum descarte anonimo)', async () => {
    const rows: RawWatchSourceRow[] = [
      { tmdbId: 1, baseLanguage: 'pt-BR', payload: payloadWith({ desconhecido: [] }) },
      { tmdbId: 2, baseLanguage: 'pt-BR', payload: payloadWith({ outro_bucket: [] }) },
      {
        tmdbId: 3,
        baseLanguage: 'pt-BR',
        payload: payloadWith({ flatrate: [{ provider_name: 'Sem id' }] }),
      },
    ]
    const report = await runWatchProvidersReprocess(baseOptions(rows, []))
    expect(report.rejections).toEqual({ 'unmapped-offer-bucket': 2, 'missing-provider-id': 1 })
  })

  it('lista provedores vistos ordenados por volume — insumo dos aliases', async () => {
    const rows: RawWatchSourceRow[] = [
      {
        tmdbId: 1,
        baseLanguage: 'pt-BR',
        payload: payloadWith({
          flatrate: [{ provider_id: 8, provider_name: 'Netflix' }],
          rent: [{ provider_id: 2, provider_name: 'Apple TV' }],
        }),
      },
      {
        tmdbId: 2,
        baseLanguage: 'pt-BR',
        payload: payloadWith({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] }),
      },
    ]
    const report = await runWatchProvidersReprocess(baseOptions(rows, []))
    expect(report.providersSeen).toEqual([
      { providerKey: '8', providerName: 'Netflix', offers: 2 },
      { providerKey: '2', providerName: 'Apple TV', offers: 1 },
    ])
    expect(report.countriesSeen).toEqual(['BR'])
  })
})

describe('deriveWatchReprocessStatus — "tudo falhou" nunca vira "nada a fazer"', () => {
  function counts(over: Partial<WatchReprocessCounts>): WatchReprocessCounts {
    return {
      scanned: 0,
      applied: 0,
      empty: 0,
      unrecognized: 0,
      unresolved: 0,
      failed: 0,
      offersUpserted: 0,
      offersRevoked: 0,
      ...over,
    }
  }

  it('nada escaneado e empty', () => {
    expect(deriveWatchReprocessStatus(counts({}))).toBe('empty')
  })

  it('tudo falhou e FAILED, nunca empty', () => {
    expect(deriveWatchReprocessStatus(counts({ scanned: 30, failed: 30 }))).toBe('failed')
  })

  it('parte falhou e partial', () => {
    expect(deriveWatchReprocessStatus(counts({ scanned: 30, applied: 20, failed: 10 }))).toBe('partial')
  })

  it('nada aplicado por nao-reconhecido e partial, nunca success nem empty', () => {
    expect(deriveWatchReprocessStatus(counts({ scanned: 5, unrecognized: 5 }))).toBe('partial')
  })

  it('nada aplicado por nao-resolvido e partial', () => {
    expect(deriveWatchReprocessStatus(counts({ scanned: 5, unresolved: 5 }))).toBe('partial')
  })

  it('todos reconhecidos e sem oferta e empty (o titulo nao tem oferta)', () => {
    expect(deriveWatchReprocessStatus(counts({ scanned: 5, empty: 5 }))).toBe('empty')
  })

  it('tudo aplicado e success', () => {
    expect(deriveWatchReprocessStatus(counts({ scanned: 5, applied: 5 }))).toBe('success')
  })

  it('aplicado com resto nao reconhecido e partial', () => {
    expect(deriveWatchReprocessStatus(counts({ scanned: 5, applied: 3, unrecognized: 2 }))).toBe('partial')
  })
})

describe('classificacao segura de erro', () => {
  it('preserva o nome da classe', () => {
    expect(classifyWatchError(new TypeError('x'))).toBe('TypeError')
    expect(classifyWatchError('texto')).toBe('string')
  })

  it('sanitiza e trunca a mensagem sem a apagar', () => {
    expect(safeWatchErrorMessage(new Error('  a\n  b  '))).toBe('a b')
    expect(safeWatchErrorMessage(new Error(''))).toBe('(sem mensagem)')
    expect(safeWatchErrorMessage(new Error('x'.repeat(400)))).toHaveLength(303)
  })
})
