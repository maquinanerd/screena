/**
 * omdb-budget-source.ts — O SALDO DE COTA do dia, medido no banco.
 * COBERTO pelo typecheck da raiz E por `tsconfig.runtime.json`.
 *
 * ============================================================================
 * DE ONDE SAI O NUMERO
 * ============================================================================
 * `SUM(api_sync_logs.quota_cost)` do dia, para `provider_api = 'omdb'`. Nao ha
 * contador proprio, e isso e deliberado: um contador novo seria uma segunda
 * fonte de verdade que pode divergir do log — e o log ja e obrigatorio por
 * invariante ("todo sync externo gera log"). Se o gasto nao esta no log, o
 * problema e o log faltando, nao o contador.
 *
 * ============================================================================
 * O DIA E CIVIL, EM UTC
 * ============================================================================
 * A OMDb nao publica o fuso do corte do teto diario. UTC e a escolha
 * deterministica: o que importa e que DUAS instancias do agendador nunca
 * calculem dias diferentes. Um `America/Sao_Paulo` daria o mesmo resultado
 * pratico e acrescentaria uma dependencia de fuso do container.
 *
 * ============================================================================
 * FAIL-CLOSED
 * ============================================================================
 * Falha de leitura NAO devolve `0` ("pode gastar a vontade"): devolve o TETO,
 * que barra a fila de fundo. Um banco fora do ar nao pode virar autorizacao para
 * queimar a cota do dia inteiro.
 */

import { OMDB_DAILY_LIMIT } from '@screena/config'
import type { PrismaClient } from '@screena/db/server'

import type { OmdbBudgetPort } from '../omdb/run.js'

/** Cria o porto de saldo sobre `api_sync_logs`. */
export function createPrismaOmdbBudget(prisma: PrismaClient, now: () => Date): OmdbBudgetPort {
  return {
    async spentToday(): Promise<number> {
      const at = now()
      const startOfDay = new Date(
        Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 0, 0, 0, 0),
      )
      try {
        const rows = await prisma.$queryRawUnsafe<Array<{ spent: number | null }>>(
          `SELECT COALESCE(SUM(quota_cost), 0)::int AS spent
             FROM api_sync_logs
            WHERE provider_api = 'omdb'
              AND created_at >= $1::timestamptz AT TIME ZONE 'UTC'`,
          startOfDay.toISOString(),
        )
        return rows[0]?.spent ?? 0
      } catch {
        return OMDB_DAILY_LIMIT
      }
    },
  }
}
