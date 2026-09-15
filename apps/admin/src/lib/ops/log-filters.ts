/**
 * log-filters.ts — Os filtros das telas de log, lidos da URL. PURO.
 *
 * Tudo que vem da URL e LISTA FECHADA ou formato estrito: o valor vira parametro
 * de consulta, nunca texto de SQL, e um valor fora da lista vira "sem filtro" —
 * nunca erro na tela nem consulta com lixo.
 */

/** Estados de `api_sync_logs.status`. Espelha o enum `SyncStatus`. */
export const SYNC_STATUSES = ["success", "partial", "failed", "empty", "aborted"] as const;

/** Estados de `catalog_jobs.status`. Espelha o enum `CatalogJobStatus`. */
export const JOB_STATUSES = [
  "pending",
  "claimed",
  "running",
  "retry_wait",
  "succeeded",
  "failed",
  "dead_letter",
  "cancelled",
] as const;

/** Tipos de job. Espelha o enum `CatalogJobType`. */
export const JOB_TYPES = [
  "bootstrap",
  "discover_ids",
  "sync_details",
  "sync_credits",
  "sync_external_ids",
  "sync_media",
  "sync_seasons",
  "sync_episodes",
  "sync_lists",
  "sync_changes",
  "reprocess_raw",
] as const;

/** De onde o job veio, pelo `run_id`. */
export const JOB_ORIGINS = ["scheduler", "admin", "outros"] as const;

/** Janelas de tempo oferecidas para `api_sync_logs`. */
export const SYNC_LOG_WINDOWS_DAYS = [1, 7, 30, 90] as const;

/** Linhas por pagina. */
export const LOG_PAGE_SIZE = 50;

type Params = Readonly<Record<string, string | string[] | undefined>>;

function first(params: Params, key: string): string | null {
  const value = params[key];
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function oneOf<T extends string>(value: string | null, list: readonly T[]): T | null {
  return value !== null && (list as readonly string[]).includes(value) ? (value as T) : null;
}

const CURSOR = /^[1-9]\d{0,18}$/;
const PROVIDER_KEY = /^[a-z0-9_-]{1,64}$/;
const ENDPOINT_PREFIX = /^[A-Za-z0-9_/:.-]{1,120}$/;
const EXTERNAL_ID = /^\d{1,12}$/;

/** Filtros de `api_sync_logs`. */
export interface SyncLogFilters {
  readonly provider: string | null;
  readonly status: (typeof SYNC_STATUSES)[number] | null;
  readonly endpointPrefix: string | null;
  readonly days: (typeof SYNC_LOG_WINDOWS_DAYS)[number];
  readonly before: string | null;
}

export function parseSyncLogFilters(params: Params): SyncLogFilters {
  const provider = first(params, "fornecedor");
  const endpoint = first(params, "endpoint");
  const before = first(params, "antes");
  const daysRaw = Number(first(params, "dias") ?? "7");
  const days = (SYNC_LOG_WINDOWS_DAYS as readonly number[]).includes(daysRaw)
    ? (daysRaw as (typeof SYNC_LOG_WINDOWS_DAYS)[number])
    : 7;
  return {
    provider: provider !== null && PROVIDER_KEY.test(provider) ? provider : null,
    status: oneOf(first(params, "status"), SYNC_STATUSES),
    endpointPrefix: endpoint !== null && ENDPOINT_PREFIX.test(endpoint) ? endpoint : null,
    days,
    before: before !== null && CURSOR.test(before) ? before : null,
  };
}

/** Filtros de `catalog_jobs`. */
export interface JobLogFilters {
  readonly status: (typeof JOB_STATUSES)[number] | null;
  readonly jobType: (typeof JOB_TYPES)[number] | null;
  readonly origin: (typeof JOB_ORIGINS)[number] | null;
  readonly externalId: string | null;
  readonly before: string | null;
}

export function parseJobLogFilters(params: Params): JobLogFilters {
  const externalId = first(params, "tmdb");
  const before = first(params, "antes");
  return {
    status: oneOf(first(params, "status"), JOB_STATUSES),
    jobType: oneOf(first(params, "tipo"), JOB_TYPES),
    origin: oneOf(first(params, "origem"), JOB_ORIGINS),
    externalId: externalId !== null && EXTERNAL_ID.test(externalId) ? externalId : null,
    before: before !== null && CURSOR.test(before) ? before : null,
  };
}

/** Escapa `%`, `_` e `\` para um `LIKE ... ESCAPE '\'`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
