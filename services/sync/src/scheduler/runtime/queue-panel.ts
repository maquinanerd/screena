/**
 * runtime/queue-panel.ts — O que o PAINEL OPERACIONAL le sobre as filas.
 * Adapter Prisma, SO LEITURA. COBERTO pelo typecheck da raiz (`pnpm typecheck`).
 *
 * ============================================================================
 * POR QUE ESTAS CONSULTAS MORAM NO AGENDADOR, E NAO NO PAINEL
 * ============================================================================
 * "Qual e o universo desta fila?" e conhecimento do AGENDADOR: a lista de status
 * que separa serie em exibicao de serie encerrada, e o recorte "tem imdb_id e
 * nenhuma nota" da cobertura da OMDb, vivem na selecao dele. Se o painel
 * reescrevesse essas listas, a volta na tela divergiria da fila no primeiro
 * status novo do TMDB. Aqui elas sao as MESMAS constantes de `selection.ts`.
 *
 * ============================================================================
 * TRES MEDIDAS QUE O PAINEL PRECISA E QUE NINGUEM LIA
 * ============================================================================
 *  1. o UNIVERSO de cada fila (o denominador da volta);
 *  2. o que a fila REGISTROU (`api_sync_logs`, `scheduler/<fila>`) — o ritmo
 *     observado, que substitui o teto global que so o `screen-cron` le;
 *  3. o TRABALHO que saiu (`catalog_jobs` pelo `run_id = 'scheduler:<fila>'`,
 *     que o filho herda) — porque, para a fila produtora, "success" no log e o
 *     enfileiramento, e nao o trabalho.
 *
 * Toda janela e limitada por `created_at` (indexado nas duas tabelas), e a leitura
 * de `catalog_jobs` usa `(run_id, created_at)`: as duas tabelas crescem a cada
 * import, e uma varredura sem limite ficaria mais lenta a cada dia.
 */

import type { PrismaClient } from '@screena/db/server'

import { SCHEDULER_QUEUES } from '../rhythms.js'
import { SCHEDULER_ENDPOINT_PREFIX } from './facts.js'
import { AIRING_TV_STATUSES, ENDED_TV_STATUSES } from './selection.js'

/** A capacidade de banco destas leituras. */
export type QueuePanelDb = Pick<PrismaClient, '$queryRawUnsafe'>

/** Os universos que o painel sabe contar. */
export const QUEUE_UNIVERSE_KEYS = [
  'titles',
  'airing_series',
  'active_titles',
  'ended_titles',
  'people',
  'omdb_coverage',
  'omdb_cache',
] as const

/** Um universo. */
export type QueueUniverseKey = (typeof QUEUE_UNIVERSE_KEYS)[number]

/**
 * O SQL de cada universo. Exportado para o validador provar a igualdade com a
 * selecao real (a cobertura da OMDb, por exemplo, contra
 * `createPrismaStaleEntityCandidates`).
 */
export const QUEUE_UNIVERSE_SQL: Readonly<Record<QueueUniverseKey, string>> = {
  titles: `SELECT (SELECT count(*) FROM movies) + (SELECT count(*) FROM tv_shows) AS n`,
  airing_series: `SELECT count(*) AS n FROM tv_shows e WHERE e."status" IS NULL OR e."status" IN ${AIRING_TV_STATUSES}`,
  active_titles: `SELECT (SELECT count(*) FROM movies e WHERE e."status" IS NULL OR e."status" <> 'Released')
                       + (SELECT count(*) FROM tv_shows e WHERE e."status" IS NULL OR e."status" NOT IN ${ENDED_TV_STATUSES}) AS n`,
  ended_titles: `SELECT (SELECT count(*) FROM movies e WHERE e."status" = 'Released')
                      + (SELECT count(*) FROM tv_shows e WHERE e."status" IN ${ENDED_TV_STATUSES}) AS n`,
  people: `SELECT count(*) AS n FROM people`,
  // O recorte do modo `coverage` de `stale-entity-candidates.ts`: tem imdb_id e
  // NENHUMA nota externa, de qualquer fornecedor.
  omdb_coverage: `SELECT (SELECT count(*) FROM movies e WHERE e."imdb_id" IS NOT NULL
                            AND NOT EXISTS (SELECT 1 FROM external_ratings r
                                             WHERE r."entity_type" = 'movie' AND r."entity_id" = e."id"))
                       + (SELECT count(*) FROM tv_shows e WHERE e."imdb_id" IS NOT NULL
                            AND NOT EXISTS (SELECT 1 FROM external_ratings r
                                             WHERE r."entity_type" = 'tv' AND r."entity_id" = e."id")) AS n`,
  omdb_cache: `SELECT count(*) AS n FROM api_cache WHERE provider_api = 'omdb'`,
}

function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return 0
}

/** Conta UM universo. */
export async function readQueueUniverse(db: QueuePanelDb, key: QueueUniverseKey): Promise<number> {
  const rows = await db.$queryRawUnsafe<Array<{ n: unknown }>>(QUEUE_UNIVERSE_SQL[key])
  return toNumber(rows[0]?.n)
}

/** A ultima execucao registrada de uma fila. */
export interface QueueLastRecordedRun {
  readonly status: string
  readonly errorCode: string | null
  readonly itemsProcessed: number
  readonly durationMs: number | null
  readonly quotaCost: number | null
  readonly createdAt: Date
}

/** O que a fila registrou numa janela. */
export interface QueueObservation {
  readonly queue: string
  readonly lastRun: QueueLastRecordedRun | null
  /** Execucoes registradas nos ultimos 7 dias. */
  readonly runs7d: number
  /** Soma de `items_processed` das execucoes que nao falharam, em 7 dias. */
  readonly processed7d: number
  /** Execucoes `failed`/`aborted` em 7 dias. */
  readonly failed7d: number
  /** Execucoes registradas nos ultimos 30 dias (fila de ritmo semanal ou mensal). */
  readonly runs30d: number
  /** Soma de `items_processed` das execucoes que nao falharam, em 30 dias. */
  readonly processed30d: number
  /** Maior `items_processed` de UMA execucao em 30 dias: o teto observado. */
  readonly maxProcessed30d: number | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Os `endpoint` de todas as filas: igualdade (indexavel), nunca `LIKE`. */
function queueEndpoints(): string[] {
  return SCHEDULER_QUEUES.map((queue) => `${SCHEDULER_ENDPOINT_PREFIX}${queue}`)
}

/** O que cada fila registrou em `api_sync_logs`, por fila. */
export async function readQueueObservations(
  db: QueuePanelDb,
  now: Date,
): Promise<ReadonlyMap<string, QueueObservation>> {
  const since7 = new Date(now.getTime() - 7 * DAY_MS).toISOString()
  const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString()
  const since60 = new Date(now.getTime() - 60 * DAY_MS).toISOString()
  const endpoints = queueEndpoints()

  const aggregates = await db.$queryRawUnsafe<
    Array<{
      endpoint: string
      runs_7d: unknown
      processed_7d: unknown
      failed_7d: unknown
      runs_30d: unknown
      processed_30d: unknown
      max_processed_30d: unknown
    }>
  >(
    `SELECT endpoint,
            COUNT(*) FILTER (WHERE created_at >= $1::timestamptz AT TIME ZONE 'UTC') AS runs_7d,
            COALESCE(SUM(items_processed) FILTER (
              WHERE created_at >= $1::timestamptz AT TIME ZONE 'UTC'
                AND status IN ('success', 'partial', 'empty')), 0) AS processed_7d,
            COUNT(*) FILTER (
              WHERE created_at >= $1::timestamptz AT TIME ZONE 'UTC'
                AND status IN ('failed', 'aborted')) AS failed_7d,
            COUNT(*) AS runs_30d,
            COALESCE(SUM(items_processed) FILTER (WHERE status IN ('success', 'partial', 'empty')), 0) AS processed_30d,
            MAX(items_processed) AS max_processed_30d
       FROM api_sync_logs
      WHERE endpoint = ANY($3::text[])
        AND created_at >= $2::timestamptz AT TIME ZONE 'UTC'
      GROUP BY endpoint`,
    since7,
    since30,
    endpoints,
  )

  const last = await db.$queryRawUnsafe<
    Array<{
      endpoint: string
      status: string
      error_code: string | null
      items_processed: unknown
      duration_ms: unknown
      quota_cost: unknown
      created_at: Date
    }>
  >(
    `SELECT DISTINCT ON (endpoint)
            endpoint, status::text AS status, error_code, items_processed, duration_ms, quota_cost, created_at
       FROM api_sync_logs
      WHERE endpoint = ANY($2::text[])
        AND created_at >= $1::timestamptz AT TIME ZONE 'UTC'
      ORDER BY endpoint, created_at DESC, id DESC`,
    since60,
    endpoints,
  )

  const out = new Map<string, QueueObservation>()
  const lastByEndpoint = new Map(last.map((row) => [row.endpoint, row]))
  const aggregateByEndpoint = new Map(aggregates.map((row) => [row.endpoint, row]))
  const seen = new Set([...aggregateByEndpoint.keys(), ...lastByEndpoint.keys()])
  for (const endpoint of seen) {
    const queue = endpoint.slice(SCHEDULER_ENDPOINT_PREFIX.length)
    const aggregate = aggregateByEndpoint.get(endpoint)
    const lastRow = lastByEndpoint.get(endpoint)
    out.set(queue, {
      queue,
      lastRun:
        lastRow === undefined
          ? null
          : {
              status: lastRow.status,
              errorCode: lastRow.error_code,
              itemsProcessed: toNumber(lastRow.items_processed),
              durationMs: lastRow.duration_ms === null ? null : toNumber(lastRow.duration_ms),
              quotaCost: lastRow.quota_cost === null ? null : toNumber(lastRow.quota_cost),
              createdAt: lastRow.created_at,
            },
      runs7d: toNumber(aggregate?.runs_7d),
      processed7d: toNumber(aggregate?.processed_7d),
      failed7d: toNumber(aggregate?.failed_7d),
      runs30d: toNumber(aggregate?.runs_30d),
      processed30d: toNumber(aggregate?.processed_30d),
      maxProcessed30d:
        aggregate === undefined || aggregate.max_processed_30d === null ? null : toNumber(aggregate.max_processed_30d),
    })
  }
  return out
}

/** O trabalho que saiu de uma fila produtora. */
export interface QueueWork {
  readonly runId: string
  readonly jobType: string
  /** Jobs criados nos ultimos 7 dias que terminaram com sucesso. */
  readonly succeeded7d: number
  /** Jobs criados nos ultimos 7 dias que ainda devem trabalho. */
  readonly open7d: number
  /** Jobs criados nos ultimos 7 dias em dead-letter. */
  readonly deadLetter7d: number
}

/** O `run_id` de uma fila do agendador (o filho herda). */
export function schedulerJobRunId(queue: string): string {
  return `scheduler:${queue}`
}

/**
 * O trabalho em `catalog_jobs` por fila do agendador e tipo de job, criado nos
 * ultimos 7 dias. O pendente mais velho que isso aparece no painel de backlog
 * (`readJobBacklog`), que olha a fila inteira por tipo.
 */
export async function readQueueWork(db: QueuePanelDb, now: Date): Promise<readonly QueueWork[]> {
  const since7 = new Date(now.getTime() - 7 * DAY_MS).toISOString()
  const runIds = SCHEDULER_QUEUES.map(schedulerJobRunId)
  const rows = await db.$queryRawUnsafe<
    Array<{ run_id: string; job_type: string; succeeded: unknown; open: unknown; dead_letter: unknown }>
  >(
    `SELECT run_id, job_type::text AS job_type,
            COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded,
            COUNT(*) FILTER (WHERE status IN ('pending', 'claimed', 'running', 'retry_wait')) AS open,
            COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter
       FROM catalog_jobs
      WHERE run_id = ANY($1::text[])
        AND created_at >= $2::timestamptz AT TIME ZONE 'UTC'
      GROUP BY run_id, job_type`,
    runIds,
    since7,
  )
  return rows.map((row) => ({
    runId: row.run_id,
    jobType: row.job_type,
    succeeded7d: toNumber(row.succeeded),
    open7d: toNumber(row.open),
    deadLetter7d: toNumber(row.dead_letter),
  }))
}

/** Dead-letter de uma fila nos ultimos 30 dias, por motivo. */
export async function readQueueDeadLetterReasons(
  db: QueuePanelDb,
  runId: string,
  now: Date,
): Promise<ReadonlyArray<{ readonly code: string; readonly count: number }>> {
  const rows = await db.$queryRawUnsafe<Array<{ code: string; n: unknown }>>(
    `SELECT COALESCE(last_error_code, '(sem codigo)') AS code, COUNT(*) AS n
       FROM catalog_jobs
      WHERE run_id = $1
        AND created_at >= $2::timestamptz AT TIME ZONE 'UTC'
        AND status = 'dead_letter'
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 20`,
    runId,
    new Date(now.getTime() - 30 * DAY_MS).toISOString(),
  )
  return rows.map((row) => ({ code: row.code, count: toNumber(row.n) }))
}

/** Uma execucao do historico. */
export interface QueueRunRow {
  readonly id: string
  readonly status: string
  readonly errorCode: string | null
  readonly itemsProcessed: number
  readonly durationMs: number | null
  readonly quotaCost: number | null
  readonly createdAt: Date
}

/** As ultimas execucoes de uma fila (90 dias, no maximo `limit`). */
export async function readQueueRunHistory(
  db: QueuePanelDb,
  queue: string,
  now: Date,
  limit = 50,
): Promise<readonly QueueRunRow[]> {
  const rows = await db.$queryRawUnsafe<
    Array<{ id: bigint; status: string; error_code: string | null; items_processed: unknown; duration_ms: unknown; quota_cost: unknown; created_at: Date }>
  >(
    `SELECT id, status::text AS status, error_code, items_processed, duration_ms, quota_cost, created_at
       FROM api_sync_logs
      WHERE endpoint = $1
        AND created_at >= $2::timestamptz AT TIME ZONE 'UTC'
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    `${SCHEDULER_ENDPOINT_PREFIX}${queue}`,
    new Date(now.getTime() - 90 * DAY_MS).toISOString(),
    Math.max(1, Math.min(200, Math.trunc(limit))),
  )
  return rows.map((row) => ({
    id: row.id.toString(),
    status: row.status,
    errorCode: row.error_code,
    itemsProcessed: toNumber(row.items_processed),
    durationMs: row.duration_ms === null ? null : toNumber(row.duration_ms),
    quotaCost: row.quota_cost === null ? null : toNumber(row.quota_cost),
    createdAt: row.created_at,
  }))
}

/** Um dia da serie de uma fila. */
export interface QueueDay {
  readonly day: string
  readonly runs: number
  readonly processed: number
  readonly quotaCost: number
  readonly failed: number
}

/** Por dia (UTC), os ultimos `days` dias de uma fila. Dia sem execucao nao aparece. */
export async function readQueueDailySeries(
  db: QueuePanelDb,
  queue: string,
  now: Date,
  days = 30,
): Promise<readonly QueueDay[]> {
  const rows = await db.$queryRawUnsafe<
    Array<{ day: Date; runs: unknown; processed: unknown; quota_cost: unknown; failed: unknown }>
  >(
    `SELECT date_trunc('day', created_at)::date AS day,
            COUNT(*) AS runs,
            COALESCE(SUM(items_processed), 0) AS processed,
            COALESCE(SUM(quota_cost), 0) AS quota_cost,
            COUNT(*) FILTER (WHERE status IN ('failed', 'aborted')) AS failed
       FROM api_sync_logs
      WHERE endpoint = $1
        AND created_at >= $2::timestamptz AT TIME ZONE 'UTC'
      GROUP BY 1
      ORDER BY 1`,
    `${SCHEDULER_ENDPOINT_PREFIX}${queue}`,
    new Date(now.getTime() - days * DAY_MS).toISOString(),
  )
  return rows.map((row) => ({
    day: (row.day instanceof Date ? row.day : new Date(String(row.day))).toISOString().slice(0, 10),
    runs: toNumber(row.runs),
    processed: toNumber(row.processed),
    quotaCost: toNumber(row.quota_cost),
    failed: toNumber(row.failed),
  }))
}
