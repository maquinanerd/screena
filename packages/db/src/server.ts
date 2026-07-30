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

/**
 * Cria um client DEDICADO para uma URL de banco explicita.
 *
 * Existe porque nem todo processo fala com o banco default. O worker de
 * projecao editorial aponta para o `screen-db` via `SCREEN_DATABASE_URL` e
 * **nunca** deve cair em `DATABASE_URL` (ADR 0015): `getPrismaClient()` acima
 * usaria o datasource default e apagaria essa fronteira em silencio.
 *
 * Tambem fecha um buraco de forma: `PrismaClient` so era reexportado como
 * TIPO daqui. Um chamador que fizesse `import { PrismaClient }` para dar
 * `new PrismaClient(...)` compilava — `services/**\/bin/**` esta fora do
 * typecheck — e explodia em runtime com "does not provide an export named
 * 'PrismaClient'", no import, antes de qualquer log. Uma fabrica de VALOR
 * elimina a tentacao de importar o tipo como se fosse construtor.
 *
 * NAO entra no singleton: quem cria um client dedicado e dono do ciclo de vida
 * dele e precisa chamar `$disconnect()`.
 */
export function createPrismaClient(options: { readonly datasourceUrl: string }): PrismaClient {
  return new PrismaClient({ datasourceUrl: options.datasourceUrl })
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
