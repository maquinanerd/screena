import type { ReactNode } from "react";

import type { QaSeverity } from "../../src/lib/content-qa";
import {
  getContentQaData,
  type QaArticleRow,
  type QaBlockRow,
  type QaTypeSummary,
} from "../../src/server/content-qa";

/**
 * QA editorial (/qa) — SOMENTE LEITURA.
 *
 * Diagnostica o que impede conteudo de aparecer/indexar/ter qualidade minima:
 * score geral, contagem por severidade, artigos criticos, visiveis-mas-noindex,
 * prontos para indexar, content blocks com problema e slugs duplicados. Nenhuma
 * escrita: sem `<form>`/`<button>`; as acoes ficam no detalhe (link "Revisar") e
 * no /workflow. `force-dynamic`: le o banco a cada request, nunca no build.
 */
export const dynamic = "force-dynamic";

const SEVERITY_LABEL: Record<QaSeverity, string> = {
  critical: "Criticos",
  warning: "Avisos",
  info: "Informativos",
  success: "Saudaveis",
};

function severityBadge(severity: QaSeverity): "ok" | "hold" | "info" | "blocked" {
  if (severity === "critical") return "blocked";
  if (severity === "warning") return "hold";
  if (severity === "info") return "info";
  return "ok";
}

function combinedSeverity(
  a: Record<QaSeverity, number>,
  b: Record<QaSeverity, number>,
): Record<QaSeverity, number> {
  return {
    critical: a.critical + b.critical,
    warning: a.warning + b.warning,
    info: a.info + b.info,
    success: a.success + b.success,
  };
}

function scoreBand(score: number): string {
  if (score >= 90) return "Bom";
  if (score >= 70) return "Regular";
  return "Precisa de atencao";
}

function SeverityCards({ counts }: { counts: Record<QaSeverity, number> }): ReactNode {
  const order: QaSeverity[] = ["critical", "warning", "info", "success"];
  return (
    <div className="admin-cards">
      {order.map((severity) => (
        <div className={`admin-card admin-qa-sev admin-qa-sev--${severity}`} key={severity}>
          <div className="admin-card__value">{counts[severity]}</div>
          <div className="admin-card__label">{SEVERITY_LABEL[severity]}</div>
        </div>
      ))}
    </div>
  );
}

function ArticleList({ rows }: { rows: readonly QaArticleRow[] }): ReactNode {
  if (rows.length === 0) return <p className="admin-empty">Nada aqui.</p>;
  return (
    <ul className="admin-qa-list">
      {rows.map((row) => (
        <li className="admin-qa-item" key={row.id}>
          <span className="admin-qa-item__score">{row.score}</span>
          <span className="admin-qa-item__label">{row.label}</span>
          <span className={`admin-badge admin-badge--${severityBadge(row.severity)}`}>
            {SEVERITY_LABEL[row.severity]}
          </span>
          <span className="admin-qa-item__reason">{row.primaryIssue ?? "—"}</span>
          <a className="admin-link-action" href={row.href}>
            Revisar
          </a>
        </li>
      ))}
    </ul>
  );
}

function BlockList({ rows }: { rows: readonly QaBlockRow[] }): ReactNode {
  if (rows.length === 0) return <p className="admin-empty">Nada aqui.</p>;
  return (
    <ul className="admin-qa-list">
      {rows.map((row) => (
        <li className="admin-qa-item" key={row.id}>
          <span className="admin-qa-item__score">{row.score}</span>
          <span className="admin-qa-item__label">{row.label}</span>
          <span className={`admin-badge admin-badge--${severityBadge(row.severity)}`}>
            {SEVERITY_LABEL[row.severity]}
          </span>
          <span className="admin-qa-item__reason">{row.primaryIssue ?? "—"}</span>
          <a className="admin-link-action" href={row.href}>
            Revisar
          </a>
        </li>
      ))}
    </ul>
  );
}

function TypeSummary({ title, summary }: { title: string; summary: QaTypeSummary }): ReactNode {
  return (
    <p className="admin-meta">
      {title}: {summary.total} no total, {summary.evaluated} avaliados —{" "}
      {summary.bySeverity.critical} criticos, {summary.bySeverity.warning} avisos,{" "}
      {summary.bySeverity.success} saudaveis.
    </p>
  );
}

export default async function AdminQaPage(): Promise<ReactNode> {
  const data = await getContentQaData();
  const severity = combinedSeverity(data.articles.bySeverity, data.blocks.bySeverity);

  return (
    <>
      <p className="admin-notice">
        <strong>QA editorial.</strong> Diagnostico read-only do que impede conteudo de aparecer,
        indexar ou ter qualidade minima. Avaliacao sobre os {data.window} itens mais recentes de
        cada tipo. As acoes ficam no detalhe (link <strong>Revisar</strong>), no{" "}
        <a href="/workflow">workflow</a> e na <a href="/review-queue">fila de revisao</a>.
      </p>

      <div className="admin-qa-score">
        <span className="admin-qa-score__value">{data.overallScore}</span>
        <span className="admin-qa-score__caption">
          score de QA / 100 — <strong>{scoreBand(data.overallScore)}</strong>
        </span>
      </div>

      <h2 className="admin-section-title">Severidade (artigos + blocos)</h2>
      <SeverityCards counts={severity} />
      <TypeSummary title="Artigos" summary={data.articles} />
      <TypeSummary title="Content blocks" summary={data.blocks} />

      <h2 className="admin-section-title">Artigos criticos ({data.criticalArticles.length})</h2>
      <ArticleList rows={data.criticalArticles} />

      <h2 className="admin-section-title">
        Visiveis, mas noindex ({data.visibleNoindexArticles.length})
      </h2>
      <ArticleList rows={data.visibleNoindexArticles} />

      <h2 className="admin-section-title">Prontos para indexar ({data.indexReadyArticles.length})</h2>
      <ArticleList rows={data.indexReadyArticles} />

      <h2 className="admin-section-title">Content blocks com problema ({data.problemBlocks.length})</h2>
      <BlockList rows={data.problemBlocks} />

      <h2 className="admin-section-title">Slugs duplicados ({data.duplicateSlugs.length})</h2>
      {data.duplicateSlugs.length === 0 ? (
        <p className="admin-empty">Nenhum slug reutilizado entre traducoes.</p>
      ) : (
        <ul className="admin-qa-list">
          {data.duplicateSlugs.map((dup) => (
            <li className="admin-qa-item" key={dup.slug}>
              <span className="admin-qa-item__label">{dup.slug}</span>
              <span className="admin-badge admin-badge--info">{dup.count} traducoes</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
