import type { ReactNode } from "react";

import { Badge } from "../../src/components/ops/badges";
import { Metric, Section, Stamp, Undetermined } from "../../src/components/ops/measured";
import { describeCadence, describeLap, describeNextRun } from "../../src/lib/ops/describe";
import { formatDateTimeBrt, formatDecimal, formatInt, formatRelative } from "../../src/lib/ops/format";
import { QUEUE_ROLE_NOTES } from "../../src/lib/ops/queues";
import { DECLARED_GLOBAL_BATCH_LIMIT, getQueuesPanel } from "../../src/server/ops/queues";

/**
 * Filas — todas as filas do agendador numa tabela so.
 *
 * Volta = universo ÷ (teto por ciclo × ciclos por dia). A declarada usa o teto do
 * codigo; a medida usa o que a fila registrou. Acima de 30 dias, vermelho com os
 * dias escritos: uma fila diaria com volta anual e uma fila anual com rotulo
 * diario.
 */
export const dynamic = "force-dynamic";

export default async function QueuesPage(): Promise<ReactNode> {
  const now = new Date();
  const panel = await getQueuesPanel(now);

  return (
    <>
      <h1 className="ops-page-title">Filas</h1>
      <p className="ops-lede">
        Cada linha é uma fila da tabela de ritmos do agendador (screen-cron). O teto global que o código declara é{" "}
        {formatInt(DECLARED_GLOBAL_BATCH_LIMIT)} itens por ciclo; o valor real é a variável CINERIE_SCHEDULER_BATCH_LIMIT
        do screen-cron, que este painel não enxerga — por isso a volta aparece duas vezes: declarada (pelo código) e
        medida (pelo que a fila registrou).
      </p>

      {!panel.ok ? (
        <p>
          <Undetermined reason={panel.reason} />
          <Stamp source={panel.source} measuredAt={panel.measuredAt} />
        </p>
      ) : (
        <>
          <div className="ops-table-wrap">
            <table className="ops-table" data-table="filas">
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Cadência</th>
                  <th>Teto por ciclo</th>
                  <th>Universo</th>
                  <th>Volta declarada</th>
                  <th>Volta medida</th>
                  <th>Última execução</th>
                  <th>Resultado</th>
                  <th>Próxima</th>
                  <th>Trabalho (7 dias)</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {panel.value.rows.map((row) => {
                  const declared = describeLap(row.lapDeclared);
                  const measured = describeLap(row.lapMeasured);
                  const next = describeNextRun(row.schedule, now);
                  const run = row.observation?.lastRun ?? null;
                  const red = row.redReasons.length > 0;
                  const work = row.work.reduce(
                    (sum, entry) => ({
                      succeeded: sum.succeeded + entry.succeeded7d,
                      open: sum.open + entry.open7d,
                      dead: sum.dead + entry.deadLetter7d,
                    }),
                    { succeeded: 0, open: 0, dead: 0 },
                  );
                  return (
                    <tr key={row.queue} className={red ? "ops-row--red" : undefined} data-queue={row.queue} data-red={red ? "sim" : "nao"}>
                      <td>
                        <a href={`/filas/${row.queue}`}>
                          <strong>{row.queue}</strong>
                        </a>
                        <br />
                        <span className="ops-muted">{row.rhythm.label}</span>
                        <br />
                        <Badge tone="neutral" title={QUEUE_ROLE_NOTES[row.spec.role]}>
                          {row.spec.role}
                        </Badge>
                        {row.openForce !== null ? (
                          <>
                            {" "}
                            <Badge tone="amber">pedido do painel: {row.openForce.status}</Badge>
                          </>
                        ) : null}
                      </td>
                      <td>{describeCadence(row.rhythm, row.schedule.intervalHours, row.schedule.seasonNote)}</td>
                      <td>
                        <Metric name={`queue.${row.queue}.per_cycle`}>{row.perCycle.items === null ? "não determinado" : formatInt(row.perCycle.items)}</Metric>
                        <br />
                        <span className="ops-stamp">{row.perCycle.label}</span>
                      </td>
                      <td>
                        {row.universe.kind === "counted" ? (
                          <>
                            <Metric name={`queue.${row.queue}.universe`}>{formatInt(row.universe.items)}</Metric>
                            <br />
                            <span className="ops-stamp">{row.universeLabel}</span>
                          </>
                        ) : row.universe.kind === "not_applicable" ? (
                          <span>não se aplica: {row.universe.reason}</span>
                        ) : (
                          <Undetermined reason={row.universe.reason} />
                        )}
                      </td>
                      <td className={declared.red ? "ops-cell--red" : undefined}>
                        <Metric name={`queue.${row.queue}.lap_declared`}>{declared.text}</Metric>
                        <br />
                        <span className="ops-stamp">{declared.detail}</span>
                      </td>
                      <td className={measured.red ? "ops-cell--red" : undefined}>
                        <Metric name={`queue.${row.queue}.lap_measured`}>{measured.text}</Metric>
                        <br />
                        <span className="ops-stamp">
                          {measured.detail} (janela de {row.measuredWindow})
                        </span>
                      </td>
                      <td className="nowrap">
                        {row.schedule.lastSuccessAt === null ? (
                          "nunca com sucesso"
                        ) : (
                          <>
                            {formatDateTimeBrt(row.schedule.lastSuccessAt)}
                            <br />
                            <span className="ops-stamp">
                              {formatRelative(row.schedule.lastSuccessAt, now)}
                              {row.rhythm.providerApi === null ? " · pelo artefato" : ""}
                            </span>
                          </>
                        )}
                      </td>
                      <td>
                        {run === null ? (
                          <span className="ops-muted">sem linha de log em 60 dias</span>
                        ) : (
                          <>
                            <Badge tone={run.status === "failed" || run.status === "aborted" ? "red" : run.status === "partial" ? "amber" : "green"}>
                              {run.status}
                            </Badge>
                            {run.errorCode === null ? null : <span className="ops-mono"> {run.errorCode}</span>}
                            <br />
                            <span className="ops-stamp">
                              {formatInt(run.itemsProcessed)} itens · {formatDateTimeBrt(run.createdAt)}
                              {run.durationMs === null ? "" : ` · ${formatDecimal(run.durationMs / 1000, 1)} s`}
                            </span>
                          </>
                        )}
                      </td>
                      <td>{next.text}</td>
                      <td>
                        {row.spec.role === "produtora" ? (
                          <span>
                            {formatInt(work.succeeded)} concluídos · {formatInt(work.open)} abertos ·{" "}
                            <span className={work.dead > 0 ? "ops-red-text" : undefined}>{formatInt(work.dead)} dead-letter</span>
                          </span>
                        ) : (
                          <span className="ops-muted">não enfileira em catalog_jobs</span>
                        )}
                      </td>
                      <td>{red ? row.redReasons.join(" · ") : row.schedule.due ? "vencida: roda no próximo tique" : "em dia"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Stamp source={panel.source} measuredAt={panel.measuredAt} />
          <p className="ops-stamp">
            {panel.value.cronStartedAt === null
              ? "O screen-cron não deu sinal de vida: a carência de 6 h para fila que nunca rodou não foi aplicada."
              : `Carência de "nunca rodou" contada da subida do screen-cron em ${formatDateTimeBrt(panel.value.cronStartedAt)}.`}
          </p>

          <Section
            title="O que o sucesso de cada fila afirma"
            note="Fila produtora reporta o desfecho do ENFILEIRAMENTO; o trabalho sai no screen-catalog-worker e é contado em catalog_jobs pelo run_id que o job filho herda."
          >
            <ul>
              {Object.entries(QUEUE_ROLE_NOTES).map(([role, note]) => (
                <li key={role}>
                  <strong>{role}</strong>: {note}
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Fila de jobs (catalog_jobs), por tipo"
            note="Represada = pendente há mais de 24 h. É o mesmo julgamento do /status do screen-cron."
          >
            {panel.value.backlog.ok ? (
              <>
                <div className="ops-table-wrap">
                  <table className="ops-table" data-table="backlog">
                    <thead>
                      <tr>
                        <th>Tipo</th>
                        <th className="num">Pendentes</th>
                        <th className="num">Reivindicados</th>
                        <th className="num">Rodando</th>
                        <th className="num">Nova tentativa</th>
                        <th className="num">Concluídos</th>
                        <th className="num">Dead-letter</th>
                        <th>Pendente mais antigo</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {panel.value.backlog.value.rows.map((row) => (
                        <tr key={row.jobType} className={row.state === "REPRESADA" ? "ops-row--red" : undefined}>
                          <td>
                            <a href={`/logs?aba=jobs&tipo=${row.jobType}`}>{row.jobType}</a>
                          </td>
                          <td className="num">{formatInt(row.pending)}</td>
                          <td className="num">{formatInt(row.claimed)}</td>
                          <td className="num">{formatInt(row.running)}</td>
                          <td className="num">{formatInt(row.retryWait)}</td>
                          <td className="num">{formatInt(row.succeeded)}</td>
                          <td className={`num${row.deadLetter > 0 ? " ops-cell--red" : ""}`}>{formatInt(row.deadLetter)}</td>
                          <td>{row.oldestPendingHours === null ? "nenhum pendente" : `${formatDecimal(row.oldestPendingHours, 1)} h`}</td>
                          <td>{row.state}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Stamp source={panel.value.backlog.source} measuredAt={panel.value.backlog.measuredAt} />
              </>
            ) : (
              <p>
                <Undetermined reason={panel.value.backlog.reason} />
                <Stamp source={panel.value.backlog.source} measuredAt={panel.value.backlog.measuredAt} />
              </p>
            )}
          </Section>
        </>
      )}
    </>
  );
}
