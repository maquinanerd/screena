import type { ReactNode } from "react";

import {
  BulkActionPanel,
  type BulkBoundAction,
} from "../../src/components/bulk-action-panel";
import {
  EditorialActionsDisabledNotice,
  EditorialFeedbackBanner,
} from "../../src/components/editorial-action-form";
import { readBulkFeedback } from "../../src/lib/editorial-bulk-policy";
import { firstValue, type RawSearchParams } from "../../src/lib/editorial-filters";
import { getEditorialActionsStatus } from "../../src/server/editorial-actions-status";
import {
  runBulkArticleEditorialAction,
  runBulkContentBlockEditorialAction,
} from "../../src/server/editorial-actions";
import {
  getEditorialWorkflowData,
  type WorkflowBulkConfig,
  type WorkflowItem,
  type WorkflowSection,
} from "../../src/server/editorial-workflow";

/**
 * Workflow editorial (/workflow) — visao operacional com ACOES EM LOTE controladas.
 *
 * Read model somente leitura (`editorial-workflow.ts`); as acoes sao delegadas as
 * Server Actions allowlisted (`editorial-actions.ts`), ate 20 itens por vez, atras
 * da flag ADMIN_EDITORIAL_ACTIONS_ENABLED. Sem `<form>`/`<input>` cru na pagina
 * (ficam no `BulkActionPanel`); nenhuma edicao de conteudo, upload ou publicacao
 * automatica. `force-dynamic`: le o banco a cada request, nunca no build.
 */
export const dynamic = "force-dynamic";

const RETURN_TO = "/workflow";

function fieldLabel(field: "reviewStatus" | "indexStatus"): string {
  return field === "indexStatus" ? "index_status" : "review_status";
}

function boundActionFor(bulk: WorkflowBulkConfig): BulkBoundAction {
  if (bulk.model === "contentBlock") {
    return runBulkContentBlockEditorialAction.bind(null, RETURN_TO);
  }
  return runBulkArticleEditorialAction.bind(null, bulk.field, RETURN_TO);
}

function ReadOnlyList({ items }: { items: readonly WorkflowItem[] }): ReactNode {
  if (items.length === 0) return <p className="admin-empty">Nada nesta fila.</p>;
  return (
    <ul className="admin-queue-list">
      {items.map((item) => (
        <li className="admin-queue-item" key={`${item.kind}-${item.id}`}>
          <span className="admin-queue-item__label">{item.label}</span>
          <span className={`admin-badge admin-badge--${item.badgeVariant}`}>{item.statusLabel}</span>
          <span className="admin-queue-item__reason">{item.primaryIssue ?? "—"}</span>
          <a className="admin-link-action" href={item.href}>
            Revisar
          </a>
        </li>
      ))}
    </ul>
  );
}

function SectionView({
  section,
  disabled,
}: {
  section: WorkflowSection;
  disabled: boolean;
}): ReactNode {
  const bulk = section.bulk;
  return (
    <section className="admin-workflow-section">
      <h3 className="admin-queue-section__title">
        {section.title} <span className="admin-queue-section__count">({section.shown})</span>
      </h3>
      {section.capped ? (
        <p className="admin-meta">Mostrando os mais recentes (ha mais itens do que o limite lido).</p>
      ) : null}

      {bulk === null ? (
        <>
          <p className="admin-meta">{section.description}</p>
          <ReadOnlyList items={section.items} />
        </>
      ) : (
        <BulkActionPanel
          action={boundActionFor(bulk)}
          legend={`Aplicar em lote: ${fieldLabel(bulk.field)}`}
          description={section.description}
          fieldLabel={fieldLabel(bulk.field)}
          valueOptions={bulk.valueOptions}
          suggestedValue={bulk.suggestedValue}
          items={section.items}
          disabled={disabled}
        />
      )}
    </section>
  );
}

export default async function AdminWorkflowPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const data = await getEditorialWorkflowData();
  const actions = getEditorialActionsStatus();
  const feedback = readBulkFeedback({
    bulk_updated: firstValue(sp.bulk_updated),
    error: firstValue(sp.error),
    ok: firstValue(sp.ok),
    fail: firstValue(sp.fail),
  });

  return (
    <>
      <p className="admin-notice">
        <strong>Workflow editorial.</strong> Visao operacional para decidir e agir em lote pequeno
        (ate {data.limit} por seccao, no maximo 20 por acao). As acoes exigem
        <code> ADMIN_EDITORIAL_ACTIONS_ENABLED=true</code> e passam pela mesma allowlist de escrita.
        Veja tambem a <a href="/review-queue">fila de revisao</a>.
      </p>

      <EditorialFeedbackBanner feedback={feedback} />
      {!actions.enabled ? <EditorialActionsDisabledNotice /> : null}

      {data.sections.map((section) => (
        <SectionView key={section.key} section={section} disabled={!actions.enabled} />
      ))}

      <section className="admin-workflow-section">
        <h3 className="admin-queue-section__title">Acoes em lote disponiveis</h3>
        <ul className="admin-meta">
          <li>Marcar artigos selecionados com um review_status (ex.: human_reviewed).</li>
          <li>Alterar o index_status de artigos selecionados (ex.: index).</li>
          <li>Marcar content blocks selecionados com um review_status.</li>
        </ul>
        <p className="admin-meta">
          Titulo, slug, corpo, conteudo, publishedAt, licenca e display nunca sao alterados aqui.
        </p>
      </section>
    </>
  );
}
