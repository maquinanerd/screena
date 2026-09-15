/**
 * logs.ts — `api_sync_logs` e `catalog_jobs`, filtrados e paginados. SERVER-ONLY.
 *
 * Colunas nomeadas (nunca `SELECT *`), mais novo primeiro, paginacao por CURSOR
 * de id (`antes=<id>`): OFFSET numa tabela que cresce a cada import fica mais
 * lento a cada pagina e ainda pula ou repete linha quando entra log novo no meio.
 */

import { escapeLike, LOG_PAGE_SIZE, type JobLogFilters, type SyncLogFilters } from "../../lib/ops/log-filters";
import { measure, type Measured } from "../../lib/ops/measure";
import { DAY_MS, num, numOrNull, opsDb } from "./db";

/** Uma linha de `api_sync_logs`. */
export interface SyncLogRow {
  readonly id: string;
  readonly providerApi: string;
  readonly endpoint: string;
  readonly status: string;
  readonly errorCode: string | null;
  readonly itemsProcessed: number;
  readonly itemsCreated: number;
  readonly itemsUpdated: number;
  readonly durationMs: number | null;
  readonly quotaCost: number | null;
  readonly createdAt: Date;
}

/** Uma pagina. */
export interface LogPage<T> {
  readonly rows: readonly T[];
  /** O cursor da proxima pagina (`antes=`). `null` = acabou. */
  readonly nextBefore: string | null;
}

export async function listSyncLogs(filters: SyncLogFilters, now: Date): Promise<Measured<LogPage<SyncLogRow>>> {
  return measure(
    "api_sync_logs",
    async () => {
      const since = new Date(now.getTime() - filters.days * DAY_MS).toISOString();
      const endpointPattern = filters.endpointPrefix === null ? null : `${escapeLike(filters.endpointPrefix)}%`;
      const rows = await opsDb().$queryRaw<
        Array<{
          id: string;
          provider_api: string;
          endpoint: string;
          status: string;
          error_code: string | null;
          items_processed: unknown;
          items_created: unknown;
          items_updated: unknown;
          duration_ms: unknown;
          quota_cost: unknown;
          created_at: Date;
        }>
      >`
        SELECT id::text AS id, provider_api, endpoint, status::text AS status, error_code,
               items_processed, items_created, items_updated, duration_ms, quota_cost, created_at
          FROM api_sync_logs
         WHERE created_at >= ${since}::timestamptz AT TIME ZONE 'UTC'
           AND (${filters.provider}::text IS NULL OR provider_api = ${filters.provider}::text)
           AND (${filters.status}::text IS NULL OR status::text = ${filters.status}::text)
           AND (${endpointPattern}::text IS NULL OR endpoint LIKE ${endpointPattern}::text ESCAPE '\\')
           AND (${filters.before}::bigint IS NULL OR id < ${filters.before}::bigint)
         ORDER BY id DESC
         LIMIT ${LOG_PAGE_SIZE + 1}`;
      const page = rows.slice(0, LOG_PAGE_SIZE).map((row) => ({
        id: row.id,
        providerApi: row.provider_api,
        endpoint: row.endpoint,
        status: row.status,
        errorCode: row.error_code,
        itemsProcessed: num(row.items_processed),
        itemsCreated: num(row.items_created),
        itemsUpdated: num(row.items_updated),
        durationMs: numOrNull(row.duration_ms),
        quotaCost: numOrNull(row.quota_cost),
        createdAt: row.created_at,
      }));
      const last = page[page.length - 1];
      return { rows: page, nextBefore: rows.length > LOG_PAGE_SIZE && last !== undefined ? last.id : null };
    },
    () => now,
  );
}

/** Uma linha de `catalog_jobs`. */
export interface JobLogRow {
  readonly id: string;
  readonly jobType: string;
  readonly status: string;
  readonly entityType: string | null;
  readonly externalId: string | null;
  readonly priority: number;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly runId: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorSafe: string | null;
  readonly availableAt: Date;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

export async function listCatalogJobs(filters: JobLogFilters, now: Date): Promise<Measured<LogPage<JobLogRow>>> {
  return measure(
    "catalog_jobs",
    async () => {
      const rows = await opsDb().$queryRaw<
        Array<{
          id: string;
          job_type: string;
          status: string;
          entity_type: string | null;
          external_id: string | null;
          priority: number;
          attempts: number;
          max_attempts: number;
          run_id: string | null;
          last_error_code: string | null;
          last_error_safe: string | null;
          available_at: Date;
          created_at: Date;
          completed_at: Date | null;
        }>
      >`
        SELECT id::text AS id, job_type::text AS job_type, status::text AS status, entity_type::text AS entity_type,
               external_id, priority, attempts, max_attempts, run_id, last_error_code, last_error_safe,
               available_at, created_at, completed_at
          FROM catalog_jobs
         WHERE (${filters.status}::text IS NULL OR status::text = ${filters.status}::text)
           AND (${filters.jobType}::text IS NULL OR job_type::text = ${filters.jobType}::text)
           AND (
                 ${filters.origin}::text IS NULL
              OR (${filters.origin}::text = 'scheduler' AND run_id LIKE 'scheduler:%')
              OR (${filters.origin}::text = 'admin' AND run_id LIKE 'admin:%')
              OR (${filters.origin}::text = 'outros'
                  AND (run_id IS NULL OR (run_id NOT LIKE 'scheduler:%' AND run_id NOT LIKE 'admin:%')))
               )
           AND (${filters.externalId}::text IS NULL OR external_id = ${filters.externalId}::text)
           AND (${filters.before}::bigint IS NULL OR id < ${filters.before}::bigint)
         ORDER BY id DESC
         LIMIT ${LOG_PAGE_SIZE + 1}`;
      const page = rows.slice(0, LOG_PAGE_SIZE).map((row) => ({
        id: row.id,
        jobType: row.job_type,
        status: row.status,
        entityType: row.entity_type,
        externalId: row.external_id,
        priority: row.priority,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        runId: row.run_id,
        lastErrorCode: row.last_error_code,
        lastErrorSafe: row.last_error_safe,
        availableAt: row.available_at,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      }));
      const last = page[page.length - 1];
      return { rows: page, nextBefore: rows.length > LOG_PAGE_SIZE && last !== undefined ? last.id : null };
    },
    () => now,
  );
}

/** As chaves de fornecedor, para o filtro. */
export async function listProviderKeys(now: Date): Promise<Measured<readonly string[]>> {
  return measure(
    "api_providers",
    async () => {
      const rows = await opsDb().$queryRaw<Array<{ key: string }>>`SELECT key FROM api_providers ORDER BY key`;
      return rows.map((row) => row.key);
    },
    () => now,
  );
}
