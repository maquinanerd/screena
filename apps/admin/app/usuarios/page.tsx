import type { ReactNode } from "react";

import { Badge } from "../../src/components/ops/badges";
import { DailyBars } from "../../src/components/ops/charts";
import { EmailSearch } from "../../src/components/ops/email-search";
import { Metric, MeasuredView, Section, Stat } from "../../src/components/ops/measured";
import { formatDateTimeBrt, formatDecimal, formatInt } from "../../src/lib/ops/format";
import {
  readActiveUsers,
  readNewestUsers,
  readSignupsPerDay,
  readUserRatings,
  readUsersOverview,
  readUserVolumes,
  USER_FEATURE_GAPS,
} from "../../src/server/ops/users";

/**
 * Usuarios — contas, cadastros por dia, ativos, e-mails (na tela), avaliacoes e
 * volumes.
 *
 * E-mail aparece nesta tela porque o painel e do dono. Ele nao vai para URL (a
 * busca e POST), nao vai para log e nao tem botao de exportar. O que nao existe no
 * produto aparece como "nao implementado", nunca como zero.
 */
export const dynamic = "force-dynamic";

const SYSTEM_LIST_LABELS: Readonly<Record<string, string>> = {
  watchlist: "Quero assistir",
  favorites: "Favoritos",
  watching: "Assistindo",
  watched: "Assistidos",
};

export default async function UsersPage(): Promise<ReactNode> {
  const now = new Date();
  const [overview, signups, active, newest, ratings, volumes] = await Promise.all([
    readUsersOverview(now),
    readSignupsPerDay(now, 30),
    readActiveUsers(now),
    readNewestUsers(now, 50),
    readUserRatings(now),
    readUserVolumes(now),
  ]);

  return (
    <>
      <h1 className="ops-page-title">Usuários</h1>
      <p className="ops-lede">
        “Ativo” = login bem-sucedido OU ação registrada (nota, item de lista, acompanhamento, progresso de episódio,
        diário) na janela. Não há coluna própria de último acesso: a tela mostra o último login e a última ação, cada um
        com o nome.
      </p>

      <div className="ops-stats">
        <Stat label="Contas" footer={<MeasuredView m={overview}>{() => null}</MeasuredView>}>
          {overview.ok ? <Metric name="users.total">{formatInt(overview.value.total)}</Metric> : "não determinado"}
        </Stat>
        <Stat label="E-mail verificado" footer={<MeasuredView m={overview}>{() => null}</MeasuredView>}>
          {overview.ok ? <Metric name="users.verified">{formatInt(overview.value.verified)}</Metric> : "não determinado"}
        </Stat>
        <Stat label="Ativos em 7 dias" footer={<MeasuredView m={active}>{() => null}</MeasuredView>}>
          {active.ok ? <Metric name="users.active7">{formatInt(active.value.last7)}</Metric> : "não determinado"}
        </Stat>
        <Stat label="Ativos em 30 dias" footer={<MeasuredView m={active}>{() => null}</MeasuredView>}>
          {active.ok ? <Metric name="users.active30">{formatInt(active.value.last30)}</Metric> : "não determinado"}
        </Stat>
      </div>

      <Section title="Contas por status e papel">
        <MeasuredView m={overview}>
          {(value) => (
            <p>
              {value.byStatus.map((entry) => (
                <span key={entry.status}>
                  <Badge tone={entry.status === "active" ? "green" : "neutral"}>
                    {entry.status}: {formatInt(entry.count)}
                  </Badge>{" "}
                </span>
              ))}
              {value.byRole.map((entry) => (
                <span key={entry.role}>
                  <Badge tone="neutral">
                    papel {entry.role}: {formatInt(entry.count)}
                  </Badge>{" "}
                </span>
              ))}
            </p>
          )}
        </MeasuredView>
      </Section>

      <Section title="Cadastros por dia (30 dias)">
        <MeasuredView m={signups}>
          {(days) => <DailyBars title="Cadastros" unit="contas" emptyMeansZero points={days.map((day) => ({ day: day.day, value: day.count }))} />}
        </MeasuredView>
      </Section>

      <Section title="Buscar por e-mail">
        <EmailSearch />
      </Section>

      <Section title="Contas mais novas (50)" note="E-mail na tela; sem exportação.">
        <MeasuredView m={newest}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="ops-muted">nenhuma conta cadastrada</p>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table" data-table="usuarios-novos">
                  <thead>
                    <tr>
                      <th>E-mail</th>
                      <th>Handle</th>
                      <th>Status</th>
                      <th>Verificado</th>
                      <th>Cadastro</th>
                      <th>Origem</th>
                      <th>Último login</th>
                      <th>Última ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.email}</td>
                        <td>{row.handle ?? "sem handle"}</td>
                        <td>{row.status}</td>
                        <td>{row.verified ? "sim" : "não"}</td>
                        <td className="nowrap">{formatDateTimeBrt(row.createdAt)}</td>
                        <td className="ops-muted">não implementado</td>
                        <td className="nowrap">{row.lastLoginAt === null ? "nenhum registrado" : formatDateTimeBrt(row.lastLoginAt)}</td>
                        <td className="nowrap">{row.lastActionAt === null ? "nenhuma registrada" : formatDateTimeBrt(row.lastActionAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </MeasuredView>
      </Section>

      <Section title="Avaliações de usuários" note="Nota pessoal na escala 5 (passo 0,5). Nunca vira nota de fonte externa.">
        <MeasuredView m={ratings}>
          {(value) => (
            <>
              <div className="ops-stats">
                <Stat label="Avaliações">
                  <Metric name="users.ratings.count">{formatInt(value.count)}</Metric>
                </Stat>
                <Stat label="Média">{value.average === null ? "sem avaliação" : <Metric name="users.ratings.average">{formatDecimal(value.average, 2)}</Metric>}</Stat>
              </div>
              {value.distribution.length === 0 ? null : (
                <div className="ops-table-wrap">
                  <table className="ops-table" data-table="distribuicao">
                    <thead>
                      <tr>
                        <th className="num">Nota (escala 5)</th>
                        <th className="num">Avaliações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {value.distribution.map((entry) => (
                        <tr key={entry.value}>
                          <td className="num">{formatDecimal(entry.value, 1)}</td>
                          <td className="num">{formatInt(entry.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <h3 className="admin-detail-heading">Mais avaliados</h3>
              {value.mostRated.length === 0 ? (
                <p className="ops-muted">nenhuma avaliação</p>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table" data-table="mais-avaliados">
                    <thead>
                      <tr>
                        <th>Título</th>
                        <th>Tipo</th>
                        <th className="num">Avaliações</th>
                        <th className="num">Média</th>
                      </tr>
                    </thead>
                    <tbody>
                      {value.mostRated.map((entry) => (
                        <tr key={`${entry.kind}-${entry.id}`}>
                          <td>
                            {entry.kind === "movie" || entry.kind === "tv" ? (
                              <a href={`/titulos/${entry.kind === "movie" ? "filme" : "serie"}/${entry.id}`}>{entry.title ?? `#${entry.id}`}</a>
                            ) : (
                              entry.title ?? `#${entry.id}`
                            )}
                          </td>
                          <td>{entry.kind}</td>
                          <td className="num">{formatInt(entry.count)}</td>
                          <td className="num">{entry.average === null ? "" : formatDecimal(entry.average, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <h3 className="admin-detail-heading">Últimas avaliações</h3>
              {value.latest.length === 0 ? (
                <p className="ops-muted">nenhuma avaliação</p>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table" data-table="ultimas-avaliacoes">
                    <thead>
                      <tr>
                        <th>Quando</th>
                        <th>Usuário</th>
                        <th>Título</th>
                        <th className="num">Nota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {value.latest.map((entry) => (
                        <tr key={`${entry.userId}-${entry.kind}-${entry.id}`}>
                          <td className="nowrap">{formatDateTimeBrt(entry.updatedAt)}</td>
                          <td>{entry.handle ?? `usuário #${entry.userId}`}</td>
                          <td>{entry.title ?? `${entry.kind} #${entry.id}`}</td>
                          <td className="num">{entry.value === null ? "" : formatDecimal(entry.value, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </MeasuredView>
      </Section>

      <Section title="Listas, acompanhamento e diário">
        <MeasuredView m={volumes}>
          {(value) => (
            <>
              <div className="ops-stats">
                {value.systemLists.map((entry) => (
                  <Stat key={entry.key} label={SYSTEM_LIST_LABELS[entry.key] ?? entry.key} sub={`${formatInt(entry.lists)} lista(s)`}>
                    <Metric name={`users.lists.${entry.key}`}>{formatInt(entry.items)}</Metric>
                  </Stat>
                ))}
                <Stat label="Listas próprias" sub={`${formatInt(value.customListItems)} itens`}>
                  {formatInt(value.customLists)}
                </Stat>
                <Stat label="Episódios marcados como vistos" sub={`${formatInt(value.episodeProgressRows)} linhas de progresso`}>
                  {formatInt(value.episodesWatched)}
                </Stat>
                <Stat label="Eventos no diário">{formatInt(value.viewingEvents)}</Stat>
              </div>
              {value.watchStates.length === 0 ? null : (
                <p>
                  {value.watchStates.map((entry) => (
                    <span key={entry.status}>
                      <Badge tone="neutral">
                        {entry.status}: {formatInt(entry.count)}
                      </Badge>{" "}
                    </span>
                  ))}
                </p>
              )}
              <p className="ops-stamp">
                Importações:{" "}
                {value.importJobs.length === 0
                  ? "nenhuma"
                  : value.importJobs.map((entry) => `${entry.source} ${entry.status}: ${formatInt(entry.count)}`).join(" · ")}
              </p>
            </>
          )}
        </MeasuredView>
      </Section>

      <Section title="O que não existe (e por isso não tem número)">
        <div className="ops-table-wrap">
          <table className="ops-table" data-table="lacunas">
            <thead>
              <tr>
                <th>Coisa</th>
                <th>Estado</th>
                <th>Por quê</th>
              </tr>
            </thead>
            <tbody>
              {USER_FEATURE_GAPS.map((gap) => (
                <tr key={gap.label}>
                  <td>{gap.label}</td>
                  <td>
                    <Badge tone="neutral">{gap.state}</Badge>
                  </td>
                  <td>{gap.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
