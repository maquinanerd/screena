/**
 * on-demand-hydration.test.ts — Crescimento sob demanda (B-D).
 *
 * O eixo: NENHUM caminho devolve 404 silencioso. Rate limit, falha de rede e
 * "nao existe" sao TRES desfechos distintos, e confundi-los e caro — memorizar
 * uma queda de rede como "este filme nao existe" esconde a entidade ate o TTL
 * expirar.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  createNegativeCache,
  createOnDemandHydrator,
  createOriginRateLimiter,
  DEFAULT_NEGATIVE_TTL_MS,
  type EntityHydrationPort,
  type FetchOutcome,
  type HydrationRequest,
  type LocalEntityLookup,
} from '../on-demand/hydration.js'

const NOW = new Date('2026-08-11T12:00:00.000Z')

function makeLookup(present: Record<string, string> = {}): LocalEntityLookup {
  return { find: async (kind, tmdbId) => present[`${kind}:${tmdbId}`] ?? null }
}

function makePort(outcome: FetchOutcome | (() => Promise<FetchOutcome>)): EntityHydrationPort {
  return {
    fetchAndPersist: typeof outcome === 'function' ? outcome : async () => outcome,
  }
}

function makeHydrator(
  over: Partial<Parameters<typeof createOnDemandHydrator>[0]> = {},
  clock: () => Date = () => NOW,
) {
  return createOnDemandHydrator({
    lookup: makeLookup(),
    hydration: makePort({ status: 'found', entityId: '1' }),
    negativeCache: createNegativeCache(),
    rateLimiter: createOriginRateLimiter(1_000),
    now: clock,
    ...over,
  })
}

const request: HydrationRequest = { kind: 'movie', tmdbId: 550, origin: '203.0.113.9' }

describe('crescimento sob demanda — desfechos distintos', () => {
  it('entidade ausente e buscada, persistida e passa a existir', async () => {
    const result = await makeHydrator().hydrate(request)
    expect(result.outcome).toBe('hydrated')
    expect(result.entityId).toBe('1')
    expect(result.quotaSpent).toBe(1)
  })

  it('entidade ja presente NAO gasta cota', async () => {
    const fetchAndPersist = vi.fn<EntityHydrationPort['fetchAndPersist']>()
    const result = await makeHydrator({
      lookup: makeLookup({ 'movie:550': '42' }),
      hydration: { fetchAndPersist },
    }).hydrate(request)
    expect(result.outcome).toBe('already_present')
    expect(result.entityId).toBe('42')
    expect(result.quotaSpent).toBe(0)
    expect(fetchAndPersist).not.toHaveBeenCalled()
  })

  it('id inexistente devolve not_found com motivo — nunca 404 mudo', async () => {
    const result = await makeHydrator({
      hydration: makePort({ status: 'not_found' }),
    }).hydrate(request)
    expect(result.outcome).toBe('not_found')
    expect(result.detail).toContain('nao existe no upstream')
  })

  it('falha de transporte e failed, NUNCA not_found', async () => {
    const result = await makeHydrator({
      hydration: makePort({ status: 'failed', errorClass: 'TimeoutError', message: 'ETIMEDOUT' }),
    }).hydrate(request)
    expect(result.outcome).toBe('failed')
    expect(result.detail).toContain('TimeoutError')
  })

  it('porta que LANCA vira failed, nunca not_found', async () => {
    const result = await makeHydrator({
      hydration: makePort(async () => {
        throw new Error('credencial invalida')
      }),
    }).hydrate(request)
    expect(result.outcome).toBe('failed')
    expect(result.detail).toContain('credencial invalida')
  })

  it('pedido malformado e nomeado, nao confundido com ausencia', async () => {
    const hydrator = makeHydrator()
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const result = await hydrator.hydrate({ ...request, tmdbId: bad })
      expect(result.outcome).toBe('invalid_request')
    }
    const badKind = await hydrator.hydrate({
      ...request,
      kind: 'season' as unknown as HydrationRequest['kind'],
    })
    expect(badKind.outcome).toBe('invalid_request')
  })

  it('TODO desfecho passa por onOutcome, inclusive os de recusa', async () => {
    const seen: string[] = []
    const hydrator = makeHydrator({
      hydration: makePort({ status: 'not_found' }),
      onOutcome: (_req, res) => seen.push(res.outcome),
    })
    await hydrator.hydrate(request)
    await hydrator.hydrate(request)
    await hydrator.hydrate({ ...request, tmdbId: -1 })
    expect(seen).toEqual(['not_found', 'known_absent', 'invalid_request'])
  })

  it('nenhum desfecho vem sem explicacao', async () => {
    const hydrator = makeHydrator({ hydration: makePort({ status: 'not_found' }) })
    for (const r of [request, request, { ...request, tmdbId: 0 }]) {
      const result = await hydrator.hydrate(r)
      expect(result.detail.length).toBeGreaterThan(0)
    }
  })
})

describe('cache negativo — o crawler nao vira amplificador de cota', () => {
  it('o segundo pedido do mesmo id inexistente NAO gasta request', async () => {
    const fetchAndPersist = vi.fn<EntityHydrationPort['fetchAndPersist']>(async () => ({
      status: 'not_found' as const,
    }))
    const hydrator = makeHydrator({ hydration: { fetchAndPersist } })

    const first = await hydrator.hydrate(request)
    const second = await hydrator.hydrate(request)

    expect(first.outcome).toBe('not_found')
    expect(second.outcome).toBe('known_absent')
    expect(second.quotaSpent).toBe(0)
    expect(fetchAndPersist).toHaveBeenCalledTimes(1)
  })

  it('cem pedidos do mesmo id inexistente custam UM request', async () => {
    const fetchAndPersist = vi.fn<EntityHydrationPort['fetchAndPersist']>(async () => ({
      status: 'not_found' as const,
    }))
    const hydrator = makeHydrator({
      hydration: { fetchAndPersist },
      rateLimiter: createOriginRateLimiter(1_000),
    })
    for (let i = 0; i < 100; i += 1) await hydrator.hydrate(request)
    expect(fetchAndPersist).toHaveBeenCalledTimes(1)
  })

  it('FALHA nunca entra no cache negativo', async () => {
    const fetchAndPersist = vi.fn<EntityHydrationPort['fetchAndPersist']>(async () => ({
      status: 'failed' as const,
      errorClass: 'TimeoutError',
      message: 'x',
    }))
    const hydrator = makeHydrator({ hydration: { fetchAndPersist } })
    await hydrator.hydrate(request)
    const second = await hydrator.hydrate(request)
    // Se a falha tivesse sido memorizada, o segundo viria `known_absent` e a
    // entidade ficaria escondida ate o TTL expirar.
    expect(second.outcome).toBe('failed')
    expect(fetchAndPersist).toHaveBeenCalledTimes(2)
  })

  it('o negativo EXPIRA: o TMDB publica entidade nova o tempo todo', async () => {
    const cache = createNegativeCache(1_000)
    cache.remember('movie', 550, NOW)
    expect(cache.has('movie', 550, NOW)).toBe(true)
    expect(cache.has('movie', 550, new Date(NOW.getTime() + 999))).toBe(true)
    expect(cache.has('movie', 550, new Date(NOW.getTime() + 1_001))).toBe(false)
  })

  it('o TTL default e 24 h', () => {
    expect(DEFAULT_NEGATIVE_TTL_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('respeita o teto de entradas em vez de vazar memoria', () => {
    const cache = createNegativeCache(60_000, 10)
    for (let i = 1; i <= 50; i += 1) cache.remember('movie', i, NOW)
    expect(cache.size(NOW)).toBeLessThanOrEqual(10)
  })

  it('distingue tipos com o mesmo id', () => {
    const cache = createNegativeCache()
    cache.remember('movie', 1, NOW)
    expect(cache.has('movie', 1, NOW)).toBe(true)
    expect(cache.has('tv', 1, NOW)).toBe(false)
  })
})

describe('rate limit por origem', () => {
  it('estourar a franquia NAO e "nao existe"', async () => {
    const hydrator = makeHydrator({ rateLimiter: createOriginRateLimiter(2) })
    await hydrator.hydrate({ ...request, tmdbId: 1 })
    await hydrator.hydrate({ ...request, tmdbId: 2 })
    const third = await hydrator.hydrate({ ...request, tmdbId: 3 })
    expect(third.outcome).toBe('rate_limited')
    expect(third.entityId).toBeNull()
  })

  it('uma origem abusiva nao consome a franquia das outras', async () => {
    const hydrator = makeHydrator({ rateLimiter: createOriginRateLimiter(1) })
    await hydrator.hydrate({ ...request, tmdbId: 1, origin: 'abusiva' })
    const blocked = await hydrator.hydrate({ ...request, tmdbId: 2, origin: 'abusiva' })
    const other = await hydrator.hydrate({ ...request, tmdbId: 3, origin: 'outra' })
    expect(blocked.outcome).toBe('rate_limited')
    expect(other.outcome).toBe('hydrated')
  })

  it('a janela desliza: passado o intervalo, a origem volta', () => {
    const limiter = createOriginRateLimiter(1, 1_000)
    expect(limiter.tryConsume('a', NOW)).toBe(true)
    expect(limiter.tryConsume('a', new Date(NOW.getTime() + 500))).toBe(false)
    expect(limiter.tryConsume('a', new Date(NOW.getTime() + 1_500))).toBe(true)
  })

  it('um 404 JA CONHECIDO nao consome a franquia da origem', async () => {
    const limiter = createOriginRateLimiter(2)
    const hydrator = makeHydrator({
      hydration: makePort({ status: 'not_found' }),
      rateLimiter: limiter,
    })
    await hydrator.hydrate(request)
    // Dez repeticoes do mesmo id conhecido-ausente: se cada uma gastasse a
    // franquia, um crawler derrubaria o acesso de todos os leitores reais.
    for (let i = 0; i < 10; i += 1) {
      expect((await hydrator.hydrate(request)).outcome).toBe('known_absent')
    }
    expect((await hydrator.hydrate({ ...request, tmdbId: 999 })).outcome).toBe('not_found')
  })

  it('entidade ja presente nao consome franquia', async () => {
    const hydrator = makeHydrator({
      lookup: makeLookup({ 'movie:550': '42' }),
      rateLimiter: createOriginRateLimiter(1),
    })
    for (let i = 0; i < 5; i += 1) {
      expect((await hydrator.hydrate(request)).outcome).toBe('already_present')
    }
  })
})

describe('coalescencia de requisicoes', () => {
  it('dez pedidos simultaneos do mesmo id fazem UMA busca', async () => {
    let resolveFetch: ((outcome: FetchOutcome) => void) | null = null
    const fetchAndPersist = vi.fn<EntityHydrationPort['fetchAndPersist']>(
      () =>
        new Promise<FetchOutcome>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const hydrator = makeHydrator({ hydration: { fetchAndPersist } })

    const pending = Array.from({ length: 10 }, () => hydrator.hydrate(request))
    await Promise.resolve()
    expect(hydrator.inFlight()).toBe(1)

    resolveFetch!({ status: 'found', entityId: '77' })
    const results = await Promise.all(pending)

    expect(fetchAndPersist).toHaveBeenCalledTimes(1)
    expect(results.filter((r) => r.outcome === 'hydrated')).toHaveLength(1)
    expect(results.filter((r) => r.outcome === 'coalesced')).toHaveLength(9)
    // Um unico request de cota para dez leitores simultaneos.
    expect(results.reduce((sum, r) => sum + r.quotaSpent, 0)).toBe(1)
    expect(results.every((r) => r.entityId === '77')).toBe(true)
  })

  it('ids DIFERENTES nao sao coalescidos', async () => {
    const fetchAndPersist = vi.fn<EntityHydrationPort['fetchAndPersist']>(async () => ({
      status: 'found' as const,
      entityId: '1',
    }))
    const hydrator = makeHydrator({ hydration: { fetchAndPersist } })
    await Promise.all([
      hydrator.hydrate({ ...request, tmdbId: 1 }),
      hydrator.hydrate({ ...request, tmdbId: 2 }),
    ])
    expect(fetchAndPersist).toHaveBeenCalledTimes(2)
  })

  it('o coalescido tambem recebe not_found, nunca um sucesso falso', async () => {
    let resolveFetch: ((outcome: FetchOutcome) => void) | null = null
    const hydrator = makeHydrator({
      hydration: makePort(
        () =>
          new Promise<FetchOutcome>((resolve) => {
            resolveFetch = resolve
          }),
      ),
    })
    const pending = [hydrator.hydrate(request), hydrator.hydrate(request)]
    await Promise.resolve()
    resolveFetch!({ status: 'not_found' })
    const results = await Promise.all(pending)
    expect(results.map((r) => r.outcome).sort()).toEqual(['coalesced', 'not_found'])
    expect(results.every((r) => r.entityId === null)).toBe(true)
  })

  it('a busca em voo e liberada mesmo quando a porta LANCA', async () => {
    const hydrator = makeHydrator({
      hydration: makePort(async () => {
        throw new Error('boom')
      }),
    })
    await hydrator.hydrate(request)
    expect(hydrator.inFlight()).toBe(0)
  })
})
