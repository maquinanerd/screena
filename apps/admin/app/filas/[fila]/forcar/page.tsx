import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { CostBox } from "../../../../src/components/ops/cost";
import { ForceQueueConfirmForm } from "../../../../src/components/ops/forms";
import { Stamp } from "../../../../src/components/ops/measured";
import { estimateQueueAction } from "../../../../src/lib/ops/estimate";
import { newRequestToken, opsActionsEnabled } from "../../../../src/server/ops/actions-flag";
import { getQueueCostInputs, isSchedulerQueue } from "../../../../src/server/ops/queues";

/**
 * Confirmacao de UM ciclo forcado de fila.
 *
 * O painel nao executa a fila: grava um pedido em `scheduler_force_requests` e o
 * screen-cron o atende no proximo tique, com a mesma trava e o mesmo registro de
 * um ciclo normal. O custo aparece antes; se nao cabe, o botao nao aparece.
 */
export const dynamic = "force-dynamic";

export default async function ForceQueuePage({ params }: { params: Promise<{ fila: string }> }): Promise<ReactNode> {
  const { fila } = await params;
  if (!isSchedulerQueue(fila)) notFound();
  const now = new Date();
  const inputs = await getQueueCostInputs(fila, now);
  const estimate = estimateQueueAction(fila, inputs.context);
  const enabled = opsActionsEnabled();
  const token = newRequestToken();

  return (
    <>
      <p className="ops-stamp">
        <a href={`/filas/${fila}`}>← Fila {fila}</a>
      </p>
      <h1 className="ops-page-title">
        Forçar um ciclo de <span className="ops-mono">{fila}</span>
      </h1>
      <p className="ops-lede">
        O pedido entra em scheduler_force_requests e o screen-cron o executa no próximo tique (a cada 5 min), com a
        mesma trava de execução dupla e o mesmo registro em api_sync_logs de um ciclo normal. Se já houver um pedido
        aberto para esta fila, nada novo é criado. A ação fica registrada em Ações.
      </p>

      <CostBox estimate={estimate} />
      <p className="ops-stamp">
        Teto por ciclo usado: {inputs.perCycle.label}.{" "}
        {inputs.universe === null
          ? ""
          : inputs.universe.ok
            ? "Universo contado agora."
            : `Universo não determinado: ${inputs.universe.reason}.`}
      </p>
      <Stamp source={inputs.omdbSpent.source} measuredAt={inputs.omdbSpent.measuredAt} />

      {!enabled ? (
        <p className="ops-broken">As ações do painel estão desligadas (ADMIN_OPS_ACTIONS_ENABLED=false).</p>
      ) : estimate.refusal !== null ? (
        <p className="ops-muted">Sem botão: a ação não pode ser feita agora (motivo acima).</p>
      ) : (
        <ForceQueueConfirmForm queue={fila} token={token} label={`Confirmar: enfileirar um ciclo de ${fila}`} />
      )}
    </>
  );
}
