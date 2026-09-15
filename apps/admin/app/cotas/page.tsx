import type { ReactNode } from "react";

import { Badge } from "../../src/components/ops/badges";
import { DailyBars } from "../../src/components/ops/charts";
import { Metric, Section, Stamp, Stat, Undetermined } from "../../src/components/ops/measured";
import { formatDateTimeBrt, formatInt } from "../../src/lib/ops/format";
import { getQuotaPanel } from "../../src/server/ops/quotas";

/**
 * Cotas — quanto cada fornecedor gastou hoje, o teto, a folga, os ultimos 30 dias
 * e as recusas DO FORNECEDOR.
 *
 * Alerta vermelho obrigatorio: recusa do fornecedor por cota com o nosso contador
 * abaixo do teto. E o unico sinal de que o contador subconta — e a OMDb nao
 * publica cabecalho de cota, entao o numero desta tela e o que NOS contamos.
 */
export const dynamic = "force-dynamic";

const STATUS_ORDER: Readonly<Record<string, number>> = { ativo: 0, sem_registro: 1, aposentado: 2 };

export default async function QuotasPage(): Promise<ReactNode> {
  const now = new Date();
  const panel = await getQuotaPanel(now, 30);

  return (
    <>
      <h1 className="ops-page-title">Cotas</h1>
      <p className="ops-lede">
        “Gasto de hoje” é a soma de api_sync_logs.quota_cost desde 00:00 UTC — o mesmo corte que o agendador usa para
        decidir se a fila de fundo da OMDb ainda roda. Recusa do fornecedor é contada só pelo código que a identifica com
        certeza; onde não há esse código, a tela diz “não distinguível” em vez de zero.
      </p>

      {!panel.ok ? (
        <p>
          <Undetermined reason={panel.reason} />
          <Stamp source={panel.source} measuredAt={panel.measuredAt} />
        </p>
      ) : (
        [...panel.value]
          .sort((a, b) => (STATUS_ORDER[a.policy?.status ?? "sem_registro"] ?? 1) - (STATUS_ORDER[b.policy?.status ?? "sem_registro"] ?? 1))
          .map((row) => {
            const policy = row.policy;
            const limit = policy?.dailyLimit ?? null;
            return (
              <Section key={row.key} title={`${row.key} — ${row.name}`} id={`fornecedor-${row.key}`}>
                {row.judgement.red ? (
                  <div className="ops-broken" data-provider-red={row.key}>
                    <h3 className="ops-broken__title">Vermelho</h3>
                    <ul className="ops-broken__list">
                      {row.judgement.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="ops-stats">
                  <Stat label="Gasto hoje (UTC)" red={row.judgement.red} sub={`${formatInt(row.runsToday)} registro(s) hoje`}>
                    <Metric name={`quota.${row.key}.spent_today`}>{formatInt(row.spentToday)}</Metric>
                  </Stat>
                  <Stat label="Teto" sub={policy?.limitBasis ?? "sem política de cota declarada neste painel"}>
                    {policy === null
                      ? "não declarado"
                      : policy.dailyLimit !== null
                        ? `${formatInt(policy.dailyLimit)}/dia`
                        : policy.hourlyLimit !== null
                          ? `${formatInt(policy.hourlyLimit)}/hora`
                          : "sem teto diário"}
                  </Stat>
                  <Stat label="Folga" sub={policy?.reserve == null ? undefined : `inclui a reserva de ${formatInt(policy.reserve)} do leitor`}>
                    {policy !== null && policy.dailyLimit !== null ? (
                      <Metric name={`quota.${row.key}.slack`}>{formatInt(policy.dailyLimit - row.spentToday)}</Metric>
                    ) : policy !== null && policy.hourlyLimit !== null ? (
                      `${formatInt(policy.hourlyLimit - row.spentLastHour)} nesta hora`
                    ) : (
                      "não se aplica"
                    )}
                  </Stat>
                  <Stat label="Recusas do fornecedor hoje" red={row.refusalsToday !== null && row.refusalsToday > 0} sub={policy?.refusalNote}>
                    {row.refusalsToday === null ? (
                      "não distinguível"
                    ) : (
                      <Metric name={`quota.${row.key}.refusals_today`}>{formatInt(row.refusalsToday)}</Metric>
                    )}
                  </Stat>
                </div>
                {policy === null ? null : (
                  <dl className="ops-kv">
                    <dt>Estado</dt>
                    <dd>
                      <Badge tone={policy.status === "ativo" ? "green" : "neutral"}>{policy.status}</Badge>
                    </dd>
                    <dt>O que o nosso contador conta</dt>
                    <dd>{policy.countsWhat}</dd>
                    <dt>Cabeçalho de cota do fornecedor</dt>
                    <dd>{policy.headers}</dd>
                    <dt>Códigos de recusa certa</dt>
                    <dd className="ops-mono">{policy.certainRefusalCodes.length === 0 ? "nenhum" : policy.certainRefusalCodes.join(", ")}</dd>
                    <dt>Último registro hoje</dt>
                    <dd>{row.lastLogToday === null ? "nenhum registro hoje" : formatDateTimeBrt(row.lastLogToday)}</dd>
                  </dl>
                )}
                <DailyBars
                  title={`Gasto por dia — ${row.key}`}
                  unit="unidades de cota"
                  limit={limit}
                  points={row.series.map((day) => ({ day: day.day, value: day.spent, red: day.refusals > 0 }))}
                />
              </Section>
            );
          })
      )}
      {panel.ok ? <Stamp source={panel.source} measuredAt={panel.measuredAt} /> : null}
    </>
  );
}
