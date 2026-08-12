/**
 * contract.ts — A SUITE DE CONTRATO compartilhada do `RawEntityStore`.
 *
 * Este e o arquivo que garante que trocar `TMDB_RAW_STORE_DRIVER` nao muda
 * comportamento. A mesma suite roda contra TODAS as implementacoes:
 *  - o adapter Prisma real (via `scripts/validate-raw-store-real-postgres.ts`,
 *    contra um PostgreSQL 16 de verdade, com as migrations reais);
 *  - o store de objetos em memoria;
 *  - o store de objetos local em disco;
 *  - o adapter S3-compatible sobre um cliente dublê.
 *
 * Exportada como FUNCAO (nao como `describe`) exatamente para isso: um teste
 * Vitest a chama, e um validador de PostgreSQL real tambem. Duas suites
 * parecidas divergiriam no primeiro dia.
 *
 * Cada caso devolve `{ name, run }` e LANCA na primeira divergencia, com uma
 * mensagem que diz o que era esperado. Sem dependencia de framework de teste.
 */

import type { RawEntityKey, RawEntityRecord, RawEntityStore } from '../raw-sync/types.js'

/** Uma verificacao do contrato. */
export interface RawStoreContractCase {
  readonly name: string
  run(store: RawEntityStore): Promise<void>
}

/** Erro de contrato: o store violou uma garantia que a ingestao assume. */
export class RawStoreContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RawStoreContractError'
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new RawStoreContractError(message)
}

/** Lingua base usada pela suite; precisa bater com a do store sob teste. */
export const CONTRACT_BASE_LANGUAGE = 'pt-BR'

function key(tmdbId: number, entityType: RawEntityKey['entityType'] = 'movie'): RawEntityKey {
  return { entityType, tmdbId, baseLanguage: CONTRACT_BASE_LANGUAGE }
}

function record(k: RawEntityKey, payload: unknown, hash: string): RawEntityRecord {
  return {
    ...k,
    payload,
    payloadHash: hash,
    etag: null,
    lastModified: null,
    fetchedAt: new Date('2026-08-11T00:00:00.000Z'),
  }
}

/**
 * Os casos do contrato.
 *
 * Cada `tmdbId` e distinto por caso: a suite roda contra stores persistentes
 * (Postgres, disco) que nao sao zerados entre casos.
 */
export const RAW_STORE_CONTRACT_CASES: readonly RawStoreContractCase[] = [
  {
    name: 'readHash devolve null para entidade nunca gravada',
    async run(store) {
      const hash = await store.readHash(key(900_001))
      assert(hash === null, `esperava null para chave ausente, veio ${JSON.stringify(hash)}`)
    },
  },
  {
    name: 'create grava e readHash devolve exatamente o hash gravado',
    async run(store) {
      const k = key(900_002)
      await store.create(record(k, { id: 900_002, title: 'A' }, 'hash-a'))
      const hash = await store.readHash(k)
      assert(hash === 'hash-a', `esperava "hash-a", veio ${JSON.stringify(hash)}`)
    },
  },
  {
    name: 'update sobrescreve o hash da MESMA chave',
    async run(store) {
      const k = key(900_003)
      await store.create(record(k, { id: 900_003, v: 1 }, 'hash-v1'))
      await store.update(k, record(k, { id: 900_003, v: 2 }, 'hash-v2'))
      const hash = await store.readHash(k)
      assert(hash === 'hash-v2', `esperava "hash-v2", veio ${JSON.stringify(hash)}`)
    },
  },
  {
    name: 'reescrever a mesma entidade SOBRESCREVE, nunca duplica (idempotencia)',
    async run(store) {
      const k = key(900_004)
      await store.create(record(k, { id: 900_004, v: 1 }, 'hash-1'))
      // Tres updates seguidos com o mesmo conteudo: estado final identico.
      for (let i = 0; i < 3; i += 1) {
        await store.update(k, record(k, { id: 900_004, v: 9 }, 'hash-9'))
      }
      const hash = await store.readHash(k)
      assert(hash === 'hash-9', `esperava "hash-9" apos reescritas, veio ${JSON.stringify(hash)}`)
    },
  },
  {
    name: 'entidades de tipos diferentes com o MESMO id nao colidem',
    async run(store) {
      const movie = key(900_005, 'movie')
      const tv = key(900_005, 'tv')
      await store.create(record(movie, { kind: 'movie' }, 'hash-movie'))
      await store.create(record(tv, { kind: 'tv' }, 'hash-tv'))
      const movieHash = await store.readHash(movie)
      const tvHash = await store.readHash(tv)
      assert(movieHash === 'hash-movie', `movie: esperava "hash-movie", veio ${String(movieHash)}`)
      assert(tvHash === 'hash-tv', `tv: esperava "hash-tv", veio ${String(tvHash)}`)
    },
  },
  {
    name: 'ids distintos do mesmo tipo sao independentes',
    async run(store) {
      const a = key(900_006)
      const b = key(900_007)
      await store.create(record(a, { id: 900_006 }, 'hash-a'))
      await store.create(record(b, { id: 900_007 }, 'hash-b'))
      assert((await store.readHash(a)) === 'hash-a', 'hash de 900006 mudou')
      assert((await store.readHash(b)) === 'hash-b', 'hash de 900007 mudou')
    },
  },
  {
    name: 'payload grande e aninhado sobrevive a ida e volta do hash',
    async run(store) {
      const k = key(900_008)
      const payload = {
        id: 900_008,
        credits: { cast: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `Pessoa ${i}` })) },
        'watch/providers': { results: { BR: { flatrate: [{ provider_id: 8 }] } } },
      }
      await store.create(record(k, payload, 'hash-grande'))
      assert((await store.readHash(k)) === 'hash-grande', 'hash de payload grande divergiu')
    },
  },
  {
    name: 'readHash nao inventa hash para vizinho de chave parecida',
    async run(store) {
      const k = key(900_009)
      await store.create(record(k, { id: 900_009 }, 'hash-9'))
      // 9000090 tem o prefixo de 900009: um store que casasse por prefixo erraria.
      const neighbour = await store.readHash(key(9_000_090))
      assert(neighbour === null, `esperava null para vizinho, veio ${JSON.stringify(neighbour)}`)
    },
  },
]

/** Roda toda a suite contra um store. Lanca no primeiro caso que falhar. */
export async function runRawStoreContract(
  store: RawEntityStore,
  onCase?: (name: string) => void,
): Promise<number> {
  for (const contractCase of RAW_STORE_CONTRACT_CASES) {
    onCase?.(contractCase.name)
    try {
      await contractCase.run(store)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new RawStoreContractError(`contrato violado em "${contractCase.name}": ${detail}`)
    }
  }
  return RAW_STORE_CONTRACT_CASES.length
}
