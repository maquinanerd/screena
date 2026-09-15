import type { ReactNode } from "react";

import type { CostEstimate, QuotaFit } from "../../lib/ops/estimate";
import { formatInt } from "../../lib/ops/format";

/**
 * cost.tsx — O CUSTO de uma acao, mostrado ANTES do botao de confirmar.
 *
 * Quantas requisicoes, a qual fornecedor, que fatia da cota do dia, e se cabe.
 * Quando a acao nao cabe (ou nao faz sentido), o quadro diz o motivo e a tela
 * nao oferece o botao.
 */

function QuotaFitView({ quota }: { readonly quota: QuotaFit }): ReactNode {
  if (quota.kind === "none") return quota.note === "" ? null : <p className="ops-stamp">{quota.note}</p>;
  if (quota.kind === "no_daily_limit") return <p className="ops-stamp">{quota.note}</p>;
  const fits = quota.fits === null ? "não determinado" : quota.fits ? "sim" : "NÃO";
  return (
    <p data-quota-fits={quota.fits === null ? "indeterminado" : quota.fits ? "sim" : "nao"}>
      Cota diária do fornecedor: {formatInt(quota.dailyLimit)} · gasto hoje (UTC):{" "}
      {quota.spentToday === null ? "não determinado" : formatInt(quota.spentToday)} · sobra depois desta ação:{" "}
      {quota.remainingAfter === null ? "não determinado" : formatInt(quota.remainingAfter)} · cabe:{" "}
      <strong className={quota.fits === false ? "ops-red-text" : undefined}>{fits}</strong>
      <span className="ops-stamp">{quota.note}</span>
    </p>
  );
}

export function CostBox({ estimate }: { readonly estimate: CostEstimate }): ReactNode {
  const refused = estimate.refusal !== null;
  return (
    <div
      className={`ops-cost${refused ? " ops-cost--refused" : ""}`}
      data-cost-requests={estimate.requests === null ? "indeterminado" : String(estimate.requests)}
      data-cost-refused={refused ? "sim" : "nao"}
    >
      <div>
        <strong>Custo estimado: </strong>
        {estimate.requests === null
          ? "não determinável antes de rodar"
          : `${estimate.lowerBound ? "no mínimo " : ""}${formatInt(estimate.requests)} requisição(ões)`}
        {estimate.provider === null ? " — nenhum fornecedor externo" : ` ao fornecedor ${estimate.provider}`}
      </div>
      {estimate.lines.length > 0 ? (
        <ul className="ops-cost__lines">
          {estimate.lines.map((line) => (
            <li key={line.label}>
              {line.label}: {formatInt(line.requests)}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="ops-stamp">De onde sai a conta: {estimate.basis}</p>
      <QuotaFitView quota={estimate.quota} />
      {refused ? <p className="ops-red-text">Não é possível agora: {estimate.refusal}</p> : null}
    </div>
  );
}
