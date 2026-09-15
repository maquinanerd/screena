import type { ReactNode } from "react";

import {
  JOB_ORIGINS,
  JOB_STATUSES,
  JOB_TYPES,
  SYNC_LOG_WINDOWS_DAYS,
  SYNC_STATUSES,
  type JobLogFilters,
  type SyncLogFilters,
} from "../../lib/ops/log-filters";
import { forceQueueAction, forceTitleAction } from "../../server/ops-actions";

/**
 * forms.tsx — Os formularios do painel operacional.
 *
 * Moram em `src/components` (e nao em `app/`) pelo mesmo motivo dos formularios
 * editoriais: as paginas de `app/` sao travadas por `tests/admin/pages-no-write`,
 * e a UI de acao fica num lugar so, revisavel.
 *
 * Busca e filtro sao GET (a URL vira o link da consulta). As acoes sao POST por
 * Server Action, e o formulario so carrega QUAL acao e o nonce — o custo e
 * refeito no servidor.
 */

export function TitleSearchForm({ defaultValue }: { readonly defaultValue: string }): ReactNode {
  return (
    <form className="ops-form" method="get" action="/titulos" role="search">
      <label className="ops-field">
        Nome, id do TMDB, id interno ou imdb_id (tt…)
        <input className="ops-input" type="search" name="q" defaultValue={defaultValue} maxLength={120} />
      </label>
      <button className="ops-button" type="submit">
        Buscar
      </button>
    </form>
  );
}

/** A confirmacao de uma acao sobre um titulo. */
export function ForceTitleConfirmForm({
  segment,
  id,
  action,
  token,
  label,
}: {
  readonly segment: "filme" | "serie";
  readonly id: string;
  readonly action: string;
  readonly token: string;
  readonly label: string;
}): ReactNode {
  return (
    <form className="ops-form" action={forceTitleAction} data-force-form="titulo">
      <input type="hidden" name="tipo" value={segment} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="acao" value={action} />
      <input type="hidden" name="token" value={token} />
      <button className="ops-button ops-button--confirm" type="submit" data-confirm="true">
        {label}
      </button>
    </form>
  );
}

/** A confirmacao de um ciclo forcado de fila. */
export function ForceQueueConfirmForm({
  queue,
  token,
  label,
}: {
  readonly queue: string;
  readonly token: string;
  readonly label: string;
}): ReactNode {
  return (
    <form className="ops-form" action={forceQueueAction} data-force-form="fila">
      <input type="hidden" name="fila" value={queue} />
      <input type="hidden" name="token" value={token} />
      <button className="ops-button ops-button--confirm" type="submit" data-confirm="true">
        {label}
      </button>
    </form>
  );
}

/** Filtros de `api_sync_logs` (GET). */
export function SyncLogFiltersForm({
  filters,
  providers,
}: {
  readonly filters: SyncLogFilters;
  readonly providers: readonly string[];
}): ReactNode {
  return (
    <form className="ops-form" method="get" action="/logs">
      <input type="hidden" name="aba" value="sync" />
      <label className="ops-field">
        Fornecedor
        <select className="ops-select" name="fornecedor" defaultValue={filters.provider ?? ""}>
          <option value="">todos</option>
          {providers.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </label>
      <label className="ops-field">
        Status
        <select className="ops-select" name="status" defaultValue={filters.status ?? ""}>
          <option value="">todos</option>
          {SYNC_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label className="ops-field">
        Endpoint começa com
        <input className="ops-input" type="text" name="endpoint" defaultValue={filters.endpointPrefix ?? ""} maxLength={120} />
      </label>
      <label className="ops-field">
        Janela
        <select className="ops-select" name="dias" defaultValue={String(filters.days)}>
          {SYNC_LOG_WINDOWS_DAYS.map((days) => (
            <option key={days} value={String(days)}>
              {days === 1 ? "1 dia" : `${String(days)} dias`}
            </option>
          ))}
        </select>
      </label>
      <button className="ops-button" type="submit">
        Filtrar
      </button>
    </form>
  );
}

/** Filtros de `catalog_jobs` (GET). */
export function JobLogFiltersForm({ filters }: { readonly filters: JobLogFilters }): ReactNode {
  return (
    <form className="ops-form" method="get" action="/logs">
      <input type="hidden" name="aba" value="jobs" />
      <label className="ops-field">
        Status
        <select className="ops-select" name="status" defaultValue={filters.status ?? ""}>
          <option value="">todos</option>
          {JOB_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label className="ops-field">
        Tipo de job
        <select className="ops-select" name="tipo" defaultValue={filters.jobType ?? ""}>
          <option value="">todos</option>
          {JOB_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label className="ops-field">
        Origem
        <select className="ops-select" name="origem" defaultValue={filters.origin ?? ""}>
          <option value="">todas</option>
          {JOB_ORIGINS.map((origin) => (
            <option key={origin} value={origin}>
              {origin === "scheduler" ? "agendador" : origin === "admin" ? "painel" : "outros"}
            </option>
          ))}
        </select>
      </label>
      <label className="ops-field">
        tmdb_id
        <input className="ops-input" type="text" name="tmdb" inputMode="numeric" defaultValue={filters.externalId ?? ""} maxLength={12} />
      </label>
      <button className="ops-button" type="submit">
        Filtrar
      </button>
    </form>
  );
}
