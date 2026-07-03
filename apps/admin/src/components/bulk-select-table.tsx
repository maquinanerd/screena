import type { ReactNode } from "react";

/**
 * bulk-select-table.tsx — Lista de itens selecionaveis para acao em lote (Fase 7C).
 *
 * Server Component puro de apresentacao (SEM `"use server"`, SEM DB, SEM env, SEM
 * rede). Renderiza UMA linha por item com um `<input type="checkbox" name="ids">`
 * (o unico `<input>` permitido: caixa de selecao, nunca texto livre). Fica DENTRO
 * do `<form>` do `BulkActionPanel`, entao as caixas marcadas viram
 * `formData.getAll("ids")`. Sem campo de titulo/slug/corpo, sem upload.
 */

export interface BulkSelectItem {
  readonly id: string;
  readonly label: string;
  readonly badgeVariant: string;
  readonly statusLabel: string;
  readonly primaryIssue: string | null;
  readonly href: string;
}

export function BulkSelectTable({ items }: { items: readonly BulkSelectItem[] }): ReactNode {
  if (items.length === 0) {
    return <p className="admin-empty">Nada nesta fila.</p>;
  }
  return (
    <ul className="admin-bulk-list">
      {items.map((item) => (
        <li className="admin-bulk-row" key={item.id}>
          <label className="admin-bulk-check">
            <input type="checkbox" name="ids" value={item.id} className="admin-checkbox" />
            <span className="admin-bulk-row__label">{item.label}</span>
          </label>
          <span className={`admin-badge admin-badge--${item.badgeVariant}`}>{item.statusLabel}</span>
          <span className="admin-bulk-row__reason">{item.primaryIssue ?? "—"}</span>
          <a className="admin-link-action" href={item.href}>
            Revisar
          </a>
        </li>
      ))}
    </ul>
  );
}
