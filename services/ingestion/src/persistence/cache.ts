/**
 * cache.ts — Adapter de `api_cache` (Prisma). COBERTO por `tsconfig.runtime.json`
 * (`pnpm typecheck` encadeia os dois).
 *
 * `getOrFetch`: dentro do TTL devolve o bruto do cache (sem ir a rede); fora do
 * TTL busca via `fetcher`, grava o bruto e compara o `payload_hash` com o
 * anterior (`changed`). O render NUNCA le daqui — quem le e o worker.
 */

import { TMDB_PROVIDER_API } from '@screena/tmdb-client'
import type { PrismaClient } from '@screena/db/server'
import type { CacheFetchInput, CachePort, CacheResult } from '../ports.js'
import { buildCacheKey } from '../utils/cache-key.js'
import { hashPayload } from '../utils/hash.js'

/** Opcoes do adapter de cache. */
export interface CacheAdapterOptions {
  readonly ttlMs: number
  readonly now: () => Date
  readonly providerApi?: string
}

/** Cria um `CachePort` apoiado em `api_cache` via Prisma. */
export function createPrismaCache(prisma: PrismaClient, options: CacheAdapterOptions): CachePort {
  const providerApi = options.providerApi ?? TMDB_PROVIDER_API

  return {
    async getOrFetch<T>(input: CacheFetchInput<T>): Promise<CacheResult<T>> {
      const { requestKey, paramsHash } = buildCacheKey(input.endpoint, input.params)
      const where = {
        providerApi_requestKey_paramsHash: { providerApi, requestKey, paramsHash },
      }

      const existing = await prisma.apiCache.findUnique({ where })
      const nowDate = options.now()
      const nowMs = nowDate.getTime()

      if (existing && (existing.expiresAt === null || existing.expiresAt.getTime() > nowMs)) {
        return {
          data: existing.payload as T,
          fromCache: true,
          payloadHash: existing.payloadHash,
          changed: false,
        }
      }

      const data = await input.fetcher()
      const payloadHash = hashPayload(data)
      const changed = existing === null || existing.payloadHash !== payloadHash
      const expiresAt = new Date(nowMs + options.ttlMs)
      const payload = data as object

      await prisma.apiCache.upsert({
        where,
        create: {
          providerApi,
          endpoint: input.endpoint,
          requestKey,
          paramsHash,
          payload,
          payloadHash,
          fetchedAt: nowDate,
          expiresAt,
        },
        update: { endpoint: input.endpoint, payload, payloadHash, fetchedAt: nowDate, expiresAt },
      })

      return { data, fromCache: false, payloadHash, changed }
    },
  }
}
