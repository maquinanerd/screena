import type { ReactNode } from "react";

import {
  EditorialActionForm,
  EditorialActionsDisabledNotice,
  EditorialFeedbackBanner,
} from "../../../src/components/editorial-action-form";
import { REVIEW_STATUSES, readActionFeedback } from "../../../src/lib/editorial-action-policy";
import { firstValue, type RawSearchParams } from "../../../src/lib/editorial-filters";
import {
  contentBlockBadgeVariant,
  contentBlockStatusLabel,
  formatIsoDate,
} from "../../../src/lib/editorial-status";
import { getContentBlockDetail } from "../../../src/server/content-blocks";
import { getEditorialActionsStatus } from "../../../src/server/editorial-actions-status";
import { updateContentBlockReviewStatus } from "../../../src/server/editorial-actions";

/**
 * Detalhe de revisao de UM content_block.
 *
 * Diagnostico read-only + UMA acao editorial: alterar `review_status`. O CONTEUDO
 * do bloco NUNCA e editado nesta fase (mostramos so um preview curto e seguro do
 * texto proprio). Sem `<input>`/`<textarea>`; o `<form>`/`<select>` fica no
 * componente `EditorialActionForm`, restrito ao enum real ReviewStatus.
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

export default async function AdminContentBlockDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}): Promise<ReactNode> {
  const { id } = await params;
  const sp = await searchParams;
  const detail = await getContentBlockDetail(id);
  const actions = getEditorialActionsStatus();
  const feedback = readActionFeedback({
    updated: firstValue(sp.updated),
    error: firstValue(sp.error),
  });

  if (detail === null) {
    return (
      <>
        <p className="admin-notice">
          <strong>Content block nao encontrado.</strong> O id informado nao corresponde a nenhum
          bloco.
        </p>
        <p className="admin-meta">
          <a href="/content-blocks">← Voltar para Content blocks</a>
        </p>
      </>
    );
  }

  const rows: DetailRow[] = [
    { label: "Entidade", value: `${detail.entityType}:${detail.entityId}` },
    { label: "Idioma", value: detail.languageCode },
    { label: "block_type", value: <code>{detail.blockType}</code> },
    {
      label: "Classificacao",
      value: (
        <span className={`admin-badge admin-badge--${contentBlockBadgeVariant(detail.status)}`}>
          {contentBlockStatusLabel(detail.status)}
        </span>
      ),
    },
    { label: "review_status", value: <code>{detail.reviewStatus}</code> },
    { label: "Atualizado", value: formatIsoDate(detail.updatedAtIso) },
    { label: "Conteudo (caracteres)", value: detail.contentChars },
  ];

  return (
    <>
      <p className="admin-meta">
        <a href="/content-blocks">← Content blocks</a>
      </p>
      <h2 className="admin-section-title">Revisar content block #{detail.id}</h2>

      <EditorialFeedbackBanner feedback={feedback} />
      {!actions.enabled ? <EditorialActionsDisabledNotice /> : null}

      <h3 className="admin-detail-heading">Dados do bloco</h3>
      <DetailList rows={rows} />

      <h3 className="admin-detail-heading">Preview do conteudo</h3>
      <p className="admin-preview-box">{detail.preview.length > 0 ? detail.preview : "(vazio)"}</p>
      <p className="admin-meta">
        Preview curto e somente leitura do texto proprio — o conteudo do bloco nao e editado
        nesta fase.
      </p>

      <h3 className="admin-detail-heading">Acoes editoriais</h3>
      <p className="admin-meta">
        Somente <code>review_status</code> pode ser alterado. Nao ha criacao, exclusao nem edicao
        de conteudo do bloco.
      </p>

      <EditorialActionForm
        action={updateContentBlockReviewStatus.bind(null, detail.id)}
        fieldName="reviewStatus"
        legend="Status de revisao (review_status)"
        current={detail.reviewStatus}
        options={REVIEW_STATUSES}
        disabled={!actions.enabled}
        help="Valores do enum ReviewStatus."
      />
    </>
  );
}
