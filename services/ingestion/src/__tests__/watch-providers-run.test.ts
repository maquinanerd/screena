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

/**
 * O `link` por PAIS faz parte do payload REAL do TMDB — e o unico destino que a
 * oferta de origem TMDB pode ter. Omiti-lo aqui tornaria a fixture mais pobre
 * que o dado de producao e faria toda linha acumular a recusa
 * `missing-country-link`, mascarando as recusas que cada teste realmente mede.
 */
const COUNTRY_LINK = 'https://www.themoviedb.org/movie/550/watch?locale=BR'

function payloadWith(offers: Record<string, unknown>): unknown {
  return { 'watch/providers': { results: { BR: { link: COUNTRY_LINK, ...offers } } } }
}

/** Variante SEM `link`: o pais existe, mas as ofertas ficam sem destino. */
function payloadWithoutLink(offers: Record<string, unknown>): unknown {
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
      territories: ['BR', 'US'],
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

  it('pais sem `link` aparece no relatorio como missing-country-link', async () => {
    const rows: RawWatchSourceRow[] = [
      {
        tmdbId: 1,
        baseLanguage: 'pt-BR',
        payload: payloadWithoutLink({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] }),
      },
    ]
    const report = await runWatchProvidersReprocess(baseOptions(rows, []))
    // A oferta continua sendo reconhecida e contada — o que muda e existir uma
    // linha no relatorio dizendo por que ela nao tera destino na tela.
    expect(report.counts.unrecognized).toBe(0)
    expect(report.rejections).toEqual({ 'missing-country-link': 1 })
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
      {
        providerKey: '8',
        providerName: 'Netflix',
        offers: 2,
        offerTypes: { subscription: 2 },
        countries: ['BR'],
      },
      {
        providerKey: '2',
        providerName: 'Apple TV',
        offers: 1,
        offerTypes: { rent: 1 },
        countries: ['BR'],
      },
    ])
    expect(report.countriesSeen).toEqual(['BR'])
  })

  it('a colheita quebra por MODALIDADE — e o que distingue servico de loja', async () => {
    // Sem esta quebra, "Amazon Prime Video" (assinatura) e "Amazon Video"
    // (loja) sao indistinguiveis no relatorio, e o alias vira adivinhacao pelo
    // nome. Com ela, a decisao sai do payload.
    const rows: RawWatchSourceRow[] = [
      {
        tmdbId: 1,
        baseLanguage: 'pt-BR',
        payload: payloadWith({
          flatrate: [{ provider_id: 119, provider_name: 'Amazon Prime Video' }],
          rent: [{ provider_id: 10, provider_name: 'Amazon Video' }],
          buy: [{ provider_id: 10, provider_name: 'Amazon Video' }],
        }),
      },
    ]
    const report = await runWatchProvidersReprocess(baseOptions(rows, []))
    const byKey = new Map(report.providersSeen.map((p) => [p.providerKey, p]))
    expect(byKey.get('119')?.offerTypes).toEqual({ subscription: 1 })
    expect(byKey.get('10')?.offerTypes).toEqual({ rent: 1, buy: 1 })
  })
})

describe('runWatchProvidersReprocess — escopo territorial (a FK de 2026-08-13)', () => {
  /** Payload multi-pais como o real: 138 paises, um deles no escopo. */
  function multiCountryPayload(countries: readonly string[]): unknown {
    const results: Record<string, unknown> = {}
    for (const code of countries) {
      results[code] = {
        link: COUNTRY_LINK,
        flatrate: [{ provider_id: 8, provider_name: 'Netflix' }],
      }
    }
    return { 'watch/providers': { results } }
  }

  it('CONTROLE POSITIVO: oferta BR chega ao store; pais fora do escopo nunca chega', async () => {
    const written: string[] = []
    const rows: RawWatchSourceRow[] = [
      { tmdbId: 1, baseLanguage: 'pt-BR', payload: multiCountryPayload(['AD', 'AE', 'BR', 'ZW']) },
    ]
    const report = await runWatchProvidersReprocess({
      ...baseOptions(rows, [1]),
      store: makeStore({
        replaceSnapshot: async (input) => {
          written.push(input.countryCode)
          return { upserted: input.offers.length, revoked: 0 }
        },
      }),
    })

    // A unica escrita e BR — os outros tres nunca tocam a FK.
    expect(written).toEqual(['BR'])
    expect(report.counts.applied).toBe(1)
    expect(report.counts.offersUpserted).toBe(1)
    expect(report.counts.failed).toBe(0)
    // E o descarte NAO some: cada pais recusado aparece com sua contagem.
    expect(report.counts.offersOutOfScope).toBe(3)
    expect(report.countriesOutOfScope).toEqual({ AD: 1, AE: 1, ZW: 1 })
    expect(report.territories).toEqual(['BR'])
  })

  it('titulo com oferta so fora do escopo e `out-of-scope`, NUNCA `empty`', async () => {
    const replaceSnapshot = vi.fn(async () => ({ upserted: 0, revoked: 0 }))
    const rows: RawWatchSourceRow[] = [
      { tmdbId: 1, baseLanguage: 'pt-BR', payload: multiCountryPayload(['AD', 'ZW']) },
    ]
    const seen: Record<number, string> = {}
    const report = await runWatchProvidersReprocess({
      ...baseOptions(rows, [1]),
      store: makeStore({ replaceSnapshot }),
      onItem: (id, outcome) => {
        seen[id] = outcome
      },
    })

    expect(replaceSnapshot).not.toHaveBeenCalled()
    expect(seen).toEqual({ 1: 'out-of-scope' })
    expect(report.counts.outOfScope).toBe(1)
    // `empty` afirmaria "o titulo nao tem onde assistir". Ele tem.
    expect(report.counts.empty).toBe(0)
    expect(deriveWatchReprocessStatus(report.counts)).toBe('partial')
  })

  it('a colheita continua medindo o dado INTEIRO, nao so o escopo', async () => {
    const rows: RawWatchSourceRow[] = [
      { tmdbId: 1, baseLanguage: 'pt-BR', payload: multiCountryPayload(['AD', 'BR']) },
    ]
    const report = await runWatchProvidersReprocess(baseOptions(rows, [1]))
    // Um provedor que so aparece fora do escopo continua sendo um provedor que
    // existe: restringir a colheita ao escopo cegaria a descoberta de aliases.
    expect(report.countriesSeen).toEqual(['AD', 'BR'])
    expect(report.providersSeen[0]?.offers).toBe(2)
    expect(report.providersSeen[0]?.countries).toEqual(['AD', 'BR'])
  })
})

describe('runWatchProvidersReprocess — o contador bate com o que foi gravado (T4)', () => {
  function twoCountryPayload(): unknown {
    return {
      'watch/providers': {
        results: {
          BR: { link: COUNTRY_LINK, flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] },
          US: { link: COUNTRY_LINK, flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] },
        },
      },
    }
  }

  it('falha total nunca imprime oferta no contador de SUCESSO', async () => {
    // Este e o relatorio de producao: `aplicados 0 (ofertas: +41)` com 100
    // falhas em 100. O `+41` era real (o replace commita por pais), mas estava
    // somado no numero que acompanha `aplicados` — sucesso anunciado onde nao
    // houve nenhum.
    const rows: RawWatchSourceRow[] = [
      { tmdbId: 1, baseLanguage: 'pt-BR', payload: twoCountryPayload() },
    ]
    const report = await runWatchProvidersReprocess({
      ...baseOptions(rows, [1]),
      territories: ['BR', 'US'],
      store: makeStore({
        replaceSnapshot: async (input) => {
          if (input.countryCode === 'US') throw new Error('FK: country_code')
          return { upserted: input.offers.length, revoked: 0 }
        },
      }),
    })

    expect(report.counts.applied).toBe(0)
    expect(report.counts.failed).toBe(1)
    // Zero no contador de sucesso...
    expect(report.counts.offersUpserted).toBe(0)
    // ...mas o byte gravado NAO evapora: tem contador proprio.
    expect(report.counts.offersUpsertedOnFailedEntities).toBe(1)
    expect(deriveWatchReprocessStatus(report.counts)).toBe('failed')
  })

  it('a falha diz ONDE parou e o que ja tinha sido gravado', async () => {
    const rows: RawWatchSourceRow[] = [
      { tmdbId: 7, baseLanguage: 'pt-BR', payload: twoCountryPayload() },
    ]
    const report = await runWatchProvidersReprocess({
      ...baseOptions(rows, [7]),
      territories: ['BR', 'US'],
      store: makeStore({
        replaceSnapshot: async (input) => {
          if (input.countryCode === 'US') throw new Error('FK: country_code')
          return { upserted: input.offers.length, revoked: 0 }
        },
      }),
    })
    expect(report.failures[0]).toMatchObject({
      tmdbId: 7,
      countryFailed: 'US',
      countriesWritten: ['BR'],
    })
  })

  it('CONTROLE POSITIVO: sucesso total soma tudo no contador de sucesso', async () => {
    const rows: RawWatchSourceRow[] = [
      { tmdbId: 1, baseLanguage: 'pt-BR', payload: twoCountryPayload() },
    ]
    const report = await runWatchProvidersReprocess({
      ...baseOptions(rows, [1]),
      territories: ['BR', 'US'],
    })
    expect(report.counts.applied).toBe(1)
    expect(report.counts.offersUpserted).toBe(2)
    expect(report.counts.offersUpsertedOnFailedEntities).toBe(0)
    expect(deriveWatchReprocessStatus(report.counts)).toBe('success')
  })
})

describe('deriveWatchReprocessStatus — "tudo falhou" nunca vira "nada a fazer"', () => {
  function counts(over: Partial<WatchReprocessCounts>): WatchReprocessCounts {
    return {
      scanned: 0,
      applied: 0,
      empty: 0,
      outOfScope: 0,
      unrecognized: 0,
      unresolved: 0,
      failed: 0,
      offersUpserted: 0,
      offersRevoked: 0,
      offersUpsertedOnFailedEntities: 0,
      offersOutOfScope: 0,
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

  it('tudo fora do escopo territorial e partial, NUNCA empty', () => {
    expect(deriveWatchReprocessStatus(counts({ scanned: 5, outOfScope: 5 }))).toBe('partial')
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
