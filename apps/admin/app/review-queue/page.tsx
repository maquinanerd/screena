import type { ReactNode } from "react";

import { BulkActionPanel, type BulkBoundAction } from "../../src/components/bulk-action-panel";
import {
  EditorialActionsDisabledNotice,
  EditorialFeedbackBanner,
} from "../../src/components/editorial-action-form";
import { REVIEW_STATUSES } from "../../src/lib/editorial-action-policy";
import { readBulkFeedback } from "../../src/lib/editorial-bulk-policy";
import { firstValue, type RawSearchParams } from "../../src/lib/editorial-filters";
import { getEditorialActionsStatus } from "../../src/server/editorial-actions-status";
import {
  runBulkArticleEditorialAction,
  runBulkContentBlockEditorialAction,
} from "../../src/server/editorial-actions";
import { getReviewQueueData, type QueueItem, type QueueSection } from "../../src/server/review-queue";

/**
 * Fila editorial (/review-queue).
 *
 * Read model somente leitura (`review-queue.ts`); as seccoes PENDENTES ganham uma
 * acao em lote controlada (marcar review_status dos selecionados), delegada as
 * Server Actions allowlisted, ate 20 itens, atras da flag
 * ADMIN_EDITORIAL_ACTIONS_ENABLED. Demais seccoes seguem read-only. Sem `<form>`/
 * `<input>` cru na pagina (ficam no `BulkActionPanel`). `force-dynamic`.
 */
export const dynamic = "force-dynamic";

const RETURN_TO = "/review-queue";

/** Seccoes que recebem acao em lote (review_status dos pendentes). */
const BULK_REVIEW_SECTIONS = new Set(["articles_pending", "blocks_pending"]);

function toBulkItems(items: readonly QueueItem[]) {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    badgeVariant: item.badgeVariant,
    statusLabel: item.levelLabel,
    primaryIssue: item.primaryIssue,
    href: item.href,
  }));
}

function boundActionForSection(key: string): BulkBoundAction {
  if (key === "blocks_pending") {
    return runBulkContentBlockEditorialAction.bind(null, RETURN_TO);
  }
  return runBulkArticleEditorialAction.bind(null, "reviewStatus", RETURN_TO);
}

function ReadOnlyList({ items }: { items: readonly QueueItem[] }): ReactNode {
  return (
    <ul className="admin-queue-list">
      {items.map((item) => (
        <li className="admin-queue-item" key={`${item.kind}-${item.id}`}>
          <span className="admin-queue-item__label">{item.label}</span>
          <span className={`admin-badge admin-badge--${item.badgeVariant}`}>{item.levelLabel}</span>
          <span className="admin-queue-item__reason">{item.primaryIssue ?? "—"}</span>
          <a className="admin-link-action" href={item.href}>
            Revisar
          </a>
        </li>
      ))}
    </ul>
  );
}

function Section({ section, disabled }: { section: QueueSection; disabled: boolean }): ReactNode {
  const isBulk = BULK_REVIEW_SECTIONS.has(section.key);
  return (
    <section className="admin-queue-section">
      <h3 className="admin-queue-section__title">
        {section.title} <span className="admin-queue-section__count">({section.shown})</span>
      </h3>
      {section.capped ? (
        <p className="admin-meta">Mostrando os mais recentes (ha mais itens do que o limite lido).</p>
      ) : null}

      {section.items.length === 0 ? (
        <p className="admin-empty">Nada nesta fila.</p>
      ) : isBulk ? (
        <BulkActionPanel
          action={boundActionForSection(section.key)}
          legend="Aplicar em lote: review_status"
          description="Marque os selecionados com um review_status."
          fieldLabel="review_status"
          valueOptions={REVIEW_STATUSES}
          suggestedValue="human_reviewed"
          items={toBulkItems(section.items)}
          disabled={disabled}
        />
      ) : (
        <ReadOnlyList items={section.items} />
      )}
    </section>
  );
}

export default async function AdminReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const data = await getReviewQueueData();
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
        <strong>Fila de revisao.</strong> Diagnostico do que esta bloqueado, do que aguarda revisao
        e do que ja pode indexar. As seccoes pendentes permitem uma acao em lote (ate 20). Para o
        fluxo operacional completo, veja o <a href="/workflow">workflow editorial</a>.
      </p>

      <EditorialFeedbackBanner feedback={feedback} />
      {!actions.enabled ? <EditorialActionsDisabledNotice /> : null}

      {data.sections.map((section) => (
        <Section key={section.key} section={section} disabled={!actions.enabled} />
      ))}
    </>
  );
}
