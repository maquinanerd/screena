/**
 * A composicao do RawEntityStore: do config resolvido ao adapter certo.
 *
 * A prova que faltava para a troca do `bin/sync-tmdb-raw.ts`: com driver
 * `postgres` a composicao usa o adapter Prisma; com `r2` usa o store de
 * objetos S3-compatible (com retry) — e, junto de `raw-store-config.test.ts`
 * (postgres RECUSADO em producao; omissao RECUSADA em producao), fecha a
 * garantia de que EM PRODUCAO o payload bruto so pode ir para o r2.
 */

import { describe, expect, it } from 'vitest'

import { composeRawEntityStore } from '../raw-store/compose.js'
import { resolveRawStoreConfig } from '../raw-store/config.js'
import type { R2RawStoreConfig } from '../raw-store/config.js'
import type { RawEntityStore } from '../raw-sync/types.js'

const R2_CONFIG: R2RawStoreConfig = {
  driver: 'r2',
  baseLanguage: 'pt-BR',
  endpoint: 'https://exemplo.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'cinerie-tmdb-raw',
  accessKeyId: 'chave-de-teste',
  secretAccessKey: 'segredo-de-teste',
  forcePathStyle: true,
}

function fakeDeps() {
  const calls = { prisma: 0, s3: 0, sends: [] as string[] }
  const prismaStore: RawEntityStore = {
    readHash: async () => null,
    create: async () => undefined,
    update: async () => undefined,
  }
  const deps = {
    createPrismaStore: () => {
      calls.prisma += 1
      return prismaStore
    },
    createS3Client: (config: R2RawStoreConfig) => {
      calls.s3 += 1
      expect(config.bucket).toBe(R2_CONFIG.bucket)
      return {
        client: {
          send: async (command: unknown) => {
            const kind = (command as { kind?: string }).kind ?? 'desconhecido'
            calls.sends.push(kind)
            if (kind === 'head') {
              // "objeto ausente" na forma que o adapter entende (404).
              const error = new Error('NotFound') as Error & { name: string }
              error.name = 'NotFound'
              throw error
            }
            return { $metadata: { httpStatusCode: 200 }, ContentLength: 3 }
          },
        },
        commands: {
          headObject: (input: unknown) => ({ kind: 'head', input }),
          putObject: (input: unknown) => ({ kind: 'put', input }),
          getObject: (input: unknown) => ({ kind: 'get', input }),
          deleteObject: (input: unknown) => ({ kind: 'delete', input }),
        },
      }
    },
    sleep: async () => undefined,
  }
  return { deps, calls, prismaStore }
}

describe('composeRawEntityStore', () => {
  it('driver postgres usa o adapter Prisma e NUNCA constroi cliente S3', () => {
    const { deps, calls, prismaStore } = fakeDeps()
    const composed = composeRawEntityStore({ driver: 'postgres', baseLanguage: 'pt-BR' }, deps)
    expect(calls.prisma).toBe(1)
    expect(calls.s3).toBe(0)
    expect(composed.store).toBe(prismaStore)
    expect(composed.description).toContain('postgres')
    expect(composed.description).toContain('recusado em producao')
  })

  it('driver r2 compoe o store de objetos e as leituras vao para o S3', async () => {
    const { deps, calls } = fakeDeps()
    const composed = composeRawEntityStore(R2_CONFIG, deps)
    expect(calls.s3).toBe(1)
    expect(calls.prisma).toBe(0)

    const hash = await composed.store.readHash({
      entityType: 'movie',
      tmdbId: 42,
      baseLanguage: 'pt-BR',
    })
    expect(hash).toBeNull()
    expect(calls.sends).toContain('head')
  })

  it('a descricao do r2 diz o bucket e NUNCA credencial/endpoint', () => {
    const { deps } = fakeDeps()
    const composed = composeRawEntityStore(R2_CONFIG, deps)
    expect(composed.description).toContain('cinerie-tmdb-raw')
    expect(composed.description).not.toContain('chave-de-teste')
    expect(composed.description).not.toContain('segredo-de-teste')
    expect(composed.description).not.toContain('cloudflarestorage')
  })
})

describe('EM PRODUCAO, r2 e o unico caminho (config + composicao juntos)', () => {
  const PROD_R2_ENV = {
    NODE_ENV: 'production',
    TMDB_RAW_STORE_DRIVER: 'r2',
    TMDB_RAW_R2_ENDPOINT: R2_CONFIG.endpoint,
    TMDB_RAW_R2_BUCKET: R2_CONFIG.bucket,
    TMDB_RAW_R2_ACCESS_KEY_ID: R2_CONFIG.accessKeyId,
    TMDB_RAW_R2_SECRET_ACCESS_KEY: R2_CONFIG.secretAccessKey,
  }

  it('producao + r2 completo resolve e compoe o store de objetos', () => {
    const resolved = resolveRawStoreConfig(PROD_R2_ENV)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error('inesperado')
    const { deps, calls } = fakeDeps()
    const composed = composeRawEntityStore(resolved.config, deps)
    expect(calls.s3).toBe(1)
    expect(composed.description).toContain('driver=r2')
  })

  it('producao + postgres e RECUSADO na config (a composicao nem e alcancada)', () => {
    const resolved = resolveRawStoreConfig({
      NODE_ENV: 'production',
      TMDB_RAW_STORE_DRIVER: 'postgres',
    })
    expect(resolved.ok).toBe(false)
    if (resolved.ok) throw new Error('inesperado')
    expect(resolved.errors.join(' ')).toContain('recusado em producao')
  })
})
