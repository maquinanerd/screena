import type { ReactNode } from "react";

import { getBulkLimit } from "../lib/editorial-bulk-policy";
import { BulkSelectTable, type BulkSelectItem } from "./bulk-select-table";

/**
 * bulk-action-panel.tsx — Formulario de UMA acao editorial em LOTE (Fase 7C).
 *
 * Server Component puro de apresentacao (SEM `"use server"`, SEM DB, SEM env). Recebe
 * uma Server Action JA LIGADA a `(field, returnTo)` — `runBulkArticleEditorialAction
 * .bind(null, field, returnTo)` — e a repassa a `<form action>`. A validacao, o gate
 * da flag e a escrita (`update` por item, ate `getBulkLimit()`) acontecem no servidor
 * (`editorial-actions.ts` + `editorial-bulk-policy.ts`).
 *
 * So contem: caixas de selecao (via `BulkSelectTable`), um `<select>` de valor
 * restrito aos enums reais, e o botao "Aplicar ação". NAO ha `<input>` de texto,
 * `<textarea>`, upload, editor, botao Excluir nem Publicar automatico. `disabled`
 * desativa o fieldset inteiro (o servidor tambem nega — defesa em profundidade).
 */

export type BulkBoundAction = (formData: FormData) => void | Promise<void>;

interface BulkActionPanelProps {
  /** Server Action ligada a (field, returnTo) via `.bind`. */
  readonly action: BulkBoundAction;
  readonly legend: string;
  readonly description: string;
  /** Rotulo do campo alvo (ex.: `review_status`, `index_status`). */
  readonly fieldLabel: string;
  /** Valores permitidos (enum real do Prisma). */
  readonly valueOptions: readonly string[];
  /** Valor pre-selecionado sugerido. */
  readonly suggestedValue: string;
  readonly items: readonly BulkSelectItem[];
  /** Desabilita o fieldset (flag de acoes desligada). */
  readonly disabled: boolean;
}

export function BulkActionPanel({
  action,
  legend,
  description,
  fieldLabel,
  valueOptions,
  suggestedValue,
  items,
  disabled,
}: BulkActionPanelProps): ReactNode {
  const limit = getBulkLimit();
  const selectId = `bulk-value-${fieldLabel}`;
  return (
    <form action={action} className="admin-bulk-panel">
      <fieldset className="admin-bulk-fieldset" disabled={disabled}>
        <legend className="admin-bulk-legend">{legend}</legend>
        <p className="admin-meta">
          {description} Selecione ate <strong>{limit}</strong> itens por acao.
        </p>
        <BulkSelectTable items={items} />
        <div className="admin-bulk-toolbar">
          <label className="admin-action-label" htmlFor={selectId}>
            Novo {fieldLabel}
          </label>
          <select id={selectId} name="value" className="admin-select" defaultValue={suggestedValue}>
            {valueOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button type="submit" className="admin-btn admin-btn--primary">
            Aplicar ação
          </button>
        </div>
        {disabled ? (
          <p className="admin-meta">Acoes desativadas por ambiente (ADMIN_EDITORIAL_ACTIONS_ENABLED).</p>
        ) : null}
      </fieldset>
    </form>
  );
}
