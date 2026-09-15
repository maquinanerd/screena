import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { Badge } from "../../../src/components/ops/badges";
import { DailyBars } from "../../../src/components/ops/charts";
import { Metric, MeasuredView, Section, Stamp, Stat, Undetermined } from "../../../src/components/ops/measured";
import { statusTone } from "../../../src/lib/ops/action-labels";
import { actionErrorText, describeCadence, describeLap, describeNextRun, utcDayList } from "../../../src/lib/ops/describe";
import { formatDateTimeBrt, formatDecimal, formatInt, formatRelative } from "../../../src/lib/ops/format";
import { QUEUE_ROLE_NOTES } from "../../../src/lib/ops/queues";
import { getQueueDetail, isSchedulerQueue } from "../../../src/server/ops/queues";

/**
 * Detalhe de UMA fila: historico, processados, falhas, dead-letter por motivo e o
 * gasto por dia. O botao de forcar leva a uma tela de CONFIRMACAO com o custo.
 */
export const dynamic = "force-dynamic";

export default async function QueueDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ fila: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const { fila } = await params;
  if (!isSchedulerQueue(fila)) notFound();
  const query = await searchParams;
  const now = new Date();
  const detail = await getQueueDetail(fila, now);
  const error = actionErrorText(query.erro);

  if (!detail.ok) {
    return (
      <>
        <h1 className="ops-page-title">Fila {fila}</h1>
        <p>
          <Undetermined reason={detail.reason} />
          <Stamp source={detail.source} measuredAt={detail.measuredAt} />
        </p>
      </>
    );
  }

  const { row } = detail.value;
  const declared = describeLap(row.lapDeclared);
  const measured = describeLap(row.lapMeasured);
  const next = describeNextRun(row.schedule, now);
  const days = utcDayList(now, 30);

  return (
    <>
      <p className="ops-stamp">
        <a href="/filas">← Filas</a>
      </p>
      <h1 className="ops-page-title">
        Fila <span className="ops-mono">{row.queue}</span>
      </h1>
      <p className="ops-lede">
        {row.rhythm.label}. <Badge tone="neutral">{row.spec.role}</Badge> {QUEUE_ROLE_NOTES[row.spec.role]}
      </p>
      <p className="ops-stamp">Por que este ritmo: {row.rhythm.rationale}</p>

      {error === null ? null : <p className="ops-broken">{error}</p>}

      {row.redReasons.length > 0 ? (
        <div className="ops-broken" data-broken-count={String(row.redReasons.length)}>
          <h2 className="ops-broken__title">Vermelho nesta fila</h2>
          <ul className="ops-broken__list">
            {row.redReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="ops-stats">
        <Stat label="Cadência" sub={next.text}>
          {describeCadence(row.rhythm, row.schedule.intervalHours, row.schedule.seasonNote)}
        </Stat>
        <Stat label="Teto por ciclo" sub={row.perCycle.label}>
          <Metric name={`queue.${row.queue}.per_cycle`}>{row.perCycle.items === null ? "não determinado" : formatInt(row.perCycle.items)}</Metric>
        </Stat>
        <Stat
          label="Universo"
          sub={row.universe.kind === "counted" ? row.universeLabel ?? "" : row.universe.reason}
        >
          {row.universe.kind === "counted" ? (
            <Metric name={`queue.${row.queue}.universe`}>{formatInt(row.universe.items)}</Metric>
          ) : row.universe.kind === "not_applicable" ? (
            "não se aplica"
          ) : (
            "não determinado"
          )}
        </Stat>
        <Stat label="Volta declarada" red={declared.red} sub={declared.detail}>
          <Metric name={`queue.${row.queue}.lap_declared`}>{declared.text}</Metric>
        </Stat>
        <Stat label={`Volta medida (${row.measuredWindow})`} red={measured.red} sub={measured.detail}>
          <Metric name={`queue.${row.queue}.lap_measured`}>{measured.text}</Metric>
        </Stat>
      </div>
      <Stamp source={detail.source} measuredAt={detail.measuredAt} />

      <p>
        {row.openForce !== null ? (
          <Badge tone="amber">
            já há o pedido {row.openForce.id} ({row.openForce.status}) de {formatDateTimeBrt(row.openForce.requestedAt)}
          </Badge>
        ) : (
          <a className="ops-link-button" href={`/filas/${row.queue}/forcar`} data-action-link="forcar-fila">
            Forçar um ciclo desta fila (mostra o custo antes)
          </a>
        )}
      </p>

      <Section title="Processados e gasto por dia (30 dias)" note="Da linha scheduler/<fila> em api_sync_logs.">
        <MeasuredView m={detail.value.series}>
          {(series) => {
            const byDay = new Map(series.map((day) => [day.day, day]));
            return (
              <>
                <DailyBars
                  title="Itens processados"
                  unit="itens"
                  points={days.map((day) => ({ day, value: byDay.get(day)?.processed ?? null, red: (byDay.get(day)?.failed ?? 0) > 0 }))}
                />
                <DailyBars
                  title="Gasto de cota registrado (quota_cost)"
                  unit="requisições"
                  points={days.map((day) => ({ day, value: byDay.get(day)?.quotaCost ?? null }))}
                />
              </>
            );
          }}
        </MeasuredView>
      </Section>

      <Section title="Trabalho que saiu (jobs criados nos últimos 7 dias)" note={`run_id = scheduler:${row.queue}, herdado pelo job filho.`}>
        {row.work.length === 0 ? (
          <p className="ops-muted">
            {row.spec.role === "produtora" ? "nenhum job com este run_id nos últimos 7 dias" : "esta fila não enfileira em catalog_jobs"}
          </p>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table" data-table="trabalho">
              <thead>
                <tr>
                  <th>Tipo de job</th>
                  <th className="num">Concluídos</th>
                  <th className="num">Abertos</th>
                  <th className="num">Dead-letter</th>
                </tr>
              </thead>
              <tbody>
                {row.work.map((entry) => (
                  <tr key={entry.jobType}>
                    <td>{entry.jobType}</td>
                    <td className="num">{formatInt(entry.succeeded7d)}</td>
                    <td className="num">{formatInt(entry.open7d)}</td>
                    <td className={`num${entry.deadLetter7d > 0 ? " ops-cell--red" : ""}`}>{formatInt(entry.deadLetter7d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Dead-letter por motivo (30 dias)">
        <MeasuredView m={detail.value.deadLetter}>
          {(reasons) =>
            reasons.length === 0 ? (
              <p className="ops-muted">nenhum job em dead-letter com este run_id nos últimos 30 dias</p>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table" data-table="dead-letter">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th className="num">Jobs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reasons.map((reason) => (
                      <tr key={reason.code} className="ops-row--red">
                        <td className="ops-mono">{reason.code}</td>
                        <td className="num">{formatInt(reason.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </MeasuredView>
      </Section>

      <Section title="Histórico de execuções (90 dias, as 50 mais novas)">
        <MeasuredView m={detail.value.history}>
          {(history) =>
            history.length === 0 ? (
              <p className="ops-muted">nenhuma execução registrada em 90 dias</p>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table" data-table="historico">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Status</th>
                      <th>Erro</th>
                      <th className="num">Itens</th>
                      <th className="num">Duração</th>
                      <th className="num">Custo de cota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((run) => (
                      <tr key={run.id} className={run.status === "failed" || run.status === "aborted" ? "ops-row--red" : undefined}>
                        <td className="nowrap">
                          {formatDateTimeBrt(run.createdAt)} <span className="ops-stamp">{formatRelative(run.createdAt, now)}</span>
                        </td>
                        <td>{run.status}</td>
                        <td className="ops-mono">{run.errorCode ?? ""}</td>
                        <td className="num">{formatInt(run.itemsProcessed)}</td>
                        <td className="num">{run.durationMs === null ? "não registrada" : `${formatDecimal(run.durationMs / 1000, 1)} s`}</td>
                        <td className="num">{run.quotaCost === null ? "não registrado" : formatInt(run.quotaCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </MeasuredView>
      </Section>

      <Section title="Pedidos do painel para esta fila">
        <MeasuredView m={detail.value.forces}>
          {(forces) =>
            forces.length === 0 ? (
              <p className="ops-muted">nenhum pedido registrado</p>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table" data-table="pedidos">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Status</th>
                      <th>Quem pediu</th>
                      <th>Pedido em</th>
                      <th>Iniciado</th>
                      <th>Terminado</th>
                      <th>Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forces.map((force) => (
                      <tr key={force.id}>
                        <td>{force.id}</td>
                        <td>
                          <Badge tone={statusTone(force.status)}>{force.status}</Badge>
                        </td>
                        <td>{force.requestedBy}</td>
                        <td className="nowrap">{formatDateTimeBrt(force.requestedAt)}</td>
                        <td className="nowrap">{force.claimedAt === null ? "ainda não" : formatDateTimeBrt(force.claimedAt)}</td>
                        <td className="nowrap">{force.finishedAt === null ? "ainda não" : formatDateTimeBrt(force.finishedAt)}</td>
                        <td>{force.outcomeDetail ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </MeasuredView>
      </Section>
    </>
  );
}
