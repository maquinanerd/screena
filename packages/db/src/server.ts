/**
 * server.ts — Acessor do Prisma Client (SERVER-ONLY).
 *
 * EXCLUIDO do typecheck do repo (depende do Prisma Client gerado em
 * node_modules/@prisma/client). Importado APENAS por workers/CLIs offline
 * (services/*, bin/*). NUNCA pode ser importado pelo render publico (apps/web):
 * o render le via camada de dados/cache, jamais este client (invariantes 3/4).
 *
 * Singleton: reutiliza uma unica conexao por processo de worker.
 */

import { PrismaClient } from '@prisma/client'

let client: PrismaClient | undefined

/** Devolve o Prisma Client compartilhado do processo (cria sob demanda). */
export function getPrismaClient(): PrismaClient {
  if (client === undefined) {
    client = new PrismaClient()
  }
  return client
}

/** Encerra a conexao Prisma (chamar ao final de um worker/CLI). */
export async function disconnectPrisma(): Promise<void> {
  if (client !== undefined) {
    await client.$disconnect()
    client = undefined
  }
}

export type { PrismaClient } from '@prisma/client'
// Tipos utilitarios do client (WhereInput etc.) para camadas server-only.
export type { Prisma } from '@prisma/client'
