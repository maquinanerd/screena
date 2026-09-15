import type { ReactNode } from "react";

import { Badge } from "../../src/components/ops/badges";
import { JobLogFiltersForm, SyncLogFiltersForm } from "../../src/components/ops/forms";
import { Stamp, Undetermined } from "../../src/components/ops/measured";
import { statusTone } from "../../src/lib/ops/action-labels";
import { formatDateTimeBrt, formatDecimal, formatInt } from "../../src/lib/ops/format";
import { parseJobLogFilters, parseSyncLogFilters, type JobLogFilters, type SyncLogFilters } from "../../src/lib/ops/log-filters";
import { listCatalogJobs, listProviderKeys, listSyncLogs } from "../../src/server/ops/logs";

/**
 * Logs — `api_sync_logs` e `catalog_jobs`, com filtros, mais novo primeiro e
 * paginacao por cursor. Colunas nomeadas; nunca `SELECT *`.
 */
export const dynamic = "force-dynamic";

function syncQuery(filters: SyncLogFilters, before: string): string {
  const params = new URLSearchParams({ aba: "sync", dias: String(filters.days), antes: before });
  if (filters.provider !== null) params.set("fornecedor", filters.provider);
  if (filters.status !== null) params.set("status", filters.status);
  if (filters.endpointPrefix !== null) params.set("endpoint", filters.endpointPrefix);
  return params.toString();
}

function jobQuery(filters: JobLogFilters, before: string): string {
  const params = new URLSearchParams({ aba: "jobs", antes: before });
  if (filters.status !== null) params.set("status", filters.status);
  if (filters.jobType !== null) params.set("tipo", filters.jobType);
  if (filters.origin !== null) params.set("origem", filters.origin);
  if (filters.externalId !== null) params.set("tmdb", filters.externalId);
  return params.toString();
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const query = await searchParams;
  const tab = query.aba === "jobs" ? "jobs" : "sync";
  const now = new Date();

  return (
    <>
      <h1 className="ops-page-title">Logs</h1>
      <div className="ops-tabs">
        <a className={`admin-chip${tab === "sync" ? " admin-chip--active" : ""}`} href="/logs?aba=sync">
          api_sync_logs
        </a>
        <a className={`admin-chip${tab === "jobs" ? " admin-chip--active" : ""}`} href="/logs?aba=jobs">
          catalog_jobs
        </a>
      </div>

      {tab === "sync" ? await SyncTab({ query, now }) : await JobsTab({ query, now })}
    </>
  );
}

async function SyncTab({
  query,
  now,
}: {
  readonly query: Record<string, string | string[] | undefined>;
  readonly now: Date;
}): Promise<ReactNode> {
  const filters = parseSyncLogFilters(query);
  const [page, providers] = await Promise.all([listSyncLogs(filters, now), listProviderKeys(now)]);
  return (
    <>
      <SyncLogFiltersForm filters={filters} providers={providers.ok ? providers.value : []} />
      {!page.ok ? (
        <p>
          <Undetermined reason={page.reason} />
          <Stamp source={page.source} measuredAt={page.measuredAt} />
        </p>
      ) : page.value.rows.length === 0 ? (
        <p className="ops-muted">nenhum registro com esses filtros na janela</p>
      ) : (
        <>
          <div className="ops-table-wrap">
            <table className="ops-table" data-table="api-sync-logs">
              <thead>
                <tr>
                  <th>id</th>
                  <th>Quando</th>
                  <th>Fornecedor</th>
                  <th>Endpoint</th>
                  <th>Status</th>
                  <th>Erro</th>
                  <th className="num">Processados</th>
                  <th className="num">Criados</th>
                  <th className="num">Atualizados</th>
                  <th className="num">Duração</th>
                  <th className="num">Custo de cota</th>
                </tr>
              </thead>
              <tbody>
                {page.value.rows.map((row) => (
                  <tr key={row.id} className={row.status === "failed" || row.status === "aborted" ? "ops-row--red" : undefined}>
                    <td className="ops-mono">{row.id}</td>
                    <td className="nowrap">{formatDateTimeBrt(row.createdAt)}</td>
                    <td className="ops-mono">{row.providerApi}</td>
                    <td className="ops-mono">{row.endpoint}</td>
                    <td>
                      <Badge tone={row.status === "failed" || row.status === "aborted" ? "red" : row.status === "partial" ? "amber" : "green"}>{row.status}</Badge>
                    </td>
                    <td className="ops-mono">{row.errorCode ?? ""}</td>
                    <td className="num">{formatInt(row.itemsProcessed)}</td>
                    <td className="num">{formatInt(row.itemsCreated)}</td>
                    <td className="num">{formatInt(row.itemsUpdated)}</td>
                    <td className="num">{row.durationMs === null ? "" : `${formatDecimal(row.durationMs / 1000, 1)} s`}</td>
                    <td className="num">{row.quotaCost === null ? "" : formatInt(row.quotaCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Stamp source={page.source} measuredAt={page.measuredAt} />
          <p className="ops-pager">
            {page.value.nextBefore === null ? (
              <span className="ops-muted">fim dos registros nesta janela</span>
            ) : (
              <a href={`/logs?${syncQuery(filters, page.value.nextBefore)}`}>página seguinte (mais antigos) →</a>
            )}
          </p>
        </>
      )}
    </>
  );
}

async function JobsTab({
  query,
  now,
}: {
  readonly query: Record<string, string | string[] | undefined>;
  readonly now: Date;
}): Promise<ReactNode> {
  const filters = parseJobLogFilters(query);
  const page = await listCatalogJobs(filters, now);
  return (
    <>
      <JobLogFiltersForm filters={filters} />
      {!page.ok ? (
        <p>
          <Undetermined reason={page.reason} />
          <Stamp source={page.source} measuredAt={page.measuredAt} />
        </p>
      ) : page.value.rows.length === 0 ? (
        <p className="ops-muted">nenhum job com esses filtros</p>
      ) : (
        <>
          <div className="ops-table-wrap">
            <table className="ops-table" data-table="catalog-jobs">
              <thead>
                <tr>
                  <th>id</th>
                  <th>Tipo</th>
                  <th>Status</th>
                  <th>Entidade</th>
                  <th className="num">Prioridade</th>
                  <th>Tentativas</th>
                  <th>run_id</th>
                  <th>Erro</th>
                  <th>Disponível em</th>
                  <th>Criado</th>
                  <th>Concluído</th>
                </tr>
              </thead>
              <tbody>
                {page.value.rows.map((row) => (
                  <tr key={row.id} className={row.status === "dead_letter" ? "ops-row--red" : undefined}>
                    <td className="ops-mono">{row.id}</td>
                    <td>{row.jobType}</td>
                    <td>
                      <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                    </td>
                    <td className="ops-mono">
                      {row.entityType ?? ""} {row.externalId ?? ""}
                    </td>
                    <td className="num">{row.priority}</td>
                    <td>
                      {row.attempts}/{row.maxAttempts}
                    </td>
                    <td className="ops-mono">{row.runId ?? "sem run_id"}</td>
                    <td className="ops-mono">
                      {row.lastErrorCode ?? ""}
                      {row.lastErrorSafe === null ? null : (
                        <>
                          <br />
                          <span className="ops-stamp">{row.lastErrorSafe}</span>
                        </>
                      )}
                    </td>
                    <td className="nowrap">{formatDateTimeBrt(row.availableAt)}</td>
                    <td className="nowrap">{formatDateTimeBrt(row.createdAt)}</td>
                    <td className="nowrap">{row.completedAt === null ? "" : formatDateTimeBrt(row.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Stamp source={page.source} measuredAt={page.measuredAt} />
          <p className="ops-pager">
            {page.value.nextBefore === null ? (
              <span className="ops-muted">fim dos jobs com esses filtros</span>
            ) : (
              <a href={`/logs?${jobQuery(filters, page.value.nextBefore)}`}>página seguinte (mais antigos) →</a>
            )}
          </p>
        </>
      )}
    </>
  );
}
