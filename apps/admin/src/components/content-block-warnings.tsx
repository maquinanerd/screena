import type { ReactNode } from "react";

import { previewWarnings, warningsCountLabel } from "../lib/content-block-warnings";

/**
 * content-block-warnings.tsx — Avisos de validacao de UM content_block, em linha
 * compacta (fila de revisao).
 *
 * Server Component puro de apresentacao (SEM `"use server"`, SEM DB, SEM env).
 * Recebe os avisos JA lidos por `parseContentBlockWarnings` na camada server e so
 * os mostra — recortados por `previewWarnings`, com a contagem do que ficou de
 * fora. Sem aviso, nao renderiza nada. O detalhe do bloco mostra a lista inteira.
 */
export function ContentBlockWarningsInline({
  warnings,
}: {
  warnings: readonly string[] | undefined;
}): ReactNode {
  if (warnings === undefined || warnings.length === 0) return null;
  const { shown, hiddenCount } = previewWarnings(warnings);
  return (
    <div className="admin-warnings-inline">
      <span className="admin-warnings-inline__title">
        Avisos da geracao ({warningsCountLabel(warnings.length)}):
      </span>
      <ul className="admin-warnings-inline__list">
        {shown.map((warning, index) => (
          <li className="admin-warnings-inline__item" key={index}>
            {warning}
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <span className="admin-warnings-inline__more">
          +{warningsCountLabel(hiddenCount)} no detalhe do bloco.
        </span>
      ) : null}
    </div>
  );
}
