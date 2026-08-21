/**
 * runtime/facts.ts — De onde saem os FATOS do painel. EXCLUIDO do typecheck.
 *
 * Tres leituras, todas read-only e todas sobre tabelas que ja existem — este
 * agendador NAO precisa de migration nenhuma:
 *
 *   1. ultimo sucesso por fila;
 *   2. gasto de cota do dia por fornecedor;
 *   3. (escrita) o registro de cada execucao em `api_sync_logs`.
 *
 * ============================================================================
 * ONDE MORA O "ULTIMO SUCESSO" DE CADA FILA, E POR QUE NAO E TUDO NO MESMO LUGAR
 * ============================================================================
 * Fila que CONSOME FORNECEDOR grava em `api_sync_logs` — e a invariante do
 * projeto ("todo sync externo gera log"), e o `endpoint` carrega
 * `scheduler/<fila>` para separar a execucao agendada de uma chamada avulsa.
 *
 * Fila DERIVADA (`cinerie_score`, `search_projection`) NAO consome fornecedor
 * nenhum, e gravar linha de sync para ela seria afirmar um sync externo que nao
 * houve — alem de exigir um `api_providers.key` inventado, num seed governado
 * por teste. Para essas duas o ultimo sucesso vem do ARTEFATO que elas
 * produzem:
 *
 *   cinerie_score      -> MAX(cinerie_score_calculations.calculated_at)
 *   search_projection  -> MAX(search_documents.updated_at)
 *
 * E uma medida melhor, e nao um contorno: ela afirma que o trabalho SAIU, nao
 * que alguem escreveu uma linha dizendo que saiu.
 */

import type { PrismaClient } from '@screena/db/server'

import type { QueueLastRun } from '../due.js'
import { RHYTHMS, type SchedulerQueue } from '../rhythms.js'
import type { RunOutcome } from '../run-outcome.js'

/** Prefixo do `endpoint` de toda execucao agendada. */
export const SCHEDULER_ENDPOINT_PREFIX = 'scheduler/'

/** O `endpoint` de uma fila em `api_sync_logs`. */
export function schedulerEndpoint(queue: SchedulerQueue): string {
  return `${SCHEDULER_ENDPOINT_PREFIX}${queue}`
}

/** As filas derivadas e a consulta que mede o ultimo trabalho delas. */
const DERIVED_QUEUE_SOURCES: Readonly<Record<string, string>> = {
  cinerie_score: 'SELECT MAX(calculated_at) AS at FROM cinerie_score_calculations',
  search_projection: 'SELECT MAX(updated_at) AS at FROM search_documents',
}

/**
 * Ultimo sucesso e ultima tentativa de cada fila.
 *
 * Fila sem nenhum registro devolve `null` nos dois campos — e `null` significa
 * NUNCA RODOU, que `due.ts` trata como vencida. Nunca devolvemos `now` como
 * fallback: um fallback assim faria toda fila nascer "em dia" e o alerta de
 * fila parada nunca dispararia.
 */
export async function readLastRuns(prisma: PrismaClient): Promise<readonly QueueLastRun[]> {
  const out: QueueLastRun[] = []

  const logged = await prisma.$queryRawUnsafe<
    Array<{ endpoint: string; last_success: Date | null; last_attempt: Date | null }>
  >(
    `SELECT endpoint,
            MAX(created_at) FILTER (WHERE status IN ('success', 'empty')) AS last_success,
            MAX(created_at)                                   AS last_attempt
       FROM api_sync_logs
      WHERE endpoint LIKE $1
      GROUP BY endpoint`,
    `${SCHEDULER_ENDPOINT_PREFIX}%`,
  )
  const byEndpoint = new Map(logged.map((row) => [row.endpoint, row]))

  for (const rhythm of RHYTHMS) {
    const derivedSql = DERIVED_QUEUE_SOURCES[rhythm.queue]
    if (derivedSql !== undefined) {
      const rows = await prisma.$queryRawUnsafe<Array<{ at: Date | null }>>(derivedSql)
      const at = rows[0]?.at ?? null
      out.push({ queue: rhythm.queue, lastSuccessAt: at, lastAttemptAt: at })
      continue
    }
    const row = byEndpoint.get(schedulerEndpoint(rhythm.queue))
    out.push({
      queue: rhythm.queue,
      lastSuccessAt: row?.last_success ?? null,
      lastAttemptAt: row?.last_attempt ?? null,
    })
  }

  return out
}

/** Gasto de hoje de um fornecedor, somado de `api_sync_logs.quota_cost`. */
export async function readSpentToday(
  prisma: PrismaClient,
  providerApi: string,
  now: Date,
): Promise<number> {
  // Dia CIVIL em UTC. O teto da OMDb e diario e o fornecedor nao publica o fuso
  // do corte; UTC e a escolha deterministica, e ela e a mesma em qualquer
  // container — o que importa e nao ter DOIS dias diferentes em duas replicas.
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  )
  const rows = await prisma.$queryRawUnsafe<Array<{ spent: number | null }>>(
    `SELECT COALESCE(SUM(quota_cost), 0)::int AS spent
       FROM api_sync_logs
      WHERE provider_api = $1
        AND created_at >= $2::timestamptz AT TIME ZONE 'UTC'`,
    providerApi,
    startOfDay.toISOString(),
  )
  return rows[0]?.spent ?? 0
}

/**
 * `RunStatus` -> `SyncStatus` (o enum do banco).
 *
 * O mapa e explicito porque os dois vocabularios NAO coincidem: o nosso diz
 * `failure`, o do banco diz `failed`, e o do banco tem `empty`, que o nosso
 * expressa como `success` com `planned === 0`. Deixar a string passar direto
 * levantaria erro de enum invalido na primeira falha — exatamente quando o log
 * mais importa.
 */
export function toSyncStatus(outcome: RunOutcome): 'success' | 'partial' | 'failed' | 'empty' {
  if (outcome.status === 'failure') return 'failed'
  if (outcome.status === 'partial') return 'partial'
  return outcome.planned === 0 ? 'empty' : 'success'
}

/**
 * Registra UMA execucao em `api_sync_logs`.
 *
 * O `status` gravado espelha `RunOutcome.status` traduzido para o enum
 * `SyncStatus` do banco, e a traducao carrega duas decisoes:
 *
 *  - `partial` NAO vira `success`. O carimbo de ultimo sucesso e lido com
 *    `FILTER (WHERE status IN ('success','empty'))`, entao gravar parcial como
 *    sucesso faria a fila envelhecer sem nunca acusar.
 *  - "nada a fazer" vira `empty`, e `empty` CONTA como sucesso na leitura. Sao
 *    duas afirmacoes distintas que precisam conviver: o ciclo rodou (logo a
 *    fila nao esta parada) E nao havia trabalho (logo ninguem deve procurar o
 *    que foi processado). Gravar `success` perderia a segunda; nao contar
 *    `empty` como sucesso faria uma fila saudavel e ociosa disparar alerta.
 *
 * Os motivos entram em `error_code` (o codigo do primeiro motivo, curto e
 * seguro) — nunca a mensagem inteira, que poderia carregar dado de payload.
 */
export async function recordRun(
  prisma: PrismaClient,
  outcome: RunOutcome,
  providerApi: string,
): Promise<void> {
  const totalRequests = outcome.spend.reduce((sum, item) => sum + item.requests, 0)
  const firstReason = outcome.reasons[0]?.code ?? null
  const syncStatus = toSyncStatus(outcome)
  await prisma.$executeRawUnsafe(
    `INSERT INTO api_sync_logs
       (provider_api, endpoint, status, error_code, items_processed, items_created,
        items_updated, duration_ms, quota_cost, payload_hash, created_at)
     VALUES ($1, $2, $3::"SyncStatus", $4, $5, 0, 0, $6, $7, NULL, $8::timestamptz AT TIME ZONE 'UTC')`,
    providerApi,
    schedulerEndpoint(outcome.queue),
    syncStatus,
    outcome.status === 'success' ? null : firstReason,
    outcome.processed,
    outcome.durationMs,
    totalRequests,
    outcome.finishedAt.toISOString(),
  )
}
