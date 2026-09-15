import type { ReactNode } from "react";

import { Badge } from "../../src/components/ops/badges";
import { Stamp, Undetermined } from "../../src/components/ops/measured";
import { ACTION_KIND_LABELS, OUTCOME_LABELS, statusTone } from "../../src/lib/ops/action-labels";
import { actionErrorText } from "../../src/lib/ops/describe";
import { formatDateTimeBrt } from "../../src/lib/ops/format";
import { listAdminActions } from "../../src/server/ops/actions-log";

/**
 * Acoes — tudo que o painel pediu, quem pediu (rotulo da credencial compartilhada),
 * o desfecho gravado e o que aconteceu depois com o job ou o pedido.
 */
export const dynamic = "force-dynamic";

function targetOf(row: { entityType: string | null; entityId: string | null; queue: string | null }): ReactNode {
  if (row.queue !== null) return <a href={`/filas/${row.queue}`}>fila {row.queue}</a>;
  if ((row.entityType === "movie" || row.entityType === "tv") && row.entityId !== null) {
    return <a href={`/titulos/${row.entityType === "movie" ? "filme" : "serie"}/${row.entityId}`}>{`${row.entityType === "movie" ? "filme" : "série"} #${row.entityId}`}</a>;
  }
  return "sem alvo registrado";
}

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const query = await searchParams;
  const rawBefore = Array.isArray(query.antes) ? query.antes[0] : query.antes;
  const before = rawBefore !== undefined && /^[1-9]\d{0,18}$/.test(rawBefore) ? rawBefore : null;
  const now = new Date();
  const page = await listAdminActions(before, now);
  const error = actionErrorText(query.erro);

  return (
    <>
      <h1 className="ops-page-title">Ações</h1>
      <p className="ops-lede">
        Toda ação do painel é gravada em admin_action_audits na mesma transação do enfileiramento, com o custo que a tela
        mostrou. A credencial do painel é compartilhada: o “quem” é o rótulo configurado, não uma pessoa identificada.
      </p>
      {error === null ? null : <p className="ops-broken">{error}</p>}

      {!page.ok ? (
        <p>
          <Undetermined reason={page.reason} />
          <Stamp source={page.source} measuredAt={page.measuredAt} />
        </p>
      ) : page.value.rows.length === 0 ? (
        <p className="ops-muted">nenhuma ação registrada ainda</p>
      ) : (
        <>
          <div className="ops-table-wrap">
            <table className="ops-table" data-table="acoes">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Ação</th>
                  <th>Alvo</th>
                  <th>Desfecho</th>
                  <th>Detalhe</th>
                  <th>Depois</th>
                  <th>Quem</th>
                </tr>
              </thead>
              <tbody>
                {page.value.rows.map((row) => {
                  const outcome = OUTCOME_LABELS[row.outcome] ?? { text: row.outcome, tone: "neutral" as const };
                  const after = row.jobStatus ?? row.forceStatus;
                  return (
                    <tr key={row.id} data-audit={row.id} data-outcome={row.outcome}>
                      <td className="nowrap">
                        <a href={`/acoes/${row.id}`}>{formatDateTimeBrt(row.requestedAt)}</a>
                      </td>
                      <td>{ACTION_KIND_LABELS[row.actionKind] ?? row.actionKind}</td>
                      <td>{targetOf(row)}</td>
                      <td>
                        <Badge tone={outcome.tone}>{outcome.text}</Badge>
                      </td>
                      <td>{row.detail ?? ""}</td>
                      <td>
                        {after === null ? (
                          <span className="ops-muted">nada enfileirado</span>
                        ) : (
                          <Badge tone={statusTone(after)}>{row.jobStatus !== null ? `job ${after}` : `pedido ${after}`}</Badge>
                        )}
                      </td>
                      <td>{row.actorLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Stamp source={page.source} measuredAt={page.measuredAt} />
          <p className="ops-pager">
            {page.value.nextBefore === null ? (
              <span className="ops-muted">fim do histórico</span>
            ) : (
              <a href={`/acoes?antes=${page.value.nextBefore}`}>página seguinte (mais antigas) →</a>
            )}
          </p>
        </>
      )}
    </>
  );
}
