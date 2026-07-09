/**
 * tmdb-raw-store.ts — Adapter de `tmdb_raw` (Prisma). EXCLUIDO do typecheck.
 *
 * Implementa a porta PURA `RawEntityStore` (do core `raw-sync`) sobre o Prisma
 * Client server-only. Idempotencia por hash:
 *  - `readHash`  -> hash atual (ou null) por chave natural, sem tocar mais nada;
 *  - `create`    -> insere o registro novo;
 *  - `update`    -> atualiza payload/hash/fetchedAt (o `@updatedAt` bumpa; correto
 *                   porque o payload REALMENTE mudou).
 *
 * Skip (hash igual) e decidido no core e NAO chama este adapter — logo nao ha
 * escrita nem bump de `updatedAt` quando nada mudou. O render NUNCA le esta
 * tabela (guarda `tmdb-raw-not-in-render` varre apps/web).
 */

import type { PrismaClient } from '@screena/db/server'
import type { RawEntityKey, RawEntityRecord, RawEntityStore } from '../raw-sync/types.js'

/** Chave composta do unique `@@unique([entityType, tmdbId, baseLanguage])`. */
function whereKey(key: RawEntityKey) {
  return {
    entityType_tmdbId_baseLanguage: {
      entityType: key.entityType,
      tmdbId: key.tmdbId,
      baseLanguage: key.baseLanguage,
    },
  }
}

/** Cria um `RawEntityStore` apoiado em `tmdb_raw` via Prisma. */
export function createPrismaTmdbRawStore(prisma: PrismaClient): RawEntityStore {
  return {
    async readHash(key: RawEntityKey): Promise<string | null> {
      const row = await prisma.tmdbRaw.findUnique({
        where: whereKey(key),
        select: { payloadHash: true },
      })
      return row?.payloadHash ?? null
    },

    async create(record: RawEntityRecord): Promise<void> {
      await prisma.tmdbRaw.create({
        data: {
          entityType: record.entityType,
          tmdbId: record.tmdbId,
          baseLanguage: record.baseLanguage,
          payload: record.payload as object,
          payloadHash: record.payloadHash,
          etag: record.etag,
          lastModified: record.lastModified,
          fetchedAt: record.fetchedAt,
        },
      })
    },

    async update(key: RawEntityKey, record: RawEntityRecord): Promise<void> {
      await prisma.tmdbRaw.update({
        where: whereKey(key),
        data: {
          payload: record.payload as object,
          payloadHash: record.payloadHash,
          etag: record.etag,
          lastModified: record.lastModified,
          fetchedAt: record.fetchedAt,
        },
      })
    },
  }
}
