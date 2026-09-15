/**
 * actions-log.ts — O historico das acoes do painel e o que cada uma produziu.
 * SERVER-ONLY, SO LEITURA.
 *
 * A auditoria diz o que o dono pediu e o custo que viu; o job e o pedido dizem o
 * que aconteceu depois. A tela junta os dois: "enfileirado" sem o estado do job
 * seria o painel afirmando um trabalho que talvez nunca tenha saido.
 */

import { measure, type Measured } from "../../lib/ops/measure";
import { num, opsDb } from "./db";

/** Uma acao auditada. */
export interface AdminActionRow {
  readonly id: string;
  readonly actionKind: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly tmdbId: number | null;
  readonly queue: string | null;
  readonly actorKind: string;
  readonly actorLabel: string;
  readonly outcome: string;
  readonly detail: string | null;
  readonly catalogJobId: string | null;
  readonly idempotencyKey: string | null;
  readonly forceRequestId: string | null;
  readonly requestedAt: Date;
  readonly estimate: unknown;
  readonly jobStatus: string | null;
  readonly jobCompletedAt: Date | null;
  readonly jobError: string | null;
  readonly forceStatus: string | null;
  readonly forceFinishedAt: Date | null;
  readonly forceDetail: string | null;
}

interface RawAction {
  readonly id: string;
  readonly action_kind: string;
  readonly entity_type: string | null;
  readonly entity_id: string | null;
  readonly tmdb_id: number | null;
  readonly queue: string | null;
  readonly actor_kind: string;
  readonly actor_label: string;
  readonly outcome: string;
  readonly outcome_detail: string | null;
  readonly catalog_job_id: string | null;
  readonly idempotency_key: string | null;
  readonly force_request_id: string | null;
  readonly requested_at: Date;
  readonly estimate: unknown;
  readonly job_status: string | null;
  readonly job_completed_at: Date | null;
  readonly job_error: string | null;
  readonly force_status: string | null;
  readonly force_finished_at: Date | null;
  readonly force_detail: string | null;
}

function toRow(row: RawAction): AdminActionRow {
  return {
    id: row.id,
    actionKind: row.action_kind,
    entityType: row.entity_type,
    entityId: row.entity_id,
    tmdbId: row.tmdb_id,
    queue: row.queue,
    actorKind: row.actor_kind,
    actorLabel: row.actor_label,
    outcome: row.outcome,
    detail: row.outcome_detail,
    catalogJobId: row.catalog_job_id,
    idempotencyKey: row.idempotency_key,
    forceRequestId: row.force_request_id,
    requestedAt: row.requested_at,
    estimate: row.estimate,
    jobStatus: row.job_status,
    jobCompletedAt: row.job_completed_at,
    jobError: row.job_error,
    forceStatus: row.force_status,
    forceFinishedAt: row.force_finished_at,
    forceDetail: row.force_detail,
  };
}

const PAGE = 50;

/** As acoes, mais novas primeiro, com cursor por id. */
export async function listAdminActions(
  before: string | null,
  now: Date,
): Promise<Measured<{ readonly rows: readonly AdminActionRow[]; readonly nextBefore: string | null }>> {
  return measure(
    "admin_action_audits + catalog_jobs + scheduler_force_requests",
    async () => {
      const rows = await opsDb().$queryRaw<RawAction[]>`
        SELECT a.id::text AS id, a.action_kind, a.entity_type::text AS entity_type, a.entity_id::text AS entity_id,
               a.tmdb_id, a.queue, a.actor_kind, a.actor_label, a.outcome, a.outcome_detail,
               a.catalog_job_id::text AS catalog_job_id, a.idempotency_key, a.force_request_id::text AS force_request_id,
               a.requested_at, a.estimate,
               j.status::text AS job_status, j.completed_at AS job_completed_at, j.last_error_code AS job_error,
               f.status AS force_status, f.finished_at AS force_finished_at, f.outcome_detail AS force_detail
          FROM admin_action_audits a
          LEFT JOIN catalog_jobs j ON j.id = a.catalog_job_id
          LEFT JOIN scheduler_force_requests f ON f.id = a.force_request_id
         WHERE (${before}::bigint IS NULL OR a.id < ${before}::bigint)
         ORDER BY a.id DESC
         LIMIT ${PAGE + 1}`;
      const page = rows.slice(0, PAGE).map(toRow);
      const last = page[page.length - 1];
      return { rows: page, nextBefore: rows.length > PAGE && last !== undefined ? last.id : null };
    },
    () => now,
  );
}

/** Uma acao e a cascata que ela produziu. */
export interface AdminActionDetail extends AdminActionRow {
  /** Jobs com o `run_id` da decisao (o pai e os filhos que herdaram o escopo). */
  readonly cascade: ReadonlyArray<{ readonly jobType: string; readonly status: string; readonly count: number }>;
}

export async function getAdminAction(id: string, now: Date): Promise<Measured<AdminActionDetail | null>> {
  return measure(
    "admin_action_audits + catalog_jobs (run_id da decisão) + scheduler_force_requests",
    async () => {
      const db = opsDb();
      const rows = await db.$queryRaw<Array<RawAction & { request_token: string }>>`
        SELECT a.id::text AS id, a.action_kind, a.entity_type::text AS entity_type, a.entity_id::text AS entity_id,
               a.tmdb_id, a.queue, a.actor_kind, a.actor_label, a.outcome, a.outcome_detail,
               a.catalog_job_id::text AS catalog_job_id, a.idempotency_key, a.force_request_id::text AS force_request_id,
               a.requested_at, a.estimate, a.request_token,
               j.status::text AS job_status, j.completed_at AS job_completed_at, j.last_error_code AS job_error,
               f.status AS force_status, f.finished_at AS force_finished_at, f.outcome_detail AS force_detail
          FROM admin_action_audits a
          LEFT JOIN catalog_jobs j ON j.id = a.catalog_job_id
          LEFT JOIN scheduler_force_requests f ON f.id = a.force_request_id
         WHERE a.id = ${id}::bigint`;
      const row = rows[0];
      if (row === undefined) return null;
      const cascade = await db.$queryRaw<Array<{ job_type: string; status: string; n: unknown }>>`
        SELECT job_type::text AS job_type, status::text AS status, COUNT(*) AS n
          FROM catalog_jobs
         WHERE run_id = ${`admin:${row.request_token}`}
         GROUP BY 1, 2
         ORDER BY 1, 2`;
      return {
        ...toRow(row),
        cascade: cascade.map((entry) => ({ jobType: entry.job_type, status: entry.status, count: num(entry.n) })),
      };
    },
    () => now,
  );
}
