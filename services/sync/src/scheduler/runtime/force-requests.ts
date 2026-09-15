/**
 * runtime/force-requests.ts — O agendador ATENDE os pedidos do painel. Adapter
 * Prisma. COBERTO pelo typecheck da raiz (`pnpm typecheck`).
 *
 * A decisao (o pedido e valido? que argumentos a CLI recebe?) mora no nucleo puro
 * `../force-requests.ts`. Aqui so ha IO: reivindicar, concluir, abandonar e ler
 * o `imdb_id` de um titulo.
 *
 * ============================================================================
 * REIVINDICACAO COM SKIP LOCKED, COMO A FILA DE CATALOGO
 * ============================================================================
 * Duas replicas do agendador nunca pegam o mesmo pedido: o `UPDATE ... WHERE id
 * = (SELECT ... FOR UPDATE SKIP LOCKED)` e atomico. E o mesmo padrao do claim de
 * `catalog_jobs`, pelo mesmo motivo.
 */

import type { PrismaClient } from '@screena/db/server'

import { FORCE_REQUEST_ABANDON_MS, type ForceRequestRow } from '../force-requests.js'

/** A capacidade de banco que este adapter usa. */
export type ForceRequestDb = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>

/** O motivo gravado num pedido abandonado. */
export const ABANDONED_DETAIL =
  'abandonado: ficou em execucao por mais de 2 h sem conclusao (o agendador caiu no meio?)'

const DETAIL_MAX = 500

function truncateDetail(detail: string | null): string | null {
  if (detail === null) return null
  return detail.length > DETAIL_MAX ? `${detail.slice(0, DETAIL_MAX - 3)}...` : detail
}

/**
 * Pedidos `running` ha mais de {@link FORCE_REQUEST_ABANDON_MS} viram `failed`.
 *
 * Sem isto, um agendador morto no meio de um pedido prenderia o alvo para sempre:
 * o unique parcial de pedido aberto recusaria qualquer novo pedido da mesma fila.
 */
export async function abandonStaleForceRequests(db: ForceRequestDb, now: Date): Promise<number> {
  const threshold = new Date(now.getTime() - FORCE_REQUEST_ABANDON_MS)
  return db.$executeRawUnsafe(
    `UPDATE scheduler_force_requests
        SET status = 'failed',
            finished_at = $1::timestamptz AT TIME ZONE 'UTC',
            outcome_detail = $2
      WHERE status = 'running'
        AND claimed_at < $3::timestamptz AT TIME ZONE 'UTC'`,
    now.toISOString(),
    ABANDONED_DETAIL,
    threshold.toISOString(),
  )
}

/** Reivindica o pedido pendente MAIS ANTIGO. `null` = nada a atender. */
export async function claimForceRequest(
  db: ForceRequestDb,
  workerId: string,
  now: Date,
): Promise<ForceRequestRow | null> {
  const rows = await db.$queryRawUnsafe<
    Array<{
      id: bigint
      kind: string
      queue: string | null
      entity_type: string | null
      entity_id: bigint | null
    }>
  >(
    `UPDATE scheduler_force_requests
        SET status = 'running',
            claimed_at = $1::timestamptz AT TIME ZONE 'UTC',
            claimed_by = $2
      WHERE id = (
              SELECT id FROM scheduler_force_requests
               WHERE status = 'pending'
               ORDER BY requested_at ASC, id ASC
               FOR UPDATE SKIP LOCKED
               LIMIT 1)
      RETURNING id, kind, queue, entity_type::text AS entity_type, entity_id`,
    now.toISOString(),
    workerId,
  )
  const row = rows[0]
  if (row === undefined) return null
  return {
    id: row.id.toString(),
    kind: row.kind,
    queue: row.queue,
    entityType: row.entity_type,
    entityId: row.entity_id === null ? null : row.entity_id.toString(),
  }
}

/**
 * Conclui um pedido. So conclui quem ainda esta `running`: se o pedido foi
 * abandonado entre o claim e o fim (processo lento demais), o desfecho nao
 * ressuscita um estado terminal.
 */
export async function finishForceRequest(
  db: ForceRequestDb,
  id: string,
  status: 'done' | 'failed',
  detail: string | null,
  now: Date,
): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE scheduler_force_requests
        SET status = $1,
            finished_at = $2::timestamptz AT TIME ZONE 'UTC',
            outcome_detail = $3
      WHERE id = $4::bigint AND status = 'running'`,
    status,
    now.toISOString(),
    truncateDetail(detail),
    id,
  )
}

/** O titulo existe? E qual o `imdb_id` dele. */
export async function readTitleForRequest(
  db: ForceRequestDb,
  entityType: 'movie' | 'tv',
  entityId: string,
): Promise<{ readonly found: boolean; readonly imdbId: string | null }> {
  const table = entityType === 'movie' ? 'movies' : 'tv_shows'
  const rows = await db.$queryRawUnsafe<Array<{ imdb_id: string | null }>>(
    `SELECT imdb_id FROM ${table} WHERE id = $1::bigint`,
    entityId,
  )
  const row = rows[0]
  if (row === undefined) return { found: false, imdbId: null }
  return { found: true, imdbId: row.imdb_id }
}
