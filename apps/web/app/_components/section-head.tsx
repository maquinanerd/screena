import type { ReactNode } from "react";

import { isRedundantGroupLabel } from "../../src/lib/group-label-rule";

/**
 * SectionHead — o cabeçalho de seção das páginas de detalhe, com a regra do
 * rótulo redundante APLICADA NA ORIGEM.
 *
 * O dono riscou a sobrancelha que repete o título ("— ELENCO" acima de
 * "ELENCO PRINCIPAL", "— DETALHES" acima de "DETALHES"). O conserto não é
 * seção por seção: este componente é quem emite a sobrancelha, e ele NÃO
 * ACEITA valor redundante — `isRedundantGroupLabel` (a mesma regra do rodapé)
 * decide, e um kicker igual/prefixo do título simplesmente não renderiza. O
 * traço decorativo sai junto: não existe hífen órfão sem texto.
 *
 * Kicker que INFORMA fica: "Editorial" acima de "Notícias e bastidores" e
 * "Descoberta" acima de "Mais como este" dizem o que o título não diz.
 *
 * Travado por `group-label-redundancy.test.tsx` (a mesma suíte do rodapé).
 */

export interface SectionHeadProps {
  /** id do `<h2>`, para `aria-labelledby` da `<section>`. */
  readonly headingId: string;
  /**
   * Sobrancelha opcional. Se repetir (igual/prefixo) o título, NÃO renderiza —
   * regra na origem, nunca confiança no call site.
   */
  readonly kicker?: string;
  /** Primeira palavra do título (peso 800 no canônico). */
  readonly title: string;
  /** Restante do título (peso 300). Opcional. */
  readonly thin?: string;
}

export function SectionHead({ headingId, kicker, title, thin }: SectionHeadProps): ReactNode {
  const fullTitle = thin === undefined ? title : `${title} ${thin}`;
  const kickerRenders =
    kicker !== undefined && kicker.trim() !== "" && !isRedundantGroupLabel(kicker, fullTitle);

  return (
    <div>
      {kickerRenders ? (
        <div className="eyebrow-bar">
          <span>{kicker}</span>
        </div>
      ) : null}
      <h2 className="detail-section-title" id={headingId}>
        {title}
        {thin !== undefined ? (
          <>
            {" "}
            <span className="thin">{thin}</span>
          </>
        ) : null}
      </h2>
    </div>
  );
}
