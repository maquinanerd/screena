/**
 * cache.ts — Adapter de `api_cache` (Prisma). EXCLUIDO do typecheck.
 *
 * Grava o payload BRUTO por (provider_api, request_key, params_hash).
 * O render NUNCA le daqui.
 */

import type { PrismaClient } from '@screena/db/server'
import type { CachePort, CacheWriteInput } from '../ports.js'

/** Cria um `CachePort` apoiado em `api_cache` via Prisma. */
export function createPrismaCache(prisma: PrismaClient, providerApi: string): CachePort {
  return {
    async write(input: CacheWriteInput): Promise<void> {
      const where = {
        providerApi_requestKey_paramsHash: {
          providerApi,
          requestKey: input.requestKey,
          paramsHash: input.paramsHash,
        },
      }
      const payload = input.payload as object

      await prisma.apiCache.upsert({
        where,
        create: {
          providerApi,
          endpoint: input.endpoint,
          requestKey: input.requestKey,
          paramsHash: input.paramsHash,
          payload,
          payloadHash: input.payloadHash,
          fetchedAt: input.fetchedAt,
          expiresAt: input.expiresAt,
        },
        update: {
          endpoint: input.endpoint,
          payload,
          payloadHash: input.payloadHash,
          fetchedAt: input.fetchedAt,
          expiresAt: input.expiresAt,
        },
      })
    },
  }
}
