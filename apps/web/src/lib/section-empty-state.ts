/**
 * section-empty-state.ts — a FRASE que um bloco ausente mostra. PURO.
 *
 * ============================================================================
 * POR QUE EXISTE
 * ============================================================================
 * `section-absence.ts` resolveu metade do problema: a secao some do DOM **e** o
 * motivo vai para o log. Isso protege quem OPERA. Nao faz nada por quem LE.
 *
 * Para 99,8% das fichas o bloco "Onde assistir" nunca aparece, e o leitor nao
 * recebe nem a informacao nem a ausencia dela — recebe silencio, que ele nao
 * tem como distinguir de "esta pagina nao trata disso". Uma pagina que diz
 * "nao encontramos" responde a intencao de busca, ainda que para dizer nao.
 *
 * ============================================================================
 * A REGRA QUE GOVERNA CADA FRASE
 * ============================================================================
 * **A frase so pode afirmar o que a causa sustenta.** Os dois motivos de "onde
 * assistir" sao o caso vivo, e eles se parecem exatamente iguais na tela:
 *
 *   `no_offer_for_entity`      ha oferta exibivel em OUTROS titulos e nenhuma
 *                              neste. Nos temos o dado, e ele diz que o titulo
 *                              nao esta em lugar nenhum. Podemos afirmar sobre
 *                              A OBRA.
 *
 *   `no_authorized_provider`   NENHUMA oferta esta exibivel no catalogo inteiro
 *                              — a cadeia de licenca/promocao nao foi concluida.
 *                              Nao sabemos nada sobre este titulo. Afirmar que
 *                              ele "nao esta em nenhum servico" seria MENTIRA:
 *                              o banco tem 70.036 ofertas com
 *                              `display_allowed = false`.
 *
 * Colapsar os dois numa frase so ("ainda nao confirmamos onde assistir") e o
 * erro que este modulo existe para impedir. A primeira e um fato sobre o filme;
 * a segunda e um fato sobre NOS.
 *
 * ============================================================================
 * O QUE ESTE MODULO NUNCA FAZ
 * ============================================================================
 * Nunca promete dado que a licenca bloqueia, nunca cita servico de streaming
 * sem `watch_availability` confirmada (invariantes 6 e 8), e nunca insinua que
 * a informacao chega "em breve" — prazo que ninguem se comprometeu a cumprir.
 */

import type { SectionAbsenceReason } from "./section-absence";

/** O que o leitor ve no lugar do bloco. */
export interface SectionEmptyState {
  /** Uma frase. Sem titulo proprio: o bloco ja tem rotulo acima dele. */
  readonly text: string;
}

/**
 * A frase de cada motivo, ou `null` quando o bloco deve mesmo sumir calado.
 *
 * `null` NAO e omissao: e a afirmacao de que, para aquela causa, nao ha nada
 * honesto e util a dizer ao leitor. Motivos de CHROME e de ROTA (rodape,
 * trilhos da home) entram aqui — um "ainda nao temos" num trilho de home e
 * ruido, nao informacao.
 *
 * O `switch` e sobre a uniao inteira e o compilador exige o `default`: um
 * motivo novo chega como `null` (silencioso, o comportamento de hoje) em vez de
 * quebrar a pagina — e a decisao de dar-lhe voz fica explicita.
 */
export function emptyStateFor(reason: SectionAbsenceReason): SectionEmptyState | null {
  switch (reason) {
    /* ---------------------------------------------------------------- */
    /* Onde assistir — os DOIS motivos, com frases diferentes            */
    /* ---------------------------------------------------------------- */
    case "no_offer_for_entity":
      // Temos o dado e ele diz que o titulo nao esta em nenhum servico
      // acompanhado. Afirmacao sobre a OBRA, sustentada pela cobertura.
      return {
        text:
          "Não encontramos este título em nenhum serviço de streaming, aluguel " +
          "ou compra no Brasil.",
      };
    case "no_authorized_provider":
      // NAO sabemos nada sobre este titulo. A frase fala de NOS, e nao dele.
      return { text: "Ainda não temos a disponibilidade deste título no Brasil." };

    /* ---------------------------------------------------------------- */
    /* Notas                                                            */
    /* ---------------------------------------------------------------- */
    case "no_authorized_rating":
      // "Ainda nao temos" e nao "este filme nao tem nota": a nota pode existir
      // na fonte e nao ter sido coletada — 0,91% de cobertura em 2026-09-01.
      return { text: "Ainda não temos notas externas para este título." };

    /* ---------------------------------------------------------------- */
    /* Trailer                                                          */
    /* ---------------------------------------------------------------- */
    case "no_season_trailer":
      return { text: "Ainda não temos trailer licenciado para esta temporada." };

    /* ---------------------------------------------------------------- */
    /* O resto continua sumindo calado                                   */
    /* ---------------------------------------------------------------- */
    default:
      return null;
  }
}
