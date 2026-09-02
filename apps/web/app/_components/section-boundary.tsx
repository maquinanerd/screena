import type { ReactNode } from "react";

import {
  formatSectionAbsence,
  type SectionDecision,
} from "../../src/lib/section-absence";
import { emptyStateFor } from "../../src/lib/section-empty-state";

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

/**
 * Ausencias ja registradas nesta instancia do servidor, para `once`.
 *
 * Chave = `section|reason`, nao o evento inteiro: o que define "e a mesma
 * ausencia" e a CAUSA, e um formato de chrome nao carrega entidade nem rota para
 * variar. Uma segunda causa no mesmo bloco continua sendo logada.
 */
const loggedOnce = new Set<string>();

interface SectionBoundaryProps<T> {
  decision: SectionDecision<T>;
  /**
   * Loga UMA vez por processo, em vez de uma por request.
   *
   * Para blocos de CHROME. O rodape renderiza em toda pagina, entao uma ausencia
   * constante (uma flag desligada, uma tabela que nao existe) emitiria uma linha
   * por pageview — e o proprio contrato de `section-absence.ts` avisa que ruido
   * assim "afogaria o unico evento que importa". A causa aqui e uma propriedade
   * do DEPLOY, nao do request: repetir nao acrescenta informacao.
   *
   * NAO usar em bloco de entidade: la a repeticao carrega informacao (QUAL
   * titulo), e silenciar apagaria justamente o que o operador precisa.
   *
   * Default `false` — o comportamento de todos os blocos existentes nao muda.
   */
  once?: boolean;
  /**
   * MOSTRA a ausencia ao leitor, em vez de so registra-la.
   *
   * A regra original — "a secao sai do DOM e o motivo vai para o log" —
   * protegia quem OPERA e nao fazia nada por quem LE. Para 99,8% das fichas o
   * bloco "Onde assistir" nunca aparecia, e o leitor recebia silencio, que ele
   * nao distingue de "esta pagina nao trata disso".
   *
   * Com `speak`, o bloco continua sem o CONTEUDO (nenhum placeholder, nenhuma
   * promessa) e ganha UMA FRASE que so afirma o que a causa sustenta — a frase
   * vem de `emptyStateFor`, que separa "este titulo nao esta em lugar nenhum"
   * de "nos ainda nao liberamos ninguem". Ver `section-empty-state.ts`.
   *
   * O log NAO muda: ele sai igual, com ou sem `speak`. As duas metades da regra
   * continuam sendo a mesma linha.
   *
   * Motivo sem frase (`emptyStateFor` devolve `null`) volta ao comportamento de
   * hoje — sumir calado. `speak` e um pedido, nao uma garantia.
   */
  speak?: boolean;
  /** Recebe o valor JA garantido presente pelo tipo — nunca precisa checar. */
  children: (value: T) => ReactNode;
}

export function SectionBoundary<T>({
  decision,
  once = false,
  speak = false,
  children,
}: SectionBoundaryProps<T>): ReactNode {
  if (decision.rendered) return children(decision.value);

  // A ausencia nunca e muda. Em producao isto e a UNICA evidencia de que o
  // bloco existia e nao acendeu.
  //
  // `once` suprime a REPETICAO do log, nunca o aviso de dev abaixo: quem esta
  // montando a pagina precisa ver o buraco em TODA renderizacao, senao ele
  // aparece na primeira e some nas seguintes — pior que nao existir.
  const key = `${decision.absence.section}|${decision.absence.reason}`;
  // So o modo `once` alimenta o cache. Se um bloco sem `once` marcasse a chave,
  // ele silenciaria um bloco `once` que aparecesse depois — acoplamento entre
  // dois chamadores que nao se conhecem.
  const jaRegistrado = once && loggedOnce.has(key);
  if (once) loggedOnce.add(key);
  if (!jaRegistrado) console.warn(formatSectionAbsence(decision.absence));

  // A FRASE para o leitor, quando o bloco pediu voz e a causa comporta uma.
  // Vem DEPOIS do log de proposito: falar com o leitor nunca substitui falar
  // com quem opera.
  const spoken = speak ? emptyStateFor(decision.absence.reason) : null;
  if (spoken !== null) {
    return (
      <p
        className="section-empty"
        data-section-empty={decision.absence.section}
        data-section-empty-reason={decision.absence.reason}
      >
        {spoken.text}
      </p>
    );
  }

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
