/**
 * run.test.ts — Orquestracao do worker de disponibilidade com portas fake.
 *
 * Trava a separacao dry-run / sample / apply, a idempotencia por REPLACE (nunca
 * append), a resiliencia (uma entidade que falha nao derruba o ciclo) e o log
 * unico sempre que a rede foi tocada. Nenhuma porta parecida com external_ratings.
 */

import { describe, expect, it, vi } from 'vitest'

import type {
  CachePort,
  EntitySelectPort,
  SyncLogPort,
  WatchReplaceOutcome,
  WatchStorePort,
} from '../ports.js'
import {
  runStreamingAvailabilitySync,
  showIdFor,
  STREAMING_SYNC_ENDPOINT,
  type StreamingRunDeps,
  type StreamingRunOptions,
} from '../streaming-availability/run.js'
import type { SelectedEntity, WatchOfferRow } from '../streaming-availability/types.js'

const NOW = new Date('2024-01-01T00:00:00.000Z')

/** Duas entidades filme; batem por tmdbId com os payloads abaixo. */
const ENTITIES: readonly SelectedEntity[] = [
  { entityType: 'movie', entityId: '1', tmdbId: 278, imdbId: null },
  { entityType: 'movie', entityId: '2', tmdbId: 279, imdbId: null },
]

/** Payload valido para um filme tmdb N (uma assinatura Netflix, link https). */
function payloadFor(tmdbId: number): unknown {
  return {
    showType: 'movie',
    tmdbId: `movie/${tmdbId}`,
    streamingOptions: {
      br: [{ type: 'subscription', service: { id: 'netflix', name: 'Netflix' }, link: 'https://n/x' }],
    },
  }
}

type ReplaceInput = Parameters<WatchStorePort['replaceSnapshot']>[0]

interface Harness {
  readonly deps: StreamingRunDeps
  readonly fetchShow: ReturnType<typeof vi.fn>
  readonly cacheWrite: ReturnType<typeof vi.fn>
  readonly syncLogWrite: ReturnType<typeof vi.fn>
  readonly replaceSnapshot: ReturnType<typeof vi.fn>
  readonly select: ReturnType<typeof vi.fn>
  readonly replaceCalls: ReplaceInput[]
}

/** Monta o harness de fakes; `throwOnShowId` simula uma entidade que falha. */
function makeHarness(throwOnShowId?: string): Harness {
  const fetchShow = vi.fn(async (showId: string): Promise<unknown> => {
    if (throwOnShowId !== undefined && showId === throwOnShowId) {
      throw new Error('rede caiu para esta entidade')
    }
    const match = /\/(\d+)$/.exec(showId)
    const tmdbId = match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10)
    return payloadFor(tmdbId)
  })

  const cacheWrite = vi.fn(async (): Promise<void> => undefined)
  const cache: CachePort = { write: cacheWrite }

  const syncLogWrite = vi.fn(async (): Promise<void> => undefined)
  const syncLog: SyncLogPort = { write: syncLogWrite }

  const replaceCalls: ReplaceInput[] = []
  const replaceSnapshot = vi.fn(async (input: ReplaceInput): Promise<WatchReplaceOutcome> => {
    replaceCalls.push(input)
    return { created: input.offers.length, deleted: 1 }
  })
  const watch: WatchStorePort = { replaceSnapshot }

  const select = vi.fn(async (): Promise<readonly SelectedEntity[]> => ENTITIES)
  const entities: EntitySelectPort = {
    select,
    findByTmdbId: vi.fn(async () => null),
    findByImdbId: vi.fn(async () => null),
  }

  const deps: StreamingRunDeps = {
    fetchShow,
    cache,
    syncLog,
    entities,
    watch,
    now: () => NOW,
    requestCount: () => 3,
  }

  return { deps, fetchShow, cacheWrite, syncLogWrite, replaceSnapshot, select, replaceCalls }
}

function options(overrides: Partial<StreamingRunOptions> = {}): StreamingRunOptions {
  return {
    apply: false,
    sample: false,
    kind: 'movie',
    country: 'BR',
    limit: null,
    tmdbId: null,
    imdbId: null,
    cacheTtlMs: 86_400_000,
    ...overrides,
  }
}

describe('runStreamingAvailabilitySync — DRY-RUN', () => {
  it('nunca toca a rede/escrita, mas lista o plano do que SERIA chamado', async () => {
    const h = makeHarness()
    const result = await runStreamingAvailabilitySync(options(), h.deps)

    expect(h.fetchShow).not.toHaveBeenCalled()
    expect(h.replaceSnapshot).not.toHaveBeenCalled()
    expect(h.syncLogWrite).not.toHaveBeenCalled()
    expect(h.cacheWrite).not.toHaveBeenCalled()

    expect(result.status).toBe('empty')
    expect(result.touchedNetwork).toBe(false)
    expect(result.planned).toEqual(['/shows/movie/278', '/shows/movie/279'])
    expect(result.counters.entitiesSelected).toBe(2)
    // A selecao acontece ate no dry-run (as entidades vem do PostgreSQL).
    expect(h.select).toHaveBeenCalledTimes(1)
  })
})

describe('runStreamingAvailabilitySync — SAMPLE', () => {
  it('busca e cacheia por entidade, loga uma vez, mas NUNCA faz replace', async () => {
    const h = makeHarness()
    const result = await runStreamingAvailabilitySync(options({ sample: true }), h.deps)

    expect(h.fetchShow).toHaveBeenCalledTimes(2)
    expect(h.cacheWrite).toHaveBeenCalledTimes(2)
    expect(h.syncLogWrite).toHaveBeenCalledTimes(1)
    expect(h.replaceSnapshot).not.toHaveBeenCalled()

    expect(result.touchedNetwork).toBe(true)
    expect(result.counters.entitiesFetched).toBe(2)
    expect(result.status).toBe('success')
  })
})

describe('runStreamingAvailabilitySync — APPLY', () => {
  it('faz replace uma vez por entidade, com countryCode MAIUSCULO e as ofertas mapeadas', async () => {
    const h = makeHarness()
    const result = await runStreamingAvailabilitySync(options({ apply: true }), h.deps)

    expect(h.replaceSnapshot).toHaveBeenCalledTimes(2)
    for (const call of h.replaceCalls) {
      expect(call.countryCode).toBe('BR')
      expect(call.offers).toHaveLength(1)
      const offer: WatchOfferRow | undefined = call.offers[0]
      expect(offer?.providerName).toBe('Netflix')
      expect(offer?.offerType).toBe('subscription')
      expect(offer?.countryCode).toBe('BR')
    }
    // Contadores refletem o outcome do replace (created=1/entidade, deleted=1/entidade).
    expect(result.counters.offersWritten).toBe(2)
    expect(result.counters.offersDeleted).toBe(2)
  })

  it('countryCode em minusculo nas options ainda chega MAIUSCULO no replace', async () => {
    const h = makeHarness()
    await runStreamingAvailabilitySync(options({ apply: true, country: 'br' }), h.deps)
    for (const call of h.replaceCalls) {
      expect(call.countryCode).toBe('BR')
      expect(call.offers[0]?.countryCode).toBe('BR')
    }
  })
})

describe('runStreamingAvailabilitySync — IDEMPOTENCIA (replace, nunca append)', () => {
  it('rodar duas vezes com o mesmo fake passa o mesmo snapshot COMPLETO (sem duplicar)', async () => {
    const h = makeHarness()
    await runStreamingAvailabilitySync(options({ apply: true }), h.deps)
    await runStreamingAvailabilitySync(options({ apply: true }), h.deps)

    // 2 entidades x 2 rodadas = 4 chamadas; cada uma com o snapshot INTEIRO (len 1).
    expect(h.replaceSnapshot).toHaveBeenCalledTimes(4)
    for (const call of h.replaceCalls) {
      expect(call.offers).toHaveLength(1)
    }

    // A entidade 1 recebe ofertas identicas na rodada 1 e na rodada 2 (nao acumula).
    const entity1Calls = h.replaceCalls.filter((call) => call.entityId === '1')
    expect(entity1Calls).toHaveLength(2)
    expect(entity1Calls[0]?.offers).toEqual(entity1Calls[1]?.offers)
  })
})

describe('runStreamingAvailabilitySync — resiliencia', () => {
  it('uma entidade que falha na busca NAO aborta o ciclo (a outra segue)', async () => {
    const failingShowId = showIdFor(ENTITIES[1] as SelectedEntity) // 'movie/279'
    const h = makeHarness(failingShowId)
    const result = await runStreamingAvailabilitySync(options({ apply: true }), h.deps)

    // So a entidade sadia foi ate o replace.
    expect(h.replaceSnapshot).toHaveBeenCalledTimes(1)
    expect(h.replaceCalls[0]?.entityId).toBe('1')

    expect(result.counters.entitiesFailed).toBe(1)
    expect(result.counters.entitiesFetched).toBe(1)
    expect(result.status).toBe('partial')
    // Log unico mesmo com falha parcial (todo sync externo gera log).
    expect(h.syncLogWrite).toHaveBeenCalledTimes(1)
  })
})

/**
 * Regressao de PERDA DE DADO: o replace so pode rodar quando o payload foi
 * RECONHECIDO. Uma resposta irreconhecivel (identidade trocada, showType
 * desconhecido, corpo estranho) nao ensina nada sobre a entidade — reescrever o
 * snapshot com lista vazia apagaria ofertas boas ja gravadas.
 */
describe('runStreamingAvailabilitySync — payload irreconhecivel NUNCA apaga o snapshot', () => {
  it('identity-mismatch em --apply: replaceSnapshot NAO e chamado', async () => {
    const base = makeHarness()
    const fetchShow = vi.fn(async (): Promise<unknown> => ({
      showType: 'movie',
      tmdbId: 'movie/999', // nao bate com 278/279
      streamingOptions: { br: [] },
    }))
    const deps: StreamingRunDeps = { ...base.deps, fetchShow }

    const result = await runStreamingAvailabilitySync(options({ apply: true }), deps)

    expect(fetchShow).toHaveBeenCalledTimes(2)
    // O bruto ainda vai para api_cache e o ciclo ainda gera log...
    expect(base.cacheWrite).toHaveBeenCalledTimes(2)
    expect(base.syncLogWrite).toHaveBeenCalledTimes(1)
    // ...mas nada e apagado nem reescrito.
    expect(base.replaceSnapshot).not.toHaveBeenCalled()
    expect(result.counters.offersDeleted).toBe(0)
    expect(result.counters.offersWritten).toBe(0)
    expect(result.rejections.some((rej) => rej.reason === 'identity-mismatch')).toBe(true)
  })

  it('payload nao-objeto em --apply: replaceSnapshot NAO e chamado', async () => {
    const base = makeHarness()
    const fetchShow = vi.fn(async (): Promise<unknown> => 'nao sou um show')
    const deps: StreamingRunDeps = { ...base.deps, fetchShow }

    await runStreamingAvailabilitySync(options({ apply: true }), deps)
    expect(base.replaceSnapshot).not.toHaveBeenCalled()
  })

  // Corpo 200 truncado / contrato do upstream alterado: chega um show valido,
  // com identidade correta, mas SEM `streamingOptions`. Isso nao pode limpar as
  // ofertas boas que ja estao no banco.
  it('payload SEM streamingOptions em --apply: snapshot preservado, mas cache/log gravados', async () => {
    const base = makeHarness()
    const fetchShow = vi.fn(async (showId: string): Promise<unknown> => {
      const match = /\/(\d+)$/.exec(showId)
      return { showType: 'movie', tmdbId: `movie/${match?.[1] ?? '0'}` } // sem streamingOptions
    })
    const deps: StreamingRunDeps = { ...base.deps, fetchShow }

    const result = await runStreamingAvailabilitySync(options({ apply: true }), deps)

    // Nada e apagado nem reescrito.
    expect(base.replaceSnapshot).not.toHaveBeenCalled()
    expect(result.counters.offersDeleted).toBe(0)
    expect(result.counters.offersWritten).toBe(0)

    // Mas o bruto vai para api_cache e o ciclo gera log (todo sync externo loga).
    expect(base.cacheWrite).toHaveBeenCalledTimes(2)
    expect(base.syncLogWrite).toHaveBeenCalledTimes(1)

    // O relatorio marca o motivo de forma clara.
    expect(result.rejections.some((rej) => rej.reason === 'missing-streaming-options')).toBe(true)
    expect(result.status).toBe('partial')
  })

  // O outro lado da moeda: `streamingOptions` existe e o pais nao tem oferta.
  // Aqui limpar o snapshot E o comportamento correto (o titulo saiu do catalogo).
  it('CONTRASTE: streamingOptions presente sem oferta BR AINDA faz o replace vazio', async () => {
    const base = makeHarness()
    const fetchShow = vi.fn(async (): Promise<unknown> => ({
      showType: 'movie',
      tmdbId: 'movie/278',
      streamingOptions: { us: [] }, // objeto presente, sem chave 'br'
    }))
    const select = vi.fn(async (): Promise<readonly SelectedEntity[]> => [
      { entityType: 'movie', entityId: '1', tmdbId: 278, imdbId: null },
    ])
    const deps: StreamingRunDeps = {
      ...base.deps,
      fetchShow,
      entities: { ...base.deps.entities, select },
    }

    await runStreamingAvailabilitySync(options({ apply: true }), deps)

    expect(base.replaceSnapshot).toHaveBeenCalledTimes(1)
    expect(base.replaceCalls[0]?.offers).toEqual([])
  })

  it('reconhecido com ZERO ofertas (saiu do catalogo BR) AINDA faz o replace vazio', async () => {
    // Distincao critica: "nao sei nada" (nao mexe) vs "sei que nao ha oferta"
    // (limpa as antigas). Este e o segundo caso.
    const base = makeHarness()
    const fetchShow = vi.fn(async (): Promise<unknown> => ({
      showType: 'movie',
      tmdbId: 'movie/278',
      streamingOptions: { br: [] },
    }))
    const select = vi.fn(async (): Promise<readonly SelectedEntity[]> => [
      { entityType: 'movie', entityId: '1', tmdbId: 278, imdbId: null },
    ])
    const deps: StreamingRunDeps = {
      ...base.deps,
      fetchShow,
      entities: { ...base.deps.entities, select },
    }

    await runStreamingAvailabilitySync(options({ apply: true }), deps)

    expect(base.replaceSnapshot).toHaveBeenCalledTimes(1)
    expect(base.replaceCalls[0]?.offers).toEqual([])
  })
})

describe('runStreamingAvailabilitySync — contrato de portas', () => {
  it('o endpoint logico e estavel', async () => {
    const h = makeHarness()
    const result = await runStreamingAvailabilitySync(options({ sample: true }), h.deps)
    expect(STREAMING_SYNC_ENDPOINT).toBe('/shows/{id}')
    expect(result.endpoint).toBe('/shows/{id}')
  })

  it('a superficie de deps NAO expoe nenhuma porta parecida com external_ratings', () => {
    const h = makeHarness()
    const keys = Object.keys(h.deps)
    expect(keys.some((key) => /rating/i.test(key))).toBe(false)
    // As portas esperadas, e so elas.
    expect(new Set(keys)).toEqual(
      new Set(['fetchShow', 'cache', 'syncLog', 'entities', 'watch', 'now', 'requestCount']),
    )
  })
})
