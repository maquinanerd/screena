import type { ReactNode } from "react";

import {
  formatSectionAbsence,
  type SectionDecision,
} from "../../src/lib/section-absence";

/**
 * SectionBoundary — o unico lugar onde um bloco do canonico pode deixar de
 * renderizar.
 *
 * POR QUE ELE EXISTE, EM VEZ DE UM `{x !== null ? <Bloco/> : null}` NA PAGINA.
 * Porque a regra tem DUAS metades ("a secao sai do DOM" **e** "o motivo vai
 * para o log") e um ternario so cumpre a primeira. Escritas em pontos
 * diferentes, as duas divergem no primeiro refactor: alguem move o bloco,
 * esquece o log, e a ausencia volta a ser muda — que e o defeito que este
 * componente existe para impedir.
 *
 * Aqui elas sao a MESMA linha. Ou o bloco renderiza, ou a linha de log sai.
 * Nao ha caminho que produza nenhuma das duas.
 *
 * Server Component: o `console.warn` roda no servidor, uma vez por request, e
 * vai para stdout (o coletor do container). Nada disso chega ao cliente.
 */

interface SectionBoundaryProps<T> {
  decision: SectionDecision<T>;
  /** Recebe o valor JA garantido presente pelo tipo — nunca precisa checar. */
  children: (value: T) => ReactNode;
}

export function SectionBoundary<T>({
  decision,
  children,
}: SectionBoundaryProps<T>): ReactNode {
  if (decision.rendered) return children(decision.value);

  // A ausencia nunca e muda. Em producao isto e a UNICA evidencia de que o
  // bloco existia e nao acendeu.
  console.warn(formatSectionAbsence(decision.absence));

  // Em desenvolvimento, alem do log, um aviso VISIVEL: quem esta montando a
  // pagina precisa ver o buraco sem ir ao terminal. Em producao nao ha nada no
  // DOM — o leitor jamais ve andaime.
  if (process.env.NODE_ENV === "production") return null;

  return (
    <p
      className="section-absent-dev"
      data-section-absent={decision.absence.section}
      data-section-absent-reason={decision.absence.reason}
    >
      <strong>[dev]</strong> bloco <code>{decision.absence.section}</code> não
      renderizou: <code>{decision.absence.reason}</code>
      {decision.absence.actionable ? " — depende de operação/decisão pendente" : null}
    </p>
  );
}
