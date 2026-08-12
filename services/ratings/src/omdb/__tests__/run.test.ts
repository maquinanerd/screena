/**
 * run.test.ts — Orquestracao do worker OMDb, com fakes em memoria.
 *
 * Zero rede, zero Prisma, zero relogio real. O que este arquivo prova sao as
 * garantias operacionais que nao aparecem no mapper:
 *  - dry-run puro nao toca rede, DB nem cota;
 *  - toda execucao que TOCA a rede grava `api_cache` E `api_sync_logs`;
 *  - `--sample` nunca grava `external_ratings`;
 *  - `--apply` grava as TRES notas, cada uma com sua fonte;
 *  - protecao de cota: 3 falhas consecutivas interrompem o lote e reportam
 *    quantos ids ficaram sem consulta;
 *  - frescor: quem foi consultado ha pouco nao e reconsultado;
 *  - `Response: "False"` (HTTP 200) nao grava nota — e nao passa despercebido.
 */

import { OMDB_PROVIDER_API } from '@screena/omdb-client'
import { describe, expect, it } from 'vitest'

import type {
  CachePort,
  CacheWriteInput,
  EntityLookupPort,
  ExternalRatingsPort,
  StaleEntityCandidateSelectPort,
  SyncLogInput,
  SyncLogPort,
} from '../../ports.js'
import type { ExternalRatingRow } from '../types.js'
import { MAX_CONSECUTIVE_ITEM_FAILURES, runOmdbRatingsSync } from '../run.js'
import { assertFixtureIntact, OMDB_ERROR_PAYLOAD, OMDB_GUARDIANS_PAYLOAD } from './fixture.js'

const NOW = new Date('2026-08-12T12:00:00.000Z')

interface Harness {
  readonly cacheWrites: CacheWriteInput[]
  readonly syncLogs: SyncLogInput[]
  readonly upserts: ExternalRatingRow[]
  readonly cache: CachePort
  readonly syncLog: SyncLogPort
  readonly ratings: ExternalRatingsPort
  readonly entities: EntityLookupPort
}

function harness(): Harness {
  const cacheWrites: CacheWriteInput[] = []
  const syncLogs: SyncLogInput[] = []
  const upserts: ExternalRatingRow[] = []
  return {
    cacheWrites,
    syncLogs,
    upserts,
    cache: {
      async write(input) {
        cacheWrites.push(input)
      },
    },
    syncLog: {
      async write(input) {
        syncLogs.push(input)
      },
    },
    ratings: {
      async upsert(row) {
        upserts.push(row)
        return { created: true, changed: true }
      },
    },
    entities: {
      async findByImdbId(entityType, imdbId) {
        return { entityType, entityId: `local-${imdbId}` }
      },
      async findByTmdbId() {
        return null
      },
    },
  }
}

/** Porta de candidatos que devolve os ids pedidos, com `skippedFresh` fixo. */
function candidatesPort(
  ids: readonly string[],
  skippedFresh = 0,
): StaleEntityCandidateSelectPort & { readonly calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    async selectStaleByType(input) {
      calls.push(input)
      return {
        candidates: ids.map((id, index) => ({
          entityType: input.entityType,
          entityId: `local-${index}`,
          imdbId: id,
          tmdbId: null,
        })),
        skippedFresh,
      }
    },
  }
}

const NO_CANDIDATES: StaleEntityCandidateSelectPort = {
  async selectStaleByType() {
    return { candidates: [], skippedFresh: 0 }
  },
}

function payload(): unknown {
  assertFixtureIntact(OMDB_GUARDIANS_PAYLOAD)
  return structuredClone(OMDB_GUARDIANS_PAYLOAD)
}

const BASE_OPTIONS = {
  entityType: 'movie' as const,
  id: null,
  limit: null,
  providerApi: OMDB_PROVIDER_API,
  cacheTtlMs: 1000,
  ignoreFreshness: false,
}

describe('dry-run puro', () => {
  it('nao toca rede, nao grava cache, nao grava log e nao gasta cota', async () => {
    const h = harness()
    let fetched = 0

    const result = await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: false, sample: false },
      {
        fetchTitle: async () => {
          fetched += 1
          return payload()
        },
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: NO_CANDIDATES,
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => 0,
      },
    )

    expect(fetched).toBe(0)
    expect(result.touchedNetwork).toBe(false)
    expect(result.status).toBe('empty')
    expect(result.quotaCost).toBe(0)
    expect(h.cacheWrites).toEqual([])
    expect(h.syncLogs).toEqual([])
    expect(h.upserts).toEqual([])
  })
})

describe('--sample: busca de verdade, mas nunca grava external_ratings', () => {
  it('grava api_cache e api_sync_logs, e zero notas', async () => {
    const h = harness()

    const result = await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: false, sample: true, id: 'tt3896198' },
      {
        fetchTitle: async () => payload(),
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: NO_CANDIDATES,
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => 1,
      },
    )

    expect(result.touchedNetwork).toBe(true)
    expect(h.cacheWrites).toHaveLength(1)
    expect(h.syncLogs).toHaveLength(1)
    // Reconheceu as tres, mas nao gravou nenhuma.
    expect(result.counters.ratingsRecognized).toBe(3)
    expect(h.upserts).toEqual([])
  })

  it('a chave nunca aparece na request_key do cache', async () => {
    const h = harness()
    await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: false, sample: true, id: 'tt3896198' },
      {
        fetchTitle: async () => payload(),
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: NO_CANDIDATES,
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => 1,
      },
    )
    const written = h.cacheWrites[0]!
    expect(written.requestKey).not.toContain('apikey')
    expect(written.requestKey).toContain('i=tt3896198')
  })
})

describe('--apply: as tres notas entram, cada uma com sua fonte', () => {
  it('grava tres linhas, uma por fonte editorial', async () => {
    const h = harness()

    const result = await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false, id: 'tt3896198' },
      {
        fetchTitle: async () => payload(),
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: NO_CANDIDATES,
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => 1,
      },
    )

    expect(h.upserts).toHaveLength(3)
    expect(h.upserts.map((r) => r.ratingSource).sort()).toEqual([
      'imdb',
      'metacritic',
      'rotten_tomatoes',
    ])
    expect(result.counters.ratingsCreated).toBe(3)
    expect(result.status).toBe('success')
  })

  it('toda linha carrega o fornecedor tecnico separado da fonte (invariante 2)', async () => {
    const h = harness()
    await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false, id: 'tt3896198' },
      {
        fetchTitle: async () => payload(),
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: NO_CANDIDATES,
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => 1,
      },
    )
    for (const row of h.upserts) {
      expect(row.providerApi).toBe(OMDB_PROVIDER_API)
      expect(row.ratingSource).not.toBe(row.providerApi)
      expect(row.providerPayloadHash).toBeTruthy()
      expect(row.fetchedAt).toEqual(NOW)
    }
  })

  it('a metrica usada COLIDE de proposito com a do adapter anterior', async () => {
    // `audience`/`critics` sao o mesmo vocabulario do adapter Film/Show Ratings.
    // Isso faz o upsert REESCREVER as linhas orfas daquela ingestao (mesmo
    // unique) em vez de criar linhas paralelas. Se algum dia mudar, as 30 linhas
    // antigas voltam a ficar orfas — por isso esta travado aqui.
    const h = harness()
    await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false, id: 'tt3896198' },
      {
        fetchTitle: async () => payload(),
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: NO_CANDIDATES,
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => 1,
      },
    )
    const bySource = new Map(h.upserts.map((r) => [r.ratingSource, r.metric]))
    expect(bySource.get('imdb')).toBe('audience')
    expect(bySource.get('rotten_tomatoes')).toBe('critics')
    expect(bySource.get('metacritic')).toBe('critics')
  })

  it('sem entidade local, nada e gravado e o id e contado', async () => {
    const h = harness()
    const result = await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false, id: 'tt3896198' },
      {
        fetchTitle: async () => payload(),
        cache: h.cache,
        syncLog: h.syncLog,
        entities: {
          async findByImdbId() {
            return null
          },
          async findByTmdbId() {
            return null
          },
        },
        candidates: NO_CANDIDATES,
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => 1,
      },
    )

    expect(h.upserts).toEqual([])
    expect(result.idsWithoutEntity).toBe(1)
    expect(result.rejections.map((r) => r.reason)).toContain('entity-not-found')
  })
})

describe('Response: "False" com HTTP 200 nunca vira nota', () => {
  it('nao grava, mas GRAVA cache e log (o erro tambem e auditavel)', async () => {
    const h = harness()

    const result = await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false, id: 'tt0000001' },
      {
        fetchTitle: async () => structuredClone(OMDB_ERROR_PAYLOAD),
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: NO_CANDIDATES,
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => 1,
      },
    )

    expect(h.upserts).toEqual([])
    expect(h.cacheWrites).toHaveLength(1)
    expect(h.syncLogs).toHaveLength(1)
    // E, sobretudo, nao passa como sucesso mudo.
    expect(result.status).toBe('partial')
    expect(result.rejections.map((r) => r.reason)).toContain('omdb-error-response')
  })
})

describe('protecao de cota', () => {
  it(`${MAX_CONSECUTIVE_ITEM_FAILURES} falhas consecutivas interrompem o lote`, async () => {
    const h = harness()
    const ids = ['tt1', 'tt2', 'tt3', 'tt4', 'tt5', 'tt6']
    let attempts = 0

    const result = await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false },
      {
        fetchTitle: async () => {
          attempts += 1
          throw new Error('rede caiu')
        },
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: candidatesPort(ids),
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => attempts,
      },
    )

    expect(attempts).toBe(MAX_CONSECUTIVE_ITEM_FAILURES)
    expect(result.idsQueried).toBe(MAX_CONSECUTIVE_ITEM_FAILURES)
    expect(result.idsSkipped).toBe(ids.length - MAX_CONSECUTIVE_ITEM_FAILURES)
    const aborted = result.rejections.find((r) => r.reason === 'batch-aborted')
    expect(aborted?.detail).toContain('3 id(s) nao consultado(s)')
  })

  it('uma falha ISOLADA no meio do lote nao aborta nada', async () => {
    const h = harness()
    const ids = ['tt1', 'tt2', 'tt3']
    let call = 0

    const result = await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false },
      {
        fetchTitle: async () => {
          call += 1
          if (call === 2) throw new Error('falha isolada')
          return payload()
        },
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: candidatesPort(ids),
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => call,
      },
    )

    expect(result.idsQueried).toBe(3)
    expect(result.idsFailed).toBe(1)
    expect(result.idsSkipped).toBe(0)
    expect(result.rejections.map((r) => r.reason)).not.toContain('batch-aborted')
  })

  it('um unico log por ciclo, nunca um por id', async () => {
    const h = harness()
    await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false },
      {
        fetchTitle: async () => payload(),
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: candidatesPort(['tt1', 'tt2', 'tt3']),
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => 3,
      },
    )
    expect(h.syncLogs).toHaveLength(1)
    expect(h.cacheWrites).toHaveLength(3) // cache e por id
    expect(h.syncLogs[0]?.quotaCost).toBe(3)
  })
})

describe('frescor: nao reconsulta quem foi visto ha pouco', () => {
  it('passa o corte de frescor para a porta de candidatos', async () => {
    const h = harness()
    const port = candidatesPort([])

    await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false },
      {
        fetchTitle: async () => payload(),
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: port,
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => 0,
      },
    )

    const call = port.calls[0] as { cutoff: Date | null; providerApi: string }
    expect(call.providerApi).toBe(OMDB_PROVIDER_API)
    expect(call.cutoff).toBeInstanceOf(Date)
    // 168h antes de NOW.
    expect(call.cutoff!.toISOString()).toBe('2026-08-05T12:00:00.000Z')
  })

  it('reporta quantos foram pulados por frescor (0 consultados nao e falha)', async () => {
    const h = harness()

    const result = await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false },
      {
        fetchTitle: async () => payload(),
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: candidatesPort([], 42),
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => 0,
      },
    )

    expect(result.idsQueried).toBe(0)
    expect(result.idsSkippedFresh).toBe(42)
    expect(result.quotaCost).toBe(0)
    expect(result.refreshWindowHours).toBe(168)
  })

  it('--ignore-freshness desliga o corte (cutoff null)', async () => {
    const h = harness()
    const port = candidatesPort([])

    const result = await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false, ignoreFreshness: true },
      {
        fetchTitle: async () => payload(),
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: port,
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => 0,
      },
    )

    expect((port.calls[0] as { cutoff: Date | null }).cutoff).toBeNull()
    expect(result.refreshWindowHours).toBeNull()
  })

  it('--id explicito nao consulta a porta de candidatos', async () => {
    const h = harness()
    const port = candidatesPort(['tt9'])

    await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false, id: 'tt3896198' },
      {
        fetchTitle: async () => payload(),
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: port,
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => 1,
      },
    )

    expect(port.calls).toHaveLength(0)
  })
})
