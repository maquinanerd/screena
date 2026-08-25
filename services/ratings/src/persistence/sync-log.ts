/**
 * sync-log.ts — Adapter de `api_sync_logs` (Prisma). COBERTO pelo typecheck da raiz E
 * por `tsconfig.runtime.json`.
 *
 * Grava 1 linha por ciclo de sync (sucesso/vazio/parcial/falha/abortado).
 * Todo sync externo gera log — sem excecao (regra de ingestao).
 */

import type { PrismaClient } from '@screena/db/server'
import type { SyncLogInput, SyncLogPort } from '../ports.js'

/** Cria um `SyncLogPort` que grava em `api_sync_logs` via Prisma. */
export function createPrismaSyncLog(prisma: PrismaClient, providerApi: string): SyncLogPort {
  return {
    async write(input: SyncLogInput): Promise<void> {
      await prisma.apiSyncLog.create({
        data: {
          providerApi,
          endpoint: input.endpoint,
          status: input.status,
          errorCode: input.errorCode ?? null,
          itemsProcessed: input.itemsProcessed ?? 0,
          itemsCreated: input.itemsCreated ?? 0,
          itemsUpdated: input.itemsUpdated ?? 0,
          durationMs: input.durationMs ?? null,
          quotaCost: input.quotaCost ?? null,
          payloadHash: input.payloadHash ?? null,
        },
      })
    },
  }
}
