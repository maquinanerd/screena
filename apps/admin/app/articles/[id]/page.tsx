import type { ReactNode } from "react";

import {
  EditorialActionForm,
  EditorialActionsDisabledNotice,
  EditorialFeedbackBanner,
} from "../../../src/components/editorial-action-form";
import {
  INDEX_DECISIONS,
  REVIEW_STATUSES,
  readActionFeedback,
} from "../../../src/lib/editorial-action-policy";
import { firstValue, type RawSearchParams } from "../../../src/lib/editorial-filters";
import { articleBadgeVariant, articleStatusLabel, formatIsoDate } from "../../../src/lib/editorial-status";
import {
  articleReadinessLabel,
  evaluateArticlePublicReadiness,
  readinessBadgeVariant,
} from "../../../src/lib/public-readiness";
import { getArticleDetail } from "../../../src/server/articles";
import { getEditorialActionsStatus } from "../../../src/server/editorial-actions-status";
import {
  updateArticleIndexStatus,
  updateArticleReviewStatus,
} from "../../../src/server/editorial-actions";

/**
 * Detalhe de revisao de UMA versao de artigo (article_translations).
 *
 * Diagnostico read-only da versao + acoes editoriais CONTROLADAS: alterar
 * `review_status` e `index_status`. NAO ha edicao de titulo/slug/corpo (sem
 * `<input>`/`<textarea>`): os `<form>`/`<select>` vivem no componente
 * `EditorialActionForm`, restritos aos enums reais. `display_allowed` e
 * `licenseStatus` (do `Article` pai) sao exibidos SOMENTE LEITURA — decisao de
 * licenca/exibicao e revisao humana separada, fora do escopo desta fase.
 * `publishedAt` e mostrado, nunca editado (o admin nao publica automaticamente).
 *
 * `force-dynamic`: le o banco a cada request, nunca no build.
 */
export const dynamic = "force-dynamic";

interface DetailRow {
  label: string;
  value: ReactNode;
}

function DetailList({ rows }: { rows: DetailRow[] }): ReactNode {
  return (
    <dl className="admin-detail-list">
      {rows.map((row) => (
        <div className="admin-detail-list__row" key={row.label}>
          <dt className="admin-detail-list__term">{row.label}</dt>
          <dd className="admin-detail-list__desc">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AdminArticleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}): Promise<ReactNode> {
  const { id } = await params;
  const sp = await searchParams;
  const detail = await getArticleDetail(id);
  const actions = getEditorialActionsStatus();
  const feedback = readActionFeedback({
    updated: firstValue(sp.updated),
    error: firstValue(sp.error),
  });

  if (detail === null) {
    return (
      <>
        <p className="admin-notice">
          <strong>Versao de artigo nao encontrada.</strong> O id informado nao corresponde a
          nenhuma versao (article_translations).
        </p>
        <p className="admin-meta">
          <a href="/articles">← Voltar para Artigos</a>
        </p>
      </>
    );
  }

  const readiness = evaluateArticlePublicReadiness({
    reviewStatus: detail.reviewStatus,
    licenseStatus: detail.licenseStatus,
    displayAllowed: detail.displayAllowed,
    slug: detail.slug,
    title: detail.title,
    publishedAtIso: detail.publishedAtIso,
    bodyChars: detail.bodyChars,
    indexStatus: detail.indexStatus,
    languageCode: detail.languageCode,
  }, new Date().toISOString());

  const rows: DetailRow[] = [
    { label: "Titulo", value: detail.title },
    { label: "Slug", value: detail.slug },
    { label: "Idioma", value: detail.languageCode },
    {
      label: "Classificacao",
      value: (
        <span className={`admin-badge admin-badge--${articleBadgeVariant(detail.status)}`}>
          {articleStatusLabel(detail.status)}
        </span>
      ),
    },
    { label: "review_status", value: <code>{detail.reviewStatus}</code> },
    { label: "index_status", value: <code>{detail.indexStatus}</code> },
    { label: "license_status (Article)", value: <code>{detail.licenseStatus}</code> },
    { label: "display_allowed (Article, so leitura)", value: detail.displayAllowed ? "sim" : "nao" },
    { label: "Publicado", value: formatIsoDate(detail.publishedAtIso) },
    { label: "Atualizado", value: formatIsoDate(detail.updatedAtIso) },
    { label: "Corpo (caracteres)", value: detail.bodyChars },
    {
      label: "Lacunas",
      value: detail.issues.length > 0 ? detail.issues.join(", ") : "—",
    },
    {
      label: "Link publico",
      value:
        detail.publicUrl !== null ? (
          <a href={detail.publicUrl} target="_blank" rel="noreferrer">
            {detail.publicUrl}
          </a>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <>
      <p className="admin-meta">
        <a href="/articles">← Artigos</a>
      </p>
      <h2 className="admin-section-title">Revisar versao de artigo #{detail.id}</h2>

      <EditorialFeedbackBanner feedback={feedback} />
      {!actions.enabled ? <EditorialActionsDisabledNotice /> : null}

      <h3 className="admin-detail-heading">Dados da versao</h3>
      <DetailList rows={rows} />

      <h3 className="admin-detail-heading">Preview público</h3>
      <div className={`admin-readiness admin-readiness--${readiness.level}`}>
        <span className={`admin-badge admin-badge--${readinessBadgeVariant(readiness.level)}`}>
          {articleReadinessLabel(readiness.level)}
        </span>
        <span className="admin-readiness__flag">
          Exibicao publica: <strong>{readiness.canDisplay ? "sim" : "nao"}</strong>
        </span>
        <span className="admin-readiness__flag">
          Indexacao: <strong>{readiness.canIndex ? "sim" : "nao"}</strong>
        </span>
      </div>

      <p className="admin-readiness__url-label">URL publica calculada</p>
      {readiness.publicUrl !== null ? (
        <p className="admin-public-url">
          <a href={readiness.publicUrl} target="_blank" rel="noreferrer">
            {readiness.publicUrl}
          </a>
        </p>
      ) : (
        <p className="admin-meta">
          Sem URL publica (idioma nao-pt-BR ou slug ausente/invalido). Nao ha rota publica.
        </p>
      )}

      {readiness.issues.length > 0 ? (
        <>
          <p className="admin-readiness__url-label">Problemas ({readiness.issues.length})</p>
          <ul className="admin-issue-list">
            {readiness.issues.map((issue) => (
              <li className="admin-issue-list__item" key={issue}>
                {issue}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="admin-meta">Sem problemas — pronto para exibir e indexar.</p>
      )}

      <p className="admin-readiness__url-label">Campos usados na decisao</p>
      <DetailList
        rows={[
          { label: "review_status", value: <code>{detail.reviewStatus}</code> },
          { label: "license_status", value: <code>{detail.licenseStatus}</code> },
          { label: "display_allowed", value: detail.displayAllowed ? "sim" : "nao" },
          { label: "index_status", value: <code>{detail.indexStatus}</code> },
          { label: "idioma", value: detail.languageCode },
          { label: "slug", value: detail.slug.trim() !== "" ? "presente" : "ausente" },
          { label: "titulo", value: detail.title.trim() !== "" ? "presente" : "ausente" },
          { label: "publishedAt", value: detail.publishedAtIso !== null ? "presente" : "ausente" },
          { label: "corpo (caracteres)", value: detail.bodyChars },
        ]}
      />

      <h3 className="admin-detail-heading">Acoes editoriais</h3>
      <p className="admin-meta">
        Somente <code>review_status</code> e <code>index_status</code> podem ser alterados aqui.
        Titulo, slug e corpo nao sao editaveis nesta fase; a publicacao (publishedAt) nao e
        carimbada automaticamente.
      </p>

      <EditorialActionForm
        action={updateArticleReviewStatus.bind(null, detail.id)}
        fieldName="reviewStatus"
        legend="Status de revisao (review_status)"
        current={detail.reviewStatus}
        options={REVIEW_STATUSES}
        disabled={!actions.enabled}
        help="Valores do enum ReviewStatus. Marcar 'published' e uma decisao humana explicita."
      />

      <EditorialActionForm
        action={updateArticleIndexStatus.bind(null, detail.id)}
        fieldName="indexStatus"
        legend="Indexacao (index_status)"
        current={detail.indexStatus}
        options={INDEX_DECISIONS}
        disabled={!actions.enabled}
        help="Valores do enum IndexDecision. A decisao de indexar continua sujeita ao gate anti-thin no render publico."
      />
    </>
  );
}
