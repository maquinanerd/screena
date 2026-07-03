import type { ReactNode } from "react";

import { getReviewQueueData, type QueueSection } from "../../src/server/review-queue";

/**
 * Fila editorial (/review-queue) — SOMENTE LEITURA.
 *
 * Orienta o editor sobre o que esta bloqueado, o que aguarda revisao e o que ja
 * esta pronto para indexar. Cada item leva ao detalhe (link "Revisar"), onde as
 * acoes editoriais controladas acontecem. Nenhuma escrita aqui; sem `<form>`/
 * `<button>`. `force-dynamic`: le o banco a cada request, nunca no build.
 */
export const dynamic = "force-dynamic";

function Section({ section }: { section: QueueSection }): ReactNode {
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
      ) : (
        <ul className="admin-queue-list">
          {section.items.map((item) => (
            <li className="admin-queue-item" key={`${item.kind}-${item.id}`}>
              <span className="admin-queue-item__label">{item.label}</span>
              <span className={`admin-badge admin-badge--${item.badgeVariant}`}>
                {item.levelLabel}
              </span>
              <span className="admin-queue-item__reason">{item.primaryIssue ?? "—"}</span>
              <a className="admin-link-action" href={item.href}>
                Revisar
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function AdminReviewQueuePage(): Promise<ReactNode> {
  const data = await getReviewQueueData();

  return (
    <>
      <p className="admin-notice">
        <strong>Fila de revisao.</strong> Diagnostico read-only do que esta bloqueado, do que
        aguarda revisao e do que ja pode indexar. As acoes editoriais controladas ficam no detalhe
        (link <strong>Revisar</strong>). Listas limitadas aos {data.limit} itens mais recentes por
        seccao.
      </p>

      {data.sections.map((section) => (
        <Section key={section.key} section={section} />
      ))}
    </>
  );
}
