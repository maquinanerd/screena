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

// Cache em globalThis, nao em variavel de modulo: o dev server do Next compila
// o modulo uma vez POR ROTA, e um singleton de modulo viraria um pool de
// conexoes por rota (esgotando o Postgres em desenvolvimento). Em producao ha
// uma unica instancia de qualquer forma — o comportamento nao muda.
const globalScope = globalThis as { __screenaPrismaClient?: PrismaClient }

/** Devolve o Prisma Client compartilhado do processo (cria sob demanda). */
export function getPrismaClient(): PrismaClient {
  if (globalScope.__screenaPrismaClient === undefined) {
    globalScope.__screenaPrismaClient = new PrismaClient()
  }
  return globalScope.__screenaPrismaClient
}

/** Encerra a conexao Prisma (chamar ao final de um worker/CLI). */
export async function disconnectPrisma(): Promise<void> {
  if (globalScope.__screenaPrismaClient !== undefined) {
    await globalScope.__screenaPrismaClient.$disconnect()
    globalScope.__screenaPrismaClient = undefined
  }
}

export type { PrismaClient } from '@prisma/client'
// Tipos utilitarios do client (WhereInput etc.) para camadas server-only.
export type { Prisma } from '@prisma/client'
