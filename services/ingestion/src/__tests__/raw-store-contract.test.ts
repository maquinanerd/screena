/**
 * raw-store-contract.test.ts — A MESMA suite de contrato contra TODAS as
 * implementacoes de `RawEntityStore`.
 *
 * E isto que garante que trocar `TMDB_RAW_STORE_DRIVER` de `postgres` para `r2`
 * nao muda comportamento. O adapter Prisma REAL roda a mesma suite em
 * `scripts/validate-raw-store-real-postgres.ts`; aqui roda a referencia com as
 * mesmas semanticas (unique composto, `create` recusa duplicata), mais os tres
 * caminhos de objeto.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { RawEntityKey, RawEntityRecord, RawEntityStore } from '../raw-sync/types.js'
import {
  CONTRACT_BASE_LANGUAGE,
  RAW_STORE_CONTRACT_CASES,
  runRawStoreContract,
} from '../raw-store/contract.js'
import { createLocalRawObjectStore } from '../raw-store/local-object-store.js'
import { createMemoryRawObjectStore } from '../raw-store/memory-object-store.js'
import {
  createObjectRawEntityStore,
  rawEntityObjectKey,
} from '../raw-store/object-raw-entity-store.js'
import {
  isSafeRawObjectKey,
  parseRawObjectKey,
  RawStoreKeyError,
  RawStoreUnavailableError,
  rawObjectKey,
} from '../raw-store/object-store.js'
import {
  createS3RawObjectStore,
  PAYLOAD_HASH_METADATA_KEY,
  safeS3StoreError,
  type S3ClientLike,
  type S3CommandFactories,
} from '../raw-store/s3-object-store.js'
import { withObjectStoreRetry } from '../raw-store/retrying-object-store.js'

/**
 * Referencia com as semanticas do adapter Prisma: unique
 * (entity_type, tmdb_id, base_language); `create` recusa duplicata; `update`
 * exige linha existente. Espelha `makeFakeStore` de `raw-sync-idempotency`.
 */
function createPostgresSemanticsStore(): RawEntityStore {
  const rows = new Map<string, RawEntityRecord>()
  const whereKey = (k: RawEntityKey): string => `${k.entityType}|${k.tmdbId}|${k.baseLanguage}`
  return {
    async readHash(key) {
      return rows.get(whereKey(key))?.payloadHash ?? null
    },
    async create(record) {
      const k = whereKey(record)
      if (rows.has(k)) throw new Error('unique violation: tmdb_raw')
      rows.set(k, record)
    },
    async update(key, record) {
      const k = whereKey(key)
      if (!rows.has(k)) throw new Error('record not found: tmdb_raw')
      rows.set(k, record)
    },
  }
}

/** Cliente S3 dublê em memoria, com as respostas que o SDK realmente devolve. */
function createFakeS3(): { client: S3ClientLike; commands: S3CommandFactories } {
  const objects = new Map<string, { body: string; metadata: Record<string, string> }>()

  class NotFound extends Error {
    readonly $metadata = { httpStatusCode: 404 }
    constructor() {
      super('NoSuchKey')
      this.name = 'NoSuchKey'
    }
  }

  const commands: S3CommandFactories = {
    headObject: (input) => ({ op: 'head', ...input }),
    putObject: (input) => ({ op: 'put', ...input }),
    getObject: (input) => ({ op: 'get', ...input }),
    deleteObject: (input) => ({ op: 'delete', ...input }),
  }

  const client: S3ClientLike = {
    async send(command) {
      const c = command as { op: string; Key: string; Body?: string; Metadata?: Record<string, string> }
      if (c.op === 'put') {
        objects.set(c.Key, { body: c.Body ?? '', metadata: c.Metadata ?? {} })
        return { $metadata: { httpStatusCode: 200 } }
      }
      if (c.op === 'delete') {
        objects.delete(c.Key)
        return { $metadata: { httpStatusCode: 204 } }
      }
      const found = objects.get(c.Key)
      if (found === undefined) throw new NotFound()
      if (c.op === 'head') {
        return {
          ContentLength: Buffer.byteLength(found.body, 'utf8'),
          Metadata: found.metadata,
          $metadata: { httpStatusCode: 200 },
        }
      }
      return {
        Body: { transformToString: async () => found.body },
        $metadata: { httpStatusCode: 200 },
      }
    },
  }

  return { client, commands }
}

let localRoot = ''

beforeAll(async () => {
  localRoot = await mkdtemp(path.join(tmpdir(), 'cinerie-raw-store-'))
})

afterAll(async () => {
  if (localRoot !== '') await rm(localRoot, { recursive: true, force: true })
})

describe('contrato compartilhado do RawEntityStore', () => {
  const implementations: readonly { name: string; make: () => RawEntityStore }[] = [
    { name: 'postgres (semanticas de referencia)', make: createPostgresSemanticsStore },
    {
      name: 'r2 / objeto em memoria',
      make: () =>
        createObjectRawEntityStore({
          objectStore: createMemoryRawObjectStore(),
          baseLanguage: CONTRACT_BASE_LANGUAGE,
        }),
    },
    {
      name: 'r2 / objeto local em disco',
      make: () =>
        createObjectRawEntityStore({
          objectStore: createLocalRawObjectStore({ root: path.join(localRoot, 'disk') }),
          baseLanguage: CONTRACT_BASE_LANGUAGE,
        }),
    },
    {
      name: 'r2 / adapter S3-compatible',
      make: () => {
        const fake = createFakeS3()
        return createObjectRawEntityStore({
          objectStore: createS3RawObjectStore({
            bucket: 'cinerie-tmdb-raw',
            client: fake.client,
            commands: fake.commands,
          }),
          baseLanguage: CONTRACT_BASE_LANGUAGE,
        })
      },
    },
  ]

  for (const implementation of implementations) {
    it(`${implementation.name} cumpre os ${RAW_STORE_CONTRACT_CASES.length} casos`, async () => {
      const executed = await runRawStoreContract(implementation.make())
      expect(executed).toBe(RAW_STORE_CONTRACT_CASES.length)
    })
  }

  it('a suite REALMENTE pega uma implementacao quebrada (controle positivo)', async () => {
    // Store que "esquece" o update: sem este controle, uma suite vacua passaria.
    const broken: RawEntityStore = {
      ...createPostgresSemanticsStore(),
      async update() {
        /* engole a atualizacao */
      },
    }
    await expect(runRawStoreContract(broken)).rejects.toThrow(/contrato violado/)
  })
})

describe('chave deterministica', () => {
  it('e derivavel do id e so dele', () => {
    expect(rawObjectKey('movie', 550)).toBe('tmdb/movie/550.json')
    expect(rawObjectKey('tv', 1399)).toBe('tmdb/tv/1399.json')
    expect(rawObjectKey('person', 287)).toBe('tmdb/person/287.json')
  })

  it('nao contem UUID nem timestamp (reprocess nao depende de indice)', () => {
    const key = rawObjectKey('movie', 550)
    expect(key).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
    expect(rawObjectKey('movie', 550)).toBe(key)
  })

  it('faz ida e volta', () => {
    expect(parseRawObjectKey('tmdb/movie/550.json')).toEqual({ kind: 'movie', tmdbId: 550 })
    expect(parseRawObjectKey('tmdb/season/1.json')).toBeNull()
    expect(parseRawObjectKey('outro/movie/550.json')).toBeNull()
  })

  it('recusa id invalido em vez de gerar chave torta', () => {
    expect(() => rawObjectKey('movie', 0)).toThrow(RawStoreKeyError)
    expect(() => rawObjectKey('movie', -1)).toThrow(RawStoreKeyError)
    expect(() => rawObjectKey('movie', 1.5)).toThrow(RawStoreKeyError)
  })

  it('valida chave contra travessia de caminho', () => {
    expect(isSafeRawObjectKey('tmdb/movie/550.json')).toBe(true)
    for (const bad of ['', '/tmdb/x.json', 'tmdb\\movie\\1.json', 'tmdb/../etc/passwd', 'tmdb//1.json', 'TMDB/Movie/1.json']) {
      expect(isSafeRawObjectKey(bad)).toBe(false)
    }
  })

  it('RECUSA um segundo idioma em vez de sobrescrever em silencio', () => {
    const base = { entityType: 'movie' as const, tmdbId: 550 }
    expect(rawEntityObjectKey({ ...base, baseLanguage: 'pt-BR' }, 'pt-BR')).toBe('tmdb/movie/550.json')
    // Este e o ponto: `en` e `pt-BR` mapeariam para a MESMA chave. Em vez de
    // corromper o arquivo, o store para e pede uma decisao.
    expect(() => rawEntityObjectKey({ ...base, baseLanguage: 'en' }, 'pt-BR')).toThrow(RawStoreKeyError)
  })
})

describe('indisponibilidade do store', () => {
  it('erro de transporte NUNCA vira "objeto ausente"', async () => {
    const objectStore = createMemoryRawObjectStore()
    const store = createObjectRawEntityStore({ objectStore, baseLanguage: CONTRACT_BASE_LANGUAGE })
    objectStore.failNext('head')
    await expect(store.readHash({ entityType: 'movie', tmdbId: 1, baseLanguage: 'pt-BR' })).rejects.toThrow(
      RawStoreUnavailableError,
    )
  })

  it('falha no MEIO do lote nao deixa estado parcial: o que passou esta integro', async () => {
    const objectStore = createMemoryRawObjectStore()
    const store = createObjectRawEntityStore({ objectStore, baseLanguage: CONTRACT_BASE_LANGUAGE })

    const write = async (tmdbId: number): Promise<void> => {
      const k: RawEntityKey = { entityType: 'movie', tmdbId, baseLanguage: 'pt-BR' }
      await store.create({
        ...k,
        payload: { id: tmdbId },
        payloadHash: `hash-${tmdbId}`,
        etag: null,
        lastModified: null,
        fetchedAt: new Date('2026-08-11T00:00:00.000Z'),
      })
    }

    await write(1)
    await write(2)
    objectStore.failNext('put')
    await expect(write(3)).rejects.toThrow(RawStoreUnavailableError)
    await write(4)

    // 1, 2 e 4 gravados e integros; 3 simplesmente NAO existe — nunca meio
    // gravado. O lote e retomavel porque a chave e a identidade.
    expect(objectStore.keys()).toEqual([
      'tmdb/movie/1.json',
      'tmdb/movie/2.json',
      'tmdb/movie/4.json',
    ])
    expect(await store.readHash({ entityType: 'movie', tmdbId: 3, baseLanguage: 'pt-BR' })).toBeNull()
    expect(await store.readHash({ entityType: 'movie', tmdbId: 4, baseLanguage: 'pt-BR' })).toBe('hash-4')
  })
})

describe('retry com backoff exponencial', () => {
  it('retenta indisponibilidade e sucede na tentativa seguinte', async () => {
    const objectStore = createMemoryRawObjectStore()
    const sleep = vi.fn(async () => undefined)
    const retrying = withObjectStoreRetry(objectStore, {
      maxAttempts: 3,
      sleep,
      random: () => 0,
    })
    objectStore.failNext('put', 2)
    const head = await retrying.put({ key: 'tmdb/movie/1.json', body: '{}', payloadHash: 'h' })
    expect(head.payloadHash).toBe('h')
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('o atraso CRESCE exponencialmente', async () => {
    const objectStore = createMemoryRawObjectStore()
    const delays: number[] = []
    const retrying = withObjectStoreRetry(objectStore, {
      maxAttempts: 4,
      sleep: async (ms) => {
        delays.push(ms)
      },
      baseMs: 100,
      factor: 2,
      jitterMs: 0,
      random: () => 0,
    })
    objectStore.failNext('put', 3)
    await retrying.put({ key: 'tmdb/movie/1.json', body: '{}', payloadHash: 'h' })
    expect(delays).toEqual([100, 200, 400])
  })

  it('respeita o teto do backoff', async () => {
    const objectStore = createMemoryRawObjectStore()
    const delays: number[] = []
    const retrying = withObjectStoreRetry(objectStore, {
      maxAttempts: 6,
      sleep: async (ms) => {
        delays.push(ms)
      },
      baseMs: 1_000,
      maxMs: 3_000,
      factor: 2,
      jitterMs: 0,
      random: () => 0,
    })
    objectStore.failNext('put', 5)
    await retrying.put({ key: 'tmdb/movie/1.json', body: '{}', payloadHash: 'h' })
    expect(Math.max(...delays)).toBe(3_000)
  })

  it('RELANCA quando esgota: o lote nunca acha que gravou', async () => {
    const objectStore = createMemoryRawObjectStore()
    const retrying = withObjectStoreRetry(objectStore, {
      maxAttempts: 2,
      sleep: async () => undefined,
      random: () => 0,
    })
    objectStore.failNext('put', 5)
    await expect(
      retrying.put({ key: 'tmdb/movie/1.json', body: '{}', payloadHash: 'h' }),
    ).rejects.toThrow(RawStoreUnavailableError)
    expect(objectStore.keys()).toEqual([])
  })

  it('NAO retenta erro permanente (chave invalida)', async () => {
    const objectStore = createMemoryRawObjectStore()
    const sleep = vi.fn(async () => undefined)
    const retrying = withObjectStoreRetry(objectStore, { maxAttempts: 5, sleep, random: () => 0 })
    await expect(
      retrying.put({ key: '../fuga.json', body: '{}', payloadHash: 'h' }),
    ).rejects.toThrow(RawStoreKeyError)
    expect(sleep).not.toHaveBeenCalled()
  })
})

describe('adapter S3-compatible', () => {
  it('grava o hash no METADADO e o le sem baixar o corpo', async () => {
    const fake = createFakeS3()
    const sent: unknown[] = []
    const spying: S3ClientLike = {
      send: async (command) => {
        sent.push(command)
        return fake.client.send(command)
      },
    }
    const store = createS3RawObjectStore({
      bucket: 'cinerie-tmdb-raw',
      client: spying,
      commands: fake.commands,
    })
    await store.put({ key: 'tmdb/movie/550.json', body: '{"id":550}', payloadHash: 'abc123' })
    const head = await store.head('tmdb/movie/550.json')

    expect(head).toEqual({ payloadHash: 'abc123', byteSize: 10 })
    const put = sent[0] as { Metadata: Record<string, string>; ContentType: string }
    expect(put.Metadata[PAYLOAD_HASH_METADATA_KEY]).toBe('abc123')
    expect(put.ContentType).toBe('application/json')
    // A leitura de metadado foi um HEAD, nunca um GET do corpo.
    expect((sent[1] as { op: string }).op).toBe('head')
  })

  it('objeto sem hash no metadado e tratado como AUSENTE, nunca como hash vazio', async () => {
    const fake = createFakeS3()
    // Grava direto pelo dublê, sem passar pelo adapter: simula objeto legado.
    await fake.client.send(fake.commands.putObject({
      Bucket: 'b',
      Key: 'tmdb/movie/1.json',
      Body: '{}',
      ContentType: 'application/json',
      ContentLength: 2,
      Metadata: {},
    }))
    const store = createS3RawObjectStore({ bucket: 'b', client: fake.client, commands: fake.commands })
    expect(await store.head('tmdb/movie/1.json')).toBeNull()
  })

  it('404 e ausencia; qualquer outro erro e INDISPONIBILIDADE', async () => {
    const failing: S3ClientLike = {
      send: async () => {
        const error = new Error('connect ETIMEDOUT 10.0.0.1:443') as Error & { $metadata?: unknown }
        error.name = 'TimeoutError'
        error.$metadata = { httpStatusCode: 500, requestId: 'req-secreto' }
        throw error
      },
    }
    const fake = createFakeS3()
    const store = createS3RawObjectStore({ bucket: 'b', client: failing, commands: fake.commands })
    await expect(store.head('tmdb/movie/1.json')).rejects.toThrow(RawStoreUnavailableError)
  })

  it('o erro sanitizado NAO vaza bucket, chave, host nem requestId', () => {
    const raw = Object.assign(new Error('no bucket cinerie-tmdb-raw, host r2.example, key tmdb/movie/1.json'), {
      name: 'AccessDenied',
      $metadata: { requestId: 'req-secreto' },
    })
    const safe = safeS3StoreError('put', raw)
    expect(safe.message).toBe('falha em put no object store (AccessDenied)')
    expect(safe.message).not.toContain('cinerie-tmdb-raw')
    expect(safe.message).not.toContain('req-secreto')
    expect(safe.message).not.toContain('r2.example')
    expect(safe.operation).toBe('put')
  })
})

describe('contabilidade de bytes (insumo do teto de custo)', () => {
  it('reporta bytes por escrita e distingue create de update', async () => {
    const objectStore = createMemoryRawObjectStore()
    const observed: { key: string; byteSize: number; outcome: string }[] = []
    const store = createObjectRawEntityStore({
      objectStore,
      baseLanguage: CONTRACT_BASE_LANGUAGE,
      onWrite: (o) => observed.push(o),
    })
    const k: RawEntityKey = { entityType: 'movie', tmdbId: 550, baseLanguage: 'pt-BR' }
    const make = (payload: unknown, hash: string): RawEntityRecord => ({
      ...k,
      payload,
      payloadHash: hash,
      etag: null,
      lastModified: null,
      fetchedAt: new Date('2026-08-11T00:00:00.000Z'),
    })

    await store.create(make({ id: 550 }, 'h1'))
    await store.update(k, make({ id: 550, extra: 'mais bytes' }, 'h2'))

    expect(observed.map((o) => o.outcome)).toEqual(['create', 'update'])
    expect(observed[1]!.byteSize).toBeGreaterThan(observed[0]!.byteSize)
    expect(objectStore.totalBytes()).toBe(observed[1]!.byteSize)
  })
})
