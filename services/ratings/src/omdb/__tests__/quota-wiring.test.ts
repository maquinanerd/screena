/**
 * quota-wiring.test.ts — A COTA, LIGADA. Os dois sentidos, como o dono pediu.
 *
 * ============================================================================
 * O DEFEITO QUE ESTES TESTES TRAVAM
 * ============================================================================
 * `checkOmdbBudget` existia em `@screena/config`, tinha nove testes proprios e
 * **nenhum chamador em codigo de producao**. A politica estava escrita e o
 * worker de ratings nunca a consultou: a fila de fundo gastava as 1.000
 * requisicoes do dia sem pedir licenca, e quem ficava sem resposta era o LEITOR.
 *
 * Testar a politica isolada NAO pegava isso — os nove testes continuavam verdes
 * com o porto desconectado. O que pega e um teste que exercita
 * `runOmdbRatingsSync` de ponta a ponta e olha o EFEITO: com a cota estourada,
 * quantas requisicoes sairam.
 *
 * ============================================================================
 * OS DOIS SENTIDOS
 * ============================================================================
 *  (1) cota estourada -> NENHUMA requisicao sai, os ids VOLTAM para a fila
 *      (nenhuma linha escrita = continuam stale) e o motivo aparece.
 *  (2) cota folgada    -> tudo passa. Sem este, um gate que barrasse SEMPRE
 *      passaria no teste (1) e ninguem notaria.
 */

import { OMDB_PROVIDER_API } from '@screena/omdb-client'
import { OMDB_DAILY_LIMIT, ON_DEMAND_RESERVE } from '@screena/config'
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
import { runOmdbRatingsSync } from '../run.js'
import { assertFixtureIntact, OMDB_GUARDIANS_PAYLOAD } from './fixture.js'

const NOW = new Date('2026-08-21T12:00:00.000Z')

function harness() {
  const cacheWrites: CacheWriteInput[] = []
  const syncLogs: SyncLogInput[] = []
  const upserts: ExternalRatingRow[] = []
  const cache: CachePort = {
    async write(input) {
      cacheWrites.push(input)
    },
  }
  const syncLog: SyncLogPort = {
    async write(input) {
      syncLogs.push(input)
    },
  }
  const ratings: ExternalRatingsPort = {
    async upsert(row) {
      upserts.push(row)
      return { created: true, changed: true }
    },
  }
  const entities: EntityLookupPort = {
    async findByImdbId(entityType, imdbId) {
      return { entityType, entityId: `local-${imdbId}` }
    },
    async findByTmdbId() {
      return null
    },
  }
  return { cacheWrites, syncLogs, upserts, cache, syncLog, ratings, entities }
}

function candidatesPort(count: number): StaleEntityCandidateSelectPort {
  return {
    async selectStaleByType(input) {
      return {
        candidates: Array.from({ length: count }, (_, index) => ({
          entityType: input.entityType,
          entityId: `local-${index}`,
          imdbId: `tt000000${index}`,
          tmdbId: null,
        })),
        skippedFresh: 0,
      }
    },
  }
}

function payload(): unknown {
  assertFixtureIntact(OMDB_GUARDIANS_PAYLOAD)
  return structuredClone(OMDB_GUARDIANS_PAYLOAD)
}

const BASE = {
  apply: true,
  sample: false,
  entityType: 'movie' as const,
  id: null,
  limit: 5,
  providerApi: OMDB_PROVIDER_API,
  cacheTtlMs: 1000,
  ignoreFreshness: false,
}

async function run(spentToday: number, count = 5, consumer: 'seed' | 'on_demand' = 'seed') {
  const h = harness()
  let fetched = 0
  const result = await runOmdbRatingsSync(
    { ...BASE, consumer },
    {
      fetchTitle: async () => {
        fetched += 1
        return payload()
      },
      cache: h.cache,
      syncLog: h.syncLog,
      entities: h.entities,
      candidates: candidatesPort(count),
      ratings: h.ratings,
      now: () => NOW,
      requestCount: () => fetched,
      budget: { spentToday: async () => spentToday },
    },
  )
  return { result, fetched, ...h }
}

describe('(1) cota estourada: o titulo VOLTA para a fila e o motivo e logado', () => {
  it('nenhuma requisicao sai quando o teto do dia acabou', async () => {
    const { result, fetched } = await run(OMDB_DAILY_LIMIT)
    expect(fetched).toBe(0)
    expect(result.idsQueried).toBe(0)
    expect(result.idsDeniedByQuota).toBe(5)
  })

  it('NENHUMA nota e escrita — o id continua stale e volta como candidato', async () => {
    const { upserts } = await run(OMDB_DAILY_LIMIT)
    // Este e o coracao da regra: cota estourada NAO pode gravar "sem nota" num
    // titulo que tem nota. Zero escrita = o candidato continua stale.
    expect(upserts).toEqual([])
  })

  it('o motivo aparece, nomeado, com a contagem de devolvidos', async () => {
    const { result } = await run(OMDB_DAILY_LIMIT)
    const denied = result.rejections.filter((r) => r.reason === 'quota-denied')
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toContain('5 id(s) devolvido(s) a fila')
    expect(denied[0]!.detail).toContain('requeue=true')
  })

  it('o ciclo e `aborted`, nunca `empty` — havia trabalho e a cota acabou', async () => {
    const { result, syncLogs } = await run(OMDB_DAILY_LIMIT)
    expect(result.status).toBe('aborted')
    // E o log sai, com o mesmo status: nenhuma ingestao silenciosa.
    expect(syncLogs).toHaveLength(1)
    expect(syncLogs[0]!.status).toBe('aborted')
  })

  it('a fila de FUNDO cede a vez ja dentro da reserva do leitor', async () => {
    // Saldo positivo, mas inteiramente dentro da reserva: a semente para.
    const spent = OMDB_DAILY_LIMIT - Math.floor(ON_DEMAND_RESERVE / 2)
    const { fetched, result } = await run(spent, 5, 'seed')
    expect(fetched).toBe(0)
    expect(result.idsDeniedByQuota).toBe(5)
  })

  it('o LEITOR passa no mesmo saldo em que a fila de fundo e barrada', async () => {
    const spent = OMDB_DAILY_LIMIT - Math.floor(ON_DEMAND_RESERVE / 2)
    const { fetched } = await run(spent, 5, 'on_demand')
    expect(fetched).toBe(5)
  })

  it('para NO limite: o lote consome ate o teto e devolve o resto', async () => {
    // Restam 2 requisicoes acima da reserva; 5 candidatos.
    const spent = OMDB_DAILY_LIMIT - ON_DEMAND_RESERVE - 2
    const { fetched, result } = await run(spent, 5, 'seed')
    expect(fetched).toBe(2)
    expect(result.idsDeniedByQuota).toBe(3)
    expect(result.idsQueried).toBe(2)
  })
})

describe('(2) cota folgada: tudo passa — o controle que separa gate de recusa cega', () => {
  it('com saldo cheio, as cinco consultas saem e as notas sao escritas', async () => {
    const { fetched, result, upserts } = await run(0, 5)
    expect(fetched).toBe(5)
    expect(result.idsDeniedByQuota).toBe(0)
    expect(result.rejections.some((r) => r.reason === 'quota-denied')).toBe(false)
    expect(upserts.length).toBeGreaterThan(0)
  })

  it('CONTROLE NEGATIVO: sem o porto de cota, o gate nao roda — e e assim que o defeito era', async () => {
    // Reproduz o estado ANTERIOR (porto ausente) com a cota estourada. As cinco
    // requisicoes saem. Este teste passa DE PROPOSITO: ele documenta que a
    // ausencia do porto e o que desliga a politica, e por isso a producao
    // (bin/sync-omdb-ratings.ts) injeta o porto sempre que nao ha `--id`.
    const h = harness()
    let fetched = 0
    const result = await runOmdbRatingsSync(
      { ...BASE, consumer: 'seed' },
      {
        fetchTitle: async () => {
          fetched += 1
          return payload()
        },
        cache: h.cache,
        syncLog: h.syncLog,
        entities: h.entities,
        candidates: candidatesPort(5),
        ratings: h.ratings,
        now: () => NOW,
        requestCount: () => fetched,
        // budget ausente — exatamente como era antes de 2026-08-21.
      },
    )
    expect(fetched).toBe(5)
    expect(result.idsDeniedByQuota).toBe(0)
  })
})
