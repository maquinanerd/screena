import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { Badge, VerticalBadge } from "../../../../src/components/ops/badges";
import { Metric, MeasuredView, Section, Stamp, Undetermined } from "../../../../src/components/ops/measured";
import { ACTION_KIND_LABELS, OUTCOME_LABELS, statusTone } from "../../../../src/lib/ops/action-labels";
import { actionErrorText } from "../../../../src/lib/ops/describe";
import { estimateTitleAction, FORCE_TITLE_ACTION_LABELS, FORCE_TITLE_ACTIONS } from "../../../../src/lib/ops/estimate";
import { formatDateTimeBrt, formatDecimal, formatInt, formatRelative } from "../../../../src/lib/ops/format";
import { forceTitlePath, KIND_LABEL, parseEntityId, parseTitleSegment } from "../../../../src/lib/ops/title-routes";
import {
  RATING_REFUSAL_TEXT,
  SCORE_ABSENCE_TEXT,
  SCORE_SOURCE_LABELS,
  TRAILER_REFUSAL_TEXT,
} from "../../../../src/lib/ops/visibility";
import { opsActionsEnabled } from "../../../../src/server/ops/actions-flag";
import { getTitleDiagnosis } from "../../../../src/server/ops/titles";

/**
 * Ficha de diagnostico de UM titulo.
 *
 * Identificadores, sinopse pt-BR (e se o texto existe no payload guardado), notas
 * e por que o cartao aparece ou nao, midia acesa e recusada, sincronizacao, jobs
 * e posicao na fila, veredito de indexacao e as acoes de forcar — cada uma com o
 * custo antes de confirmar.
 */
export const dynamic = "force-dynamic";

function when(date: Date | null, now: Date, empty: string): string {
  return date === null ? empty : `${formatDateTimeBrt(date)} (${formatRelative(date, now)})`;
}

export default async function TitleDiagnosisPage({
  params,
  searchParams,
}: {
  params: Promise<{ tipo: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const { tipo, id: rawId } = await params;
  const kind = parseTitleSegment(tipo);
  const id = parseEntityId(rawId);
  if (kind === null || id === null) notFound();
  const query = await searchParams;
  const now = new Date();
  const diagnosis = await getTitleDiagnosis(kind, id, now);
  const error = actionErrorText(query.erro);

  if (!diagnosis.ok) {
    return (
      <>
        <h1 className="ops-page-title">Título</h1>
        <p>
          <Undetermined reason={diagnosis.reason} />
          <Stamp source={diagnosis.source} measuredAt={diagnosis.measuredAt} />
        </p>
      </>
    );
  }
  if (diagnosis.value === null) notFound();

  const d = diagnosis.value;
  const identity = d.identity;
  const enabled = opsActionsEnabled();
  const omdbSpent = d.omdbSpentToday.ok ? d.omdbSpentToday.value : null;

  return (
    <>
      <p className="ops-stamp">
        <a href="/titulos">← Títulos</a>
      </p>
      <h1 className="ops-page-title">
        <VerticalBadge kind={identity.kind} /> {identity.ptTitle?.trim() || identity.originalTitle}
      </h1>
      <p className="ops-lede">
        {KIND_LABEL[identity.kind]} · título original “{identity.originalTitle}”
      </p>
      {error === null ? null : <p className="ops-broken">{error}</p>}

      <Section title="Identificação">
        <dl className="ops-kv">
          <dt>Id interno</dt>
          <dd className="ops-mono">{identity.id}</dd>
          <dt>tmdb_id</dt>
          <dd className="ops-mono">
            <Metric name="title.tmdb_id">{String(identity.tmdbId)}</Metric>
          </dd>
          <dt>imdb_id</dt>
          <dd className="ops-mono">
            {identity.imdbId === null ? (
              <span className="ops-red-text" data-metric="title.imdb_id">
                AUSENTE — a OMDb consulta por IMDb id e não alcança este título
              </span>
            ) : (
              <Metric name="title.imdb_id">{identity.imdbId}</Metric>
            )}
          </dd>
          <dt>Idioma original</dt>
          <dd>{identity.originalLanguage ?? "sem idioma registrado"}</dd>
          <dt>{identity.kind === "movie" ? "Lançamento" : "Estreia"}</dt>
          <dd>{identity.releaseDate === null ? "sem data" : identity.releaseDate.toISOString().slice(0, 10)}</dd>
          <dt>Status no TMDB</dt>
          <dd>{identity.status ?? "sem status"}</dd>
          <dt>Popularidade (TMDB)</dt>
          <dd>{identity.popularity === null ? "sem dado" : formatDecimal(identity.popularity, 2)}</dd>
          <dt>Votos no TMDB</dt>
          <dd>{identity.voteCountTmdb === null ? "sem dado" : formatInt(identity.voteCountTmdb)}</dd>
          {identity.kind === "tv" ? (
            <>
              <dt>Temporadas / episódios</dt>
              <dd>
                o TMDB declara {identity.numberOfSeasons ?? "?"} / {identity.numberOfEpisodes ?? "?"}; o banco tem{" "}
                <Metric name="title.seasons_in_db">{formatInt(identity.seasonsInDb ?? 0)}</Metric> /{" "}
                <Metric name="title.episodes_in_db">{formatInt(identity.episodesInDb ?? 0)}</Metric>
              </dd>
            </>
          ) : null}
          <dt>Último sync do detalhe</dt>
          <dd>{when(identity.lastSyncedAt, now, "nunca sincronizado")}</dd>
          <dt>Vence em (stale_after)</dt>
          <dd>{when(identity.staleAfter, now, "sem janela registrada")}</dd>
          <dt>Criado / atualizado</dt>
          <dd>
            {formatDateTimeBrt(identity.createdAt)} / {formatDateTimeBrt(identity.updatedAt)}
          </dd>
        </dl>
        <Stamp source={diagnosis.source} measuredAt={diagnosis.measuredAt} />
      </Section>

      <Section
        title="Ações"
        note="Cada ação enfileira trabalho (nada roda no painel). O custo aparece na tela de confirmação, refeito com o banco de agora."
      >
        {!enabled ? <p className="ops-broken">As ações do painel estão desligadas (ADMIN_OPS_ACTIONS_ENABLED=false).</p> : null}
        <div className="ops-table-wrap">
          <table className="ops-table" data-table="acoes-titulo">
            <thead>
              <tr>
                <th>Ação</th>
                <th>Custo estimado</th>
                <th>Pode agora?</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {FORCE_TITLE_ACTIONS.map((action) => {
                const estimate = estimateTitleAction(action, d.shape, { spentToday: omdbSpent });
                return (
                  <tr key={action} data-title-action={action}>
                    <td>{FORCE_TITLE_ACTION_LABELS[action]}</td>
                    <td>
                      {estimate.requests === null
                        ? "não determinável antes de rodar"
                        : `${estimate.lowerBound ? "no mínimo " : ""}${formatInt(estimate.requests)} requisição(ões)${estimate.provider === null ? "" : ` (${estimate.provider})`}`}
                    </td>
                    <td className={estimate.refusal === null ? undefined : "ops-cell--red"}>{estimate.refusal === null ? "sim" : `não: ${estimate.refusal}`}</td>
                    <td>
                      <a className="ops-link-button" href={forceTitlePath(identity.kind, identity.id, action)} data-action-link={action}>
                        Ver custo e confirmar
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Sinopse">
        <MeasuredView m={d.translations}>
          {(translations) => {
            const ptBr = translations.find((row) => (row.languageCode === "pt-BR" || row.languageCode === "pt") && row.hasSummary);
            const any = translations.find((row) => row.hasSummary);
            const payloadHasPtBr = d.payloads.ok && d.payloads.value.some((facts) => facts.hasPtBrTranslationOverview === true || facts.hasOverview);
            return (
              <>
                <p data-metric="title.synopsis_verdict">
                  {ptBr !== undefined ? (
                    <Badge tone="green">a página mostra a sinopse em {ptBr.languageCode}</Badge>
                  ) : any !== undefined ? (
                    <Badge tone="amber">sem sinopse pt-BR: a página mostra a de {any.languageCode}, com aviso de idioma</Badge>
                  ) : (
                    <Badge tone="red">sem sinopse gravada em idioma nenhum</Badge>
                  )}
                  {ptBr === undefined && payloadHasPtBr ? (
                    <span className="ops-red-text">
                      {" "}
                      O texto pt-BR EXISTE no payload guardado do TMDB e não está gravado: a recuperação de texto
                      (backfill-text) resolve sem nova requisição.
                    </span>
                  ) : null}
                </p>
                {translations.length === 0 ? (
                  <p className="ops-muted">nenhuma linha em entity_translations</p>
                ) : (
                  <div className="ops-table-wrap">
                    <table className="ops-table" data-table="traducoes">
                      <thead>
                        <tr>
                          <th>Idioma</th>
                          <th>Título</th>
                          <th>Tem sinopse?</th>
                          <th className="num">Tamanho</th>
                          <th>Status</th>
                          <th>Atualizada</th>
                        </tr>
                      </thead>
                      <tbody>
                        {translations.map((row) => (
                          <tr key={row.languageCode}>
                            <td className="ops-mono">{row.languageCode}</td>
                            <td>{row.title ?? "sem título"}</td>
                            <td>{row.hasSummary ? "sim" : "não"}</td>
                            <td className="num">{formatInt(row.summaryLength)}</td>
                            <td>{row.status}</td>
                            <td className="nowrap">{formatDateTimeBrt(row.updatedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            );
          }}
        </MeasuredView>
        <h3 className="admin-detail-heading">O payload guardado do TMDB tem o texto?</h3>
        <MeasuredView m={d.payloads}>
          {(payloads) =>
            payloads.length === 0 ? (
              <p className="ops-muted">nenhum payload de detalhe guardado (api_cache nem tmdb_raw)</p>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table" data-table="payloads">
                  <thead>
                    <tr>
                      <th>Fonte</th>
                      <th>Buscado em</th>
                      <th>overview da resposta pt-BR</th>
                      <th>translations tem pt-BR com texto?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payloads.map((facts) => (
                      <tr key={`${facts.source}-${facts.fetchedAt.toISOString()}`}>
                        <td className="ops-mono">{facts.source}</td>
                        <td className="nowrap">{formatDateTimeBrt(facts.fetchedAt)}</td>
                        <td>{facts.hasOverview ? "com texto" : "vazio"}</td>
                        <td>{facts.hasPtBrTranslationOverview === null ? "o payload não trouxe o bloco translations" : facts.hasPtBrTranslationOverview ? "sim" : "não"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </MeasuredView>
      </Section>

      <Section title="Notas externas">
        <MeasuredView m={d.ratings}>
          {(ratings) => (
            <>
              <p data-metric="title.ratings_summary">{ratings.summary}</p>
              {ratings.rows.length === 0 ? null : (
                <div className="ops-table-wrap">
                  <table className="ops-table" data-table="notas">
                    <thead>
                      <tr>
                        <th>Fonte</th>
                        <th>Métrica</th>
                        <th className="num">Valor</th>
                        <th className="num">Votos</th>
                        <th>Fornecedor técnico</th>
                        <th>Coletada</th>
                        <th>Aparece na página?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ratings.rows.map((row) => (
                        <tr key={row.id} className={row.visible ? undefined : "ops-row--red"} data-rating={row.source} data-visible={row.visible ? "sim" : "nao"}>
                          <td>{row.label}</td>
                          <td className="ops-mono">{row.metric}</td>
                          <td className="num">
                            {row.value === null ? "sem valor" : `${formatDecimal(row.value, row.value % 1 === 0 ? 0 : 1)} / ${formatInt(row.scale)}`}
                          </td>
                          <td className="num">{row.count === null ? "sem dado" : formatInt(row.count)}</td>
                          <td className="ops-mono">{row.providerApi}</td>
                          <td className="nowrap">{when(row.fetchedAt, now, "sem data de coleta")}</td>
                          <td>
                            {row.visible ? (
                              <Badge tone="green">sim</Badge>
                            ) : (
                              <>
                                <Badge tone="red">não</Badge>
                                <ul className="ops-cost__lines">
                                  {row.refusals.map((refusal) => (
                                    <li key={refusal}>{RATING_REFUSAL_TEXT[refusal]}</li>
                                  ))}
                                </ul>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="ops-stamp">
                Resposta da OMDb em cache: {ratings.omdbCacheFetchedAt === null ? "nenhuma" : formatDateTimeBrt(ratings.omdbCacheFetchedAt)}.
              </p>
            </>
          )}
        </MeasuredView>
      </Section>

      <Section title="Cinerie Score">
        <MeasuredView m={d.score}>
          {(score) => (
            <>
              <p data-metric="title.score_verdict">
                {score.verdict.rendered ? (
                  <Badge tone="green">
                    aparece, composto de {score.verdict.sources.map((source) => SCORE_SOURCE_LABELS[source] ?? source).join(", ")}
                  </Badge>
                ) : (
                  <Badge tone="amber">não aparece: {SCORE_ABSENCE_TEXT[score.verdict.reason]}</Badge>
                )}{" "}
                <span className="ops-stamp">
                  Decisão cinerie_score_display vigente: {score.authorized ? "sim" : "não"}.
                </span>
              </p>
              {score.history.length === 0 ? (
                <p className="ops-muted">nenhum cálculo registrado para este título</p>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table" data-table="score">
                    <thead>
                      <tr>
                        <th>Calculado</th>
                        <th>Status</th>
                        <th className="num">Valor</th>
                        <th>Versão</th>
                        <th>Fontes</th>
                        <th>Bloqueio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {score.history.map((row) => (
                        <tr key={`${row.version}-${row.calculatedAt.toISOString()}`}>
                          <td className="nowrap">{formatDateTimeBrt(row.calculatedAt)}</td>
                          <td>{row.status}</td>
                          <td className="num">{row.value === null ? "sem valor" : formatDecimal(row.value, 1)}</td>
                          <td className="ops-mono">{row.version}</td>
                          <td>{row.sources.length === 0 ? "nenhuma" : row.sources.join(", ")}</td>
                          <td>{row.blockedReason ?? ""}</td>
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

      <Section title="Mídia" note="Imagem tem portão da FONTE (uma licença para todas as imagens do TMDB); vídeo tem portão da LINHA.">
        <MeasuredView m={d.images}>
          {(images) => (
            <>
              <p data-metric="title.image_source">
                Pôster no registro: {identity.posterPath === null ? "ausente" : "presente"} ·{" "}
                {images.source.authorized ? (
                  <Badge tone="green">imagens autorizadas: {images.source.reason}</Badge>
                ) : (
                  <Badge tone="red">imagens NÃO autorizadas: {images.source.reason}</Badge>
                )}
              </p>
              {images.byType.length === 0 ? (
                <p className="ops-muted">nenhuma linha em tmdb_images</p>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table" data-table="imagens">
                    <thead>
                      <tr>
                        <th>Tipo</th>
                        <th className="num">Linhas</th>
                        <th className="num">display_allowed</th>
                        <th>Última busca</th>
                      </tr>
                    </thead>
                    <tbody>
                      {images.byType.map((row) => (
                        <tr key={row.type}>
                          <td>{row.type}</td>
                          <td className="num">{formatInt(row.total)}</td>
                          <td className="num">{formatInt(row.displayAllowed)}</td>
                          <td className="nowrap">{row.lastFetchedAt === null ? "sem data" : formatDateTimeBrt(row.lastFetchedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </MeasuredView>
        <MeasuredView m={d.videos}>
          {(videos) => (
            <>
              <p data-metric="title.trailer_verdict">
                {videos.some((video) => video.visible) ? (
                  <Badge tone="green">a página tem trailer</Badge>
                ) : videos.length === 0 ? (
                  <Badge tone="amber">nenhum vídeo gravado</Badge>
                ) : (
                  <Badge tone="red">há vídeos e nenhum vira trailer</Badge>
                )}
              </p>
              {videos.length === 0 ? null : (
                <div className="ops-table-wrap">
                  <table className="ops-table" data-table="videos">
                    <thead>
                      <tr>
                        <th>Tipo</th>
                        <th>Nome</th>
                        <th>Site / chave</th>
                        <th>Oficial</th>
                        <th>Idioma</th>
                        <th>Publicado</th>
                        <th>Licença / display</th>
                        <th>Vira trailer?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {videos.map((video) => (
                        <tr key={video.id} className={video.visible ? undefined : "ops-row--red"} data-visible={video.visible ? "sim" : "nao"}>
                          <td>{video.type ?? "sem tipo"}</td>
                          <td>{video.name ?? ""}</td>
                          <td className="ops-mono">
                            {video.site} {video.key}
                          </td>
                          <td>{video.official === null ? "?" : video.official ? "sim" : "não"}</td>
                          <td>{video.language ?? ""}</td>
                          <td className="nowrap">{video.publishedAt === null ? "sem data" : formatDateTimeBrt(video.publishedAt)}</td>
                          <td>
                            {video.licenseStatus} / {video.displayAllowed ? "true" : "false"}
                          </td>
                          <td>
                            {video.visible ? (
                              <Badge tone="green">sim</Badge>
                            ) : (
                              <ul className="ops-cost__lines">
                                {video.refusals.map((refusal) => (
                                  <li key={refusal}>{TRAILER_REFUSAL_TEXT[refusal]}</li>
                                ))}
                              </ul>
                            )}
                          </td>
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

      <Section title="Sincronização e fila" note="Jobs do título (e das temporadas e episódios, na série), mais novos primeiro. A posição conta os jobs reivindicáveis à frente, pela ordem prioridade → disponível em.">
        <MeasuredView m={d.jobs}>
          {(jobs) => {
            const perHour = jobs.succeededLast6h.ok ? jobs.succeededLast6h.value / 6 : null;
            return (
              <>
                <p className="ops-stamp">
                  Ritmo do worker:{" "}
                  {jobs.succeededLast6h.ok
                    ? `${formatInt(jobs.succeededLast6h.value)} jobs concluídos nas últimas 6 h (${formatDecimal(perHour ?? 0, 1)} por hora)`
                    : `não determinado (${jobs.succeededLast6h.reason})`}
                </p>
                {jobs.jobs.length === 0 ? (
                  <p className="ops-muted">nenhum job de catálogo para este título</p>
                ) : (
                  <div className="ops-table-wrap">
                    <table className="ops-table" data-table="jobs-titulo">
                      <thead>
                        <tr>
                          <th>Job</th>
                          <th>Tipo</th>
                          <th>Status</th>
                          <th className="num">Prioridade</th>
                          <th>Tentativas</th>
                          <th>Origem (run_id)</th>
                          <th>Erro</th>
                          <th>Criado</th>
                          <th>Posição e previsão</th>
                        </tr>
                      </thead>
                      <tbody>
                        {jobs.jobs.map((job) => (
                          <tr key={job.id} className={job.status === "dead_letter" ? "ops-row--red" : undefined} data-job-status={job.status}>
                            <td className="ops-mono">{job.id}</td>
                            <td>
                              {job.jobType}
                              {job.entityType === null || job.entityType === identity.kind ? "" : ` (${job.entityType})`}
                            </td>
                            <td>
                              <Badge tone={statusTone(job.status)}>{job.status}</Badge>
                            </td>
                            <td className="num">{job.priority}</td>
                            <td>
                              {job.attempts}/{job.maxAttempts}
                            </td>
                            <td className="ops-mono">{job.runId ?? "sem run_id"}</td>
                            <td className="ops-mono">{job.lastErrorCode ?? ""}</td>
                            <td className="nowrap">{formatDateTimeBrt(job.createdAt)}</td>
                            <td>
                              {job.ahead !== null
                                ? `${formatInt(job.ahead)} à frente${perHour !== null && perHour > 0 ? ` · previsão ~${formatDecimal(job.ahead / perHour, 1)} h no ritmo atual` : " · previsão não determinada (ritmo zero ou não medido)"}`
                                : job.aheadReason ?? (job.completedAt === null ? "" : `concluído ${formatDateTimeBrt(job.completedAt)}`)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            );
          }}
        </MeasuredView>
      </Section>

      <Section title="Indexação (pt-BR)">
        <MeasuredView m={d.indexability}>
          {(index) => (
            <>
              <p data-metric="title.index_verdict">
                <Badge tone={index.verdict === "index" ? "green" : "amber"}>{index.verdict}</Badge> {index.verdictText}
              </p>
              <dl className="ops-kv">
                <dt>Slug canônico pt-BR</dt>
                <dd className="ops-mono">{index.slug ?? "ausente"}</dd>
                <dt>Decisão vigente</dt>
                <dd>
                  {index.decision === null
                    ? "nenhuma (vale o padrão: index)"
                    : `${index.decision.decision}${index.decision.reason === null ? "" : ` — ${index.decision.reason}`} (${index.decision.origin ?? "origem não registrada"}, ${formatDateTimeBrt(index.decision.createdAt)})`}
                </dd>
                <dt>Página pública</dt>
                <dd>
                  {index.publicUrl === null ? (
                    "não existe (sem slug)"
                  ) : (
                    <a href={index.publicUrl} rel="noopener noreferrer" target="_blank">
                      {index.publicUrl}
                    </a>
                  )}
                </dd>
              </dl>
            </>
          )}
        </MeasuredView>
      </Section>

      <Section title="Ações do painel neste título">
        <MeasuredView m={d.audits}>
          {(audits) =>
            audits.length === 0 ? (
              <p className="ops-muted">nenhuma ação registrada</p>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table" data-table="auditoria-titulo">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Ação</th>
                      <th>Desfecho</th>
                      <th>Detalhe</th>
                      <th>Quem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audits.map((audit) => {
                      const outcome = OUTCOME_LABELS[audit.outcome] ?? { text: audit.outcome, tone: "neutral" as const };
                      return (
                        <tr key={audit.id}>
                          <td className="nowrap">
                            <a href={`/acoes/${audit.id}`}>{formatDateTimeBrt(audit.requestedAt)}</a>
                          </td>
                          <td>{ACTION_KIND_LABELS[audit.actionKind] ?? audit.actionKind}</td>
                          <td>
                            <Badge tone={outcome.tone}>{outcome.text}</Badge>
                          </td>
                          <td>{audit.detail ?? ""}</td>
                          <td>{audit.actorLabel}</td>
                        </tr>
                      );
                    })}
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
