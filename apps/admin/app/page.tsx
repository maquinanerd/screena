import type { ReactNode } from "react";

import { Badge } from "../src/components/ops/badges";
import { Metric, Section, Stamp, Stat, Undetermined } from "../src/components/ops/measured";
import { describeLap, describeLiveness, describeNextRun, describeVersion } from "../src/lib/ops/describe";
import { formatDateTimeBrt, formatInt, formatPercent, formatRelative, shortSha } from "../src/lib/ops/format";
import type { QueueRow } from "../src/server/ops/queues";
import { getOverview } from "../src/server/ops/overview";

/**
 * Visao geral do painel OPERACIONAL — a raiz do admin desde 2026-09-15.
 *
 * O que esta quebrado agora no topo, em vermelho, com o motivo escrito; depois
 * cobertura, filas, cotas e servicos em uma tela. Nada aqui altera o banco: as
 * acoes ficam nas telas de Titulos e Filas, com custo e confirmacao. O painel
 * editorial que morava aqui foi para `/editorial`.
 *
 * `force-dynamic`: todo numero e medido na hora do pedido, nunca no build e nunca
 * de cache.
 */
export const dynamic = "force-dynamic";

function lastResult(row: QueueRow): string {
  const run = row.observation?.lastRun ?? null;
  if (run === null) {
    return row.rhythm.providerApi === null ? "fila derivada: medida pelo artefato" : "sem registro nos últimos 60 dias";
  }
  return `${run.status}${run.errorCode === null ? "" : ` (${run.errorCode})`} · ${formatInt(run.itemsProcessed)} itens`;
}

export default async function OverviewPage(): Promise<ReactNode> {
  const now = new Date();
  const data = await getOverview(now);
  const headline = data.headline;

  return (
    <>
      <h1 className="ops-page-title">Visão geral</h1>
      <p className="ops-lede">
        <strong>Modo somente leitura</strong>: esta tela não altera nada. As ações (forçar um título ou uma fila) ficam
        em Títulos e Filas, com o custo mostrado antes e confirmação. Todo número traz fonte e momento; o que não pôde
        ser medido aparece como “não determinado”, nunca como zero.
      </p>

      {data.broken.length > 0 ? (
        <div className="ops-broken" data-broken-count={String(data.broken.length)}>
          <h2 className="ops-broken__title">O que está quebrado agora ({formatInt(data.broken.length)})</h2>
          <ul className="ops-broken__list">
            {data.broken.map((item, index) => (
              <li key={`${item.area}-${String(index)}`}>
                <strong>{item.area}</strong> — <a href={item.href}>{item.text}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="ops-nothing-broken" data-broken-count="0">
          Nada quebrado agora nos julgamentos de filas, fila de jobs, cotas e serviços (medido em{" "}
          {formatDateTimeBrt(now)}).
        </p>
      )}

      <Section
        title="Cobertura do catálogo — filmes e séries"
        note="Do retrato diário da fila catalog_coverage, com o mesmo portão que a página usa em cada coluna. A tela Cobertura mede ao vivo e abre por tipo e idioma."
      >
        {headline === null ? (
          <p>
            <Undetermined
              reason={
                data.coverage.ok
                  ? "nenhum retrato gravado nos últimos 3 dias (a fila catalog_coverage ainda não rodou?): abra Cobertura para medir ao vivo"
                  : data.coverage.reason
              }
            />
            <Stamp source={data.coverage.source} measuredAt={data.coverage.measuredAt} />
          </p>
        ) : (
          <div className="ops-stats">
            {(
              [
                ["Com sinopse", "synopsis", headline.values.withSynopsis],
                ["Com nota externa exibível", "rating", headline.values.withDisplayableRating],
                ["Com trailer exibível", "trailer", headline.values.withTrailer],
              ] as const
            ).map(([label, key, value]) => (
              <Stat
                key={key}
                label={label}
                metric={`coverage.${key}`}
                sub={`${formatInt(value)} de ${formatInt(headline.values.titles)} títulos`}
                footer={
                  <Stamp
                    source={`catalog_coverage_snapshots (${headline.methodVersion}, retrato de ${headline.day})`}
                    measuredAt={headline.capturedAt}
                  />
                }
              >
                <Metric name={`coverage.${key}.percent`}>{formatPercent(value, headline.values.titles)}</Metric>
              </Stat>
            ))}
          </div>
        )}
      </Section>

      <Section title="Filas" note="Última execução, resultado, próxima e volta completa. Detalhe e ação em Filas.">
        {data.queues.ok ? (
          <>
            <div className="ops-table-wrap">
              <table className="ops-table" data-table="filas-resumo">
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Último sucesso</th>
                    <th>Última execução registrada</th>
                    <th>Próxima</th>
                    <th>Volta declarada</th>
                    <th>Volta medida</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.queues.value.rows.map((row) => {
                    const declared = describeLap(row.lapDeclared);
                    const measured = describeLap(row.lapMeasured);
                    const next = describeNextRun(row.schedule, now);
                    const red = row.redReasons.length > 0;
                    return (
                      <tr key={row.queue} className={red ? "ops-row--red" : undefined} data-queue={row.queue} data-red={red ? "sim" : "nao"}>
                        <td>
                          <a href={`/filas/${row.queue}`}>{row.queue}</a>
                        </td>
                        <td className="nowrap">
                          {row.schedule.lastSuccessAt === null
                            ? "nunca"
                            : `${formatDateTimeBrt(row.schedule.lastSuccessAt)} (${formatRelative(row.schedule.lastSuccessAt, now)})`}
                        </td>
                        <td>{lastResult(row)}</td>
                        <td>{next.text}</td>
                        <td className={declared.red ? "ops-cell--red" : undefined}>
                          <Metric name={`queue.${row.queue}.lap_declared`}>{declared.text}</Metric>
                        </td>
                        <td className={measured.red ? "ops-cell--red" : undefined}>
                          <Metric name={`queue.${row.queue}.lap_measured`}>{measured.text}</Metric>
                        </td>
                        <td>{red ? row.redReasons.join(" · ") : row.schedule.due ? "vencida: roda no próximo tique" : "em dia"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Stamp source={data.queues.source} measuredAt={data.queues.measuredAt} />
          </>
        ) : (
          <p>
            <Undetermined reason={data.queues.reason} />
            <Stamp source={data.queues.source} measuredAt={data.queues.measuredAt} />
          </p>
        )}
      </Section>

      <Section
        title="Fornecedores e cotas (hoje, dia UTC)"
        note="Gasto é o que NÓS contamos em api_sync_logs. A OMDb não publica cabeçalho de cota: recusa dela com o nosso contador abaixo do teto fica vermelha."
      >
        {data.quotas.ok ? (
          <>
            <div className="ops-table-wrap">
              <table className="ops-table" data-table="cotas-resumo">
                <thead>
                  <tr>
                    <th>Fornecedor</th>
                    <th className="num">Gasto hoje</th>
                    <th>Teto</th>
                    <th>Folga</th>
                    <th>Recusas do fornecedor hoje</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.quotas.value.map((row) => {
                    const policy = row.policy;
                    const limit =
                      policy === null
                        ? "sem política declarada"
                        : policy.dailyLimit !== null
                          ? `${formatInt(policy.dailyLimit)}/dia`
                          : policy.hourlyLimit !== null
                            ? `${formatInt(policy.hourlyLimit)}/hora`
                            : "sem teto diário";
                    const slack =
                      policy !== null && policy.dailyLimit !== null
                        ? formatInt(policy.dailyLimit - row.spentToday)
                        : policy !== null && policy.hourlyLimit !== null
                          ? `${formatInt(policy.hourlyLimit - row.spentLastHour)} nesta hora`
                          : "não se aplica";
                    return (
                      <tr key={row.key} className={row.judgement.red ? "ops-row--red" : undefined} data-provider={row.key}>
                        <td>{row.key}</td>
                        <td className="num">
                          <Metric name={`quota.${row.key}.spent_today`}>{formatInt(row.spentToday)}</Metric>
                        </td>
                        <td>{limit}</td>
                        <td>{slack}</td>
                        <td>{row.refusalsToday === null ? "não distinguível" : formatInt(row.refusalsToday)}</td>
                        <td>{row.judgement.red ? row.judgement.reasons.join("; ") : policy?.status === "aposentado" ? "aposentado" : "sem alerta"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Stamp source={data.quotas.source} measuredAt={data.quotas.measuredAt} />
          </>
        ) : (
          <p>
            <Undetermined reason={data.quotas.reason} />
            <Stamp source={data.quotas.source} measuredAt={data.quotas.measuredAt} />
          </p>
        )}
      </Section>

      <Section
        title="Serviços"
        note="No ar pelo sinal de vida gravado a cada 60 s; o commit é o do main cuja árvore tem a MESMA impressão digital do código no disco do container (não é variável de ambiente)."
      >
        {data.services.ok ? (
          <>
            <div className="ops-table-wrap">
              <table className="ops-table" data-table="servicos-resumo">
                <thead>
                  <tr>
                    <th>Serviço</th>
                    <th>No ar?</th>
                    <th>Commit rodando</th>
                    <th>Cabeça do main</th>
                    <th>Bate com o main?</th>
                  </tr>
                </thead>
                <tbody>
                  {data.services.value.rows.map((row) => {
                    const live = describeLiveness(row.liveness, now);
                    const version = describeVersion(row.version);
                    return (
                      <tr key={row.service.key} className={row.redReasons.length > 0 ? "ops-row--red" : undefined} data-service={row.service.key}>
                        <td>
                          {row.service.label} <span className="ops-mono">{row.service.key}</span>
                        </td>
                        <td className={live.red ? "ops-cell--red" : undefined}>{live.text}</td>
                        <td className="ops-mono">{row.match === null ? "não determinado" : `${shortSha(row.match.commitSha)} ${row.match.title}`}</td>
                        <td className="ops-mono">{shortSha(data.services.ok ? data.services.value.main.headSha : null)}</td>
                        <td className={version.red ? "ops-cell--red" : undefined}>
                          <Metric name={`service.${row.service.key}.version`}>{version.text}</Metric>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Stamp source={data.services.source} measuredAt={data.services.measuredAt} />
          </>
        ) : (
          <p>
            <Undetermined reason={data.services.reason} />
            <Stamp source={data.services.source} measuredAt={data.services.measuredAt} />
          </p>
        )}
      </Section>

      <p className="ops-stamp">
        <Badge tone="neutral">interno</Badge> Painel protegido por credencial e marcado noindex. O painel editorial está
        em <a href="/editorial">/editorial</a>.
      </p>
    </>
  );
}
