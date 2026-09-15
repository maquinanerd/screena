import type { ReactNode } from "react";

import { Badge } from "../../src/components/ops/badges";
import { Metric, Section, Stamp, Undetermined } from "../../src/components/ops/measured";
import { describeLiveness, describeVersion } from "../../src/lib/ops/describe";
import { formatBytes, formatDateTimeBrt, formatDecimal, formatInt, formatRelative, shortSha } from "../../src/lib/ops/format";
import { getServicesPanel } from "../../src/server/ops/services";

/**
 * Servicos — estado, tempo no ar, CPU, memoria e o COMMIT QUE CADA UM RODA.
 *
 * O commit nao vem de variavel de ambiente de build: vem da impressao digital do
 * codigo no disco do container comparada com a arvore dos commits do main. O
 * metodo esta escrito na tela.
 */
export const dynamic = "force-dynamic";

function uptime(startedAt: Date, now: Date): string {
  return formatRelative(startedAt, now).replace(/^há /, "");
}

export default async function ServicesPage(): Promise<ReactNode> {
  const now = new Date();
  const panel = await getServicesPanel(now);

  return (
    <>
      <h1 className="ops-page-title">Serviços</h1>

      <Section title="Como o commit em execução é medido (e por que não mente)">
        <ol className="ops-section__note">
          <li>
            Cada serviço, ao subir, calcula o SHA-1 de blob git de cada arquivo-fonte que está NO DISCO DO CONTAINER
            (apps, packages, services e api-clients; pastas src, app, bin e prisma) e grava um resumo em
            service_heartbeats, com sinal de vida a cada 60 s.
          </li>
          <li>
            A fila deploy_reference lê do GitHub os últimos commits do main e a árvore de cada um, e aplica a MESMA regra.
          </li>
          <li>
            O commit em execução é o commit do main cuja árvore dá o MESMO resumo. A distância até a cabeça vem da
            comparação do GitHub. Commit que só muda documentação tem o mesmo resumo do anterior: a tela mostra o mais
            novo.
          </li>
        </ol>
        <p className="ops-stamp">
          Método: <span className="ops-mono">{panel.ok ? panel.value.method : "git-blob-sha1/v1"}</span>. Não é
          CINERIE_BUILD_SHA (variável estática, que já ficou 38 commits atrasada).
        </p>
      </Section>

      {!panel.ok ? (
        <p>
          <Undetermined reason={panel.reason} />
          <Stamp source={panel.source} measuredAt={panel.measuredAt} />
        </p>
      ) : (
        <>
          <Section title="O main">
            <dl className="ops-kv">
              <dt>Cabeça do main</dt>
              <dd className="ops-mono">
                {panel.value.main.headSha === null ? (
                  <Undetermined reason="a fila deploy_reference ainda não leu o main do GitHub" />
                ) : (
                  <Metric name="main.head">{`${shortSha(panel.value.main.headSha)} ${panel.value.main.headTitle ?? ""}`}</Metric>
                )}
              </dd>
              <dt>Lida em</dt>
              <dd>{panel.value.main.readAt === null ? "nunca" : `${formatDateTimeBrt(panel.value.main.readAt)} (${formatRelative(panel.value.main.readAt, now)})`}</dd>
              <dt>Última execução da deploy_reference</dt>
              <dd>
                {panel.value.main.lastRun === null
                  ? "nenhuma registrada"
                  : `${panel.value.main.lastRun.status}${panel.value.main.lastRun.errorCode === null ? "" : ` (${panel.value.main.lastRun.errorCode})`} em ${formatDateTimeBrt(panel.value.main.lastRun.at)}`}
              </dd>
            </dl>
          </Section>

          <Section title="Serviços">
            <div className="ops-table-wrap">
              <table className="ops-table" data-table="servicos">
                <thead>
                  <tr>
                    <th>Serviço</th>
                    <th>Estado</th>
                    <th className="num">Instâncias no ar</th>
                    <th>No ar há</th>
                    <th className="num">CPU</th>
                    <th className="num">Memória (RSS / heap)</th>
                    <th>Node / build</th>
                    <th>Commit rodando</th>
                    <th>Cabeça do main</th>
                    <th>Commits atrás</th>
                    <th>Veredito</th>
                  </tr>
                </thead>
                <tbody>
                  {panel.value.rows.map((row) => {
                    const live = describeLiveness(row.liveness, now);
                    const version = describeVersion(row.version);
                    const newest = row.newest;
                    const red = row.redReasons.length > 0;
                    return (
                      <tr key={row.service.key} className={red ? "ops-row--red" : undefined} data-service={row.service.key} data-red={red ? "sim" : "nao"}>
                        <td>
                          <strong>{row.service.label}</strong>
                          <br />
                          <span className="ops-mono">{row.service.key}</span>
                          <br />
                          <span className="ops-stamp">{row.service.image}</span>
                          {row.service.note === null ? null : (
                            <>
                              <br />
                              <span className="ops-stamp">{row.service.note}</span>
                            </>
                          )}
                        </td>
                        <td className={live.red ? "ops-cell--red" : undefined}>
                          <Metric name={`service.${row.service.key}.liveness`}>{live.text}</Metric>
                        </td>
                        <td className="num">{row.service.heartbeat ? formatInt(row.liveInstances) : "não determinado"}</td>
                        <td>{newest === null ? "não determinado" : uptime(newest.startedAt, now)}</td>
                        <td className="num">{newest === null || newest.cpuPercent === null ? "não medido" : `${formatDecimal(newest.cpuPercent, 1)}%`}</td>
                        <td className="num">
                          {newest === null || newest.rssBytes === null
                            ? "não medido"
                            : `${formatBytes(newest.rssBytes)} / ${newest.heapUsedBytes === null ? "heap não medido" : formatBytes(newest.heapUsedBytes)}`}
                        </td>
                        <td className="ops-mono">
                          {newest === null ? "não determinado" : newest.nodeVersion}
                          <br />
                          {newest === null ? "" : newest.buildId === null ? "sem BUILD_ID" : `build ${newest.buildId}`}
                        </td>
                        <td className="ops-mono">
                          {row.match === null ? (
                            newest?.sourceDigest == null ? "sem impressão digital" : `resumo ${newest.sourceDigest.slice(0, 12)}…`
                          ) : (
                            <Metric name={`service.${row.service.key}.commit`}>{`${shortSha(row.match.commitSha)} ${row.match.title}`}</Metric>
                          )}
                        </td>
                        <td className="ops-mono">{shortSha(panel.value.main.headSha)}</td>
                        <td className={version.red ? "ops-cell--red" : undefined}>
                          {row.version !== null && row.version.kind === "atras" ? formatInt(row.version.behindBy) : row.version !== null && row.version.kind === "em_dia" ? "0" : "não determinado"}
                        </td>
                        <td className={version.red ? "ops-cell--red" : undefined}>
                          <Metric name={`service.${row.service.key}.version`}>{version.text}</Metric>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Stamp source={panel.source} measuredAt={panel.measuredAt} />
            {panel.value.unknownServiceKeys.length > 0 ? (
              <p className="ops-stamp">
                Sinais de vida de serviços que o painel não conhece: {panel.value.unknownServiceKeys.join(", ")}.
              </p>
            ) : null}
          </Section>

          <Section
            title="Credenciais de cada serviço"
            note="Só o NOME da variável, se está preenchida e o formato. Nenhum valor sai do container: o sinal de vida grava apenas essas três coisas."
          >
            <div className="ops-table-wrap">
              <table className="ops-table" data-table="credenciais">
                <thead>
                  <tr>
                    <th>Serviço</th>
                    <th>Variável</th>
                    <th>Preenchida</th>
                    <th>Formato</th>
                  </tr>
                </thead>
                <tbody>
                  {panel.value.rows.flatMap((row) =>
                    (row.newest?.credentials ?? []).map((credential) => (
                      <tr key={`${row.service.key}-${credential.name}`}>
                        <td className="ops-mono">{row.service.key}</td>
                        <td className="ops-mono">{credential.name}</td>
                        <td>
                          <Badge tone={credential.present ? "green" : "red"}>{credential.present ? "sim" : "não"}</Badge>
                        </td>
                        <td>{credential.format}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </>
  );
}
