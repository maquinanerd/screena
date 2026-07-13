/**
 * run.test.ts — Orquestracao do worker de disponibilidade com portas fake.
 *
 * Trava a separacao dry-run / sample / apply, a chave da chamada = IMDb id, a
 * idempotencia por REPLACE (nunca append), a resiliencia (uma entidade que falha
 * ou some (404) nao derruba o ciclo), o skip de quem nao tem IMDb id e o log
 * unico sempre que a rede foi tocada. Nenhuma porta parecida com external_ratings.
 */

import { describe, expect, it, vi } from 'vitest'

import { RapidApiHttpError } from '@screena/rapidapi-core'

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

/** Duas entidades filme, cada uma com IMDb id real (a chave da chamada). */
const ENTITIES: readonly SelectedEntity[] = [
  { entityType: 'movie', entityId: '1', tmdbId: 278, imdbId: 'tt0000278' },
  { entityType: 'movie', entityId: '2', tmdbId: 279, imdbId: 'tt0000279' },
]

/** Payload valido para uma entidade (uma assinatura Netflix, link https). */
function payloadFor(entity: SelectedEntity): unknown {
  return {
    showType: 'movie',
    imdbId: entity.imdbId,
    tmdbId: `movie/${entity.tmdbId}`,
    streamingOptions: {
      br: [{ type: 'subscription', service: { id: 'netflix', name: 'Netflix' }, link: 'https://n/x' }],
    },
  }
}

/** Devolve o payload da entidade cujo IMDb id foi consultado. */
function payloadByImdb(imdbId: string): unknown {
  const entity = ENTITIES.find((candidate) => candidate.imdbId === imdbId)
  if (entity === undefined) throw new Error(`IMDb id desconhecido no fake: ${imdbId}`)
  return payloadFor(entity)
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

/**
 * Monta o harness de fakes. `failOn` injeta uma falha por IMDb id:
 *  - `'network'` -> erro de rede sem status (conta como `entitiesFailed`);
 *  - `'404'`     -> RapidApiHttpError 404 (conta como `entitiesNotFound`).
 */
function makeHarness(failOn: Readonly<Record<string, 'network' | '404'>> = {}): Harness {
  const fetchShow = vi.fn(async (imdbId: string): Promise<unknown> => {
    const mode = failOn[imdbId]
    if (mode === 'network') throw new Error('rede caiu para esta entidade')
    if (mode === '404') {
      throw new RapidApiHttpError({
        status: 404,
        body: '{"message":"not found"}',
        permanent: true,
        providerApi: 'streaming_availability',
        endpoint: `/shows/${imdbId}`,
      })
    }
    return payloadByImdb(imdbId)
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
  it('nunca toca a rede/escrita, mas lista o plano por IMDb id', async () => {
    const h = makeHarness()
    const result = await runStreamingAvailabilitySync(options(), h.deps)

    expect(h.fetchShow).not.toHaveBeenCalled()
    expect(h.replaceSnapshot).not.toHaveBeenCalled()
    expect(h.syncLogWrite).not.toHaveBeenCalled()
    expect(h.cacheWrite).not.toHaveBeenCalled()

    expect(result.status).toBe('empty')
    expect(result.touchedNetwork).toBe(false)
    // O plano usa o IMDb id, nunca o TMDB id.
    expect(result.planned).toEqual(['/shows/tt0000278', '/shows/tt0000279'])
    expect(result.counters.entitiesSelected).toBe(2)
    expect(result.counters.entitiesWithoutImdb).toBe(0)
    // A selecao acontece ate no dry-run (as entidades vem do PostgreSQL).
    expect(h.select).toHaveBeenCalledTimes(1)
  })
})

describe('runStreamingAvailabilitySync — SAMPLE', () => {
  it('busca por IMDb id, cacheia por entidade, loga uma vez, NUNCA faz replace', async () => {
    const h = makeHarness()
    const result = await runStreamingAvailabilitySync(options({ sample: true }), h.deps)

    expect(h.fetchShow).toHaveBeenCalledTimes(2)
    expect(h.fetchShow).toHaveBeenNthCalledWith(1, 'tt0000278')
    expect(h.fetchShow).toHaveBeenNthCalledWith(2, 'tt0000279')
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

    expect(h.replaceSnapshot).toHaveBeenCalledTimes(4)
    for (const call of h.replaceCalls) {
      expect(call.offers).toHaveLength(1)
    }

    const entity1Calls = h.replaceCalls.filter((call) => call.entityId === '1')
    expect(entity1Calls).toHaveLength(2)
    expect(entity1Calls[0]?.offers).toEqual(entity1Calls[1]?.offers)
  })
})

describe('runStreamingAvailabilitySync — resiliencia', () => {
  it('uma entidade com erro de REDE NAO aborta o ciclo (a outra segue)', async () => {
    const failing = showIdFor(ENTITIES[1] as SelectedEntity) // 'tt0000279'
    if (failing === null) throw new Error('entidade de teste deveria ter IMDb id')
    const h = makeHarness({ [failing]: 'network' })
    const result = await runStreamingAvailabilitySync(options({ apply: true }), h.deps)

    expect(h.replaceSnapshot).toHaveBeenCalledTimes(1)
    expect(h.replaceCalls[0]?.entityId).toBe('1')

    expect(result.counters.entitiesFailed).toBe(1)
    expect(result.counters.entitiesNotFound).toBe(0)
    expect(result.counters.entitiesFetched).toBe(1)
    expect(result.status).toBe('partial')
    expect(h.syncLogWrite).toHaveBeenCalledTimes(1)
  })

  it('404 por entidade e NOT_FOUND (nao falha) e nao derruba o lote', async () => {
    const missing = showIdFor(ENTITIES[1] as SelectedEntity) // 'tt0000279'
    if (missing === null) throw new Error('entidade de teste deveria ter IMDb id')
    const h = makeHarness({ [missing]: '404' })
    const result = await runStreamingAvailabilitySync(options({ apply: true }), h.deps)

    // A entidade sadia foi ate o replace; a 404 nao.
    expect(h.replaceSnapshot).toHaveBeenCalledTimes(1)
    expect(h.replaceCalls[0]?.entityId).toBe('1')

    expect(result.counters.entitiesNotFound).toBe(1)
    expect(result.counters.entitiesFailed).toBe(0)
    expect(result.counters.entitiesFetched).toBe(1)
    expect(result.status).toBe('partial')
    // Todo sync externo gera log — mesmo com um 404 no meio.
    expect(h.syncLogWrite).toHaveBeenCalledTimes(1)
  })
})

describe('runStreamingAvailabilitySync — entidade SEM IMDb id nunca e consultada', () => {
  it('conta em entitiesWithoutImdb e nunca chama fetchShow para ela', async () => {
    const withImdb: SelectedEntity = { entityType: 'movie', entityId: '1', tmdbId: 278, imdbId: 'tt0000278' }
    const withoutImdb: SelectedEntity = { entityType: 'movie', entityId: '9', tmdbId: 999, imdbId: null }
    const base = makeHarness()
    const select = vi.fn(async (): Promise<readonly SelectedEntity[]> => [withImdb, withoutImdb])
    const deps: StreamingRunDeps = {
      ...base.deps,
      entities: { ...base.deps.entities, select },
    }

    const result = await runStreamingAvailabilitySync(options({ sample: true }), deps)

    // So a entidade com IMDb id vira chamada.
    expect(base.fetchShow).toHaveBeenCalledTimes(1)
    expect(base.fetchShow).toHaveBeenCalledWith('tt0000278')

    expect(result.counters.entitiesSelected).toBe(2)
    expect(result.counters.entitiesWithoutImdb).toBe(1)
    expect(result.counters.entitiesFetched).toBe(1)
    // Um skip por falta de IMDb id torna o ciclo `partial`, nunca `success`.
    expect(result.status).toBe('partial')
    // O plano tambem so lista o alvo com IMDb id.
    expect(result.planned).toEqual(['/shows/tt0000278'])
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
      imdbId: 'tt9999999', // nao bate com tt0000278/tt0000279
      tmdbId: 'movie/999',
      streamingOptions: { br: [] },
    }))
    const deps: StreamingRunDeps = { ...base.deps, fetchShow }

    const result = await runStreamingAvailabilitySync(options({ apply: true }), deps)

    expect(fetchShow).toHaveBeenCalledTimes(2)
    expect(base.cacheWrite).toHaveBeenCalledTimes(2)
    expect(base.syncLogWrite).toHaveBeenCalledTimes(1)
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

  it('payload SEM streamingOptions em --apply: snapshot preservado, mas cache/log gravados', async () => {
    const base = makeHarness()
    const fetchShow = vi.fn(async (imdbId: string): Promise<unknown> => ({
      showType: 'movie',
      imdbId, // identidade correta, mas sem streamingOptions
    }))
    const deps: StreamingRunDeps = { ...base.deps, fetchShow }

    const result = await runStreamingAvailabilitySync(options({ apply: true }), deps)

    expect(base.replaceSnapshot).not.toHaveBeenCalled()
    expect(result.counters.offersDeleted).toBe(0)
    expect(result.counters.offersWritten).toBe(0)

    expect(base.cacheWrite).toHaveBeenCalledTimes(2)
    expect(base.syncLogWrite).toHaveBeenCalledTimes(1)

    expect(result.rejections.some((rej) => rej.reason === 'missing-streaming-options')).toBe(true)
    expect(result.status).toBe('partial')
  })

  it('CONTRASTE: streamingOptions presente sem oferta BR AINDA faz o replace vazio', async () => {
    const base = makeHarness()
    const fetchShow = vi.fn(async (imdbId: string): Promise<unknown> => ({
      showType: 'movie',
      imdbId,
      streamingOptions: { us: [] }, // objeto presente, sem chave 'br'
    }))
    const select = vi.fn(async (): Promise<readonly SelectedEntity[]> => [
      { entityType: 'movie', entityId: '1', tmdbId: 278, imdbId: 'tt0000278' },
    ])
    const deps: StreamingRunDeps = {
      ...base.deps,
      fetchShow,
      entities: { ...base.deps.entities, select },
    }

    const result = await runStreamingAvailabilitySync(options({ apply: true }), deps)

    expect(base.replaceSnapshot).toHaveBeenCalledTimes(1)
    expect(base.replaceCalls[0]?.offers).toEqual([])
    // O pais BR ausente vira uma recusa `country-absent` (o "country_missing:BR").
    expect(result.rejections.some((rej) => rej.reason === 'country-absent')).toBe(true)
  })

  it('reconhecido com ZERO ofertas (saiu do catalogo BR) AINDA faz o replace vazio', async () => {
    const base = makeHarness()
    const fetchShow = vi.fn(async (imdbId: string): Promise<unknown> => ({
      showType: 'movie',
      imdbId,
      streamingOptions: { br: [] },
    }))
    const select = vi.fn(async (): Promise<readonly SelectedEntity[]> => [
      { entityType: 'movie', entityId: '1', tmdbId: 278, imdbId: 'tt0000278' },
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
    expect(new Set(keys)).toEqual(
      new Set(['fetchShow', 'cache', 'syncLog', 'entities', 'watch', 'now', 'requestCount']),
    )
  })
})
