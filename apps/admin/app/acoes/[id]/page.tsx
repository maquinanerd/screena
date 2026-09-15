import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { Badge } from "../../../src/components/ops/badges";
import { Metric, Section, Stamp, Undetermined } from "../../../src/components/ops/measured";
import { ACTION_KIND_LABELS, OUTCOME_LABELS, statusTone } from "../../../src/lib/ops/action-labels";
import { formatDateTimeBrt, formatInt } from "../../../src/lib/ops/format";
import { getAdminAction } from "../../../src/server/ops/actions-log";

/**
 * Uma acao do painel: o que foi pedido, o custo mostrado, o desfecho e o que o job
 * (e a cascata que herdou o escopo) ou o pedido ao screen-cron fizeram depois.
 */
export const dynamic = "force-dynamic";

interface EstimateView {
  readonly provider: string | null;
  readonly requests: number | null;
  readonly lowerBound: boolean;
  readonly basis: string;
  readonly refusal: string | null;
}

/** O custo gravado na auditoria. JSON guardado: leitura defensiva. */
function readEstimate(raw: unknown): EstimateView | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  return {
    provider: typeof record.provider === "string" ? record.provider : null,
    requests: typeof record.requests === "number" ? record.requests : null,
    lowerBound: record.lowerBound === true,
    basis: typeof record.basis === "string" ? record.basis : "",
    refusal: typeof record.refusal === "string" ? record.refusal : null,
  };
}

export default async function ActionDetailPage({ params }: { params: Promise<{ id: string }> }): Promise<ReactNode> {
  const { id } = await params;
  if (!/^[1-9]\d{0,18}$/.test(id)) notFound();
  const now = new Date();
  const action = await getAdminAction(id, now);

  if (!action.ok) {
    return (
      <>
        <h1 className="ops-page-title">Ação {id}</h1>
        <p>
          <Undetermined reason={action.reason} />
          <Stamp source={action.source} measuredAt={action.measuredAt} />
        </p>
      </>
    );
  }
  if (action.value === null) notFound();

  const row = action.value;
  const outcome = OUTCOME_LABELS[row.outcome] ?? { text: row.outcome, tone: "neutral" as const };
  const estimate = readEstimate(row.estimate);

  return (
    <>
      <p className="ops-stamp">
        <a href="/acoes">← Ações</a>
      </p>
      <h1 className="ops-page-title">
        {ACTION_KIND_LABELS[row.actionKind] ?? row.actionKind} · ação {row.id}
      </h1>

      <dl className="ops-kv" data-audit={row.id}>
        <dt>Desfecho</dt>
        <dd>
          <Badge tone={outcome.tone}>
            <Metric name="action.outcome">{outcome.text}</Metric>
          </Badge>{" "}
          {row.detail ?? ""}
        </dd>
        <dt>Alvo</dt>
        <dd>
          {row.queue !== null ? (
            <a href={`/filas/${row.queue}`}>fila {row.queue}</a>
          ) : row.entityId !== null && (row.entityType === "movie" || row.entityType === "tv") ? (
            <a href={`/titulos/${row.entityType === "movie" ? "filme" : "serie"}/${row.entityId}`}>
              {row.entityType === "movie" ? "filme" : "série"} #{row.entityId} (tmdb_id {row.tmdbId ?? "?"})
            </a>
          ) : (
            "sem alvo registrado"
          )}
        </dd>
        <dt>Pedido em</dt>
        <dd>{formatDateTimeBrt(row.requestedAt)}</dd>
        <dt>Quem</dt>
        <dd>
          {row.actorLabel} <span className="ops-stamp">({row.actorKind === "basic_auth_shared" ? "credencial compartilhada do painel" : "desenvolvimento sem proteção"})</span>
        </dd>
        <dt>Custo mostrado antes</dt>
        <dd>
          {estimate === null
            ? "não gravado"
            : `${estimate.requests === null ? "não determinável" : `${estimate.lowerBound ? "no mínimo " : ""}${formatInt(estimate.requests)} requisição(ões)`}${estimate.provider === null ? "" : ` (${estimate.provider})`}${estimate.refusal === null ? "" : ` — recusado: ${estimate.refusal}`}`}
          {estimate === null || estimate.basis === "" ? null : <span className="ops-stamp">{estimate.basis}</span>}
        </dd>
        <dt>Job de catálogo</dt>
        <dd className="ops-mono">
          {row.catalogJobId === null ? (
            "nenhum"
          ) : (
            <>
              <Metric name="action.catalog_job_id">{row.catalogJobId}</Metric> ·{" "}
              <Badge tone={statusTone(row.jobStatus)}>{row.jobStatus ?? "job não encontrado"}</Badge>
              {row.jobError === null ? "" : ` · ${row.jobError}`}
              {row.jobCompletedAt === null ? "" : ` · concluído ${formatDateTimeBrt(row.jobCompletedAt)}`}
              <br />
              <span className="ops-stamp">chave: {row.idempotencyKey ?? ""}</span>
            </>
          )}
        </dd>
        <dt>Pedido ao screen-cron</dt>
        <dd>
          {row.forceRequestId === null ? (
            "nenhum"
          ) : (
            <>
              pedido {row.forceRequestId} · <Badge tone={statusTone(row.forceStatus)}>{row.forceStatus ?? "não encontrado"}</Badge>
              {row.forceFinishedAt === null ? "" : ` · terminou ${formatDateTimeBrt(row.forceFinishedAt)}`}
              {row.forceDetail === null ? "" : ` · ${row.forceDetail}`}
            </>
          )}
        </dd>
      </dl>

      {row.catalogJobId === null ? null : (
        <Section title="A cascata desta decisão" note="Jobs com o run_id desta confirmação: o pai e os filhos que herdaram o escopo.">
          {row.cascade.length === 0 ? (
            <p className="ops-muted">nenhum job com este run_id (ainda)</p>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table" data-table="cascata">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th className="num">Jobs</th>
                  </tr>
                </thead>
                <tbody>
                  {row.cascade.map((entry) => (
                    <tr key={`${entry.jobType}-${entry.status}`} className={entry.status === "dead_letter" ? "ops-row--red" : undefined}>
                      <td>{entry.jobType}</td>
                      <td>
                        <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
                      </td>
                      <td className="num">{formatInt(entry.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
      <Stamp source={action.source} measuredAt={action.measuredAt} />
    </>
  );
}
