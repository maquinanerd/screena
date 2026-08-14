/**
 * awards-presenter.ts — A frase de premios da faixa do canonico, em pt-BR.
 * PURO: sem rede/DB/IO e sem `Date`.
 *
 * O RECONHECEDOR NAO MORA MAIS AQUI. Ele subiu para
 * `@screena/schemas` (`omdb-awards.ts`) porque passou a ter dois consumidores
 * que nao podem divergir: o worker que promove o literal de `api_cache` para o
 * dominio e esta tela. O que ficou aqui e o que e de APRESENTACAO: transformar
 * a estrutura reconhecida em portugues.
 *
 * A REGRA DA TRADUCAO — a unica que importa neste arquivo
 * ------------------------------------------------------
 * **O nome do premio e fato da fonte; a estrutura da frase e nossa.**
 *
 *   "Won 4 Oscars"              -> "Venceu 4 Oscars"
 *   "Won 1 Oscar"               -> "Venceu 1 Oscar"
 *   "Nominated for 3 Oscars"    -> "Concorreu a 3 Oscars"
 *   "Won 2 Primetime Emmys"     -> "Venceu 2 Primetime Emmys"
 *   "1 BAFTA Film Award"        -> o nome sai identico, sempre
 *
 * `Oscars` continua `Oscars`. Nao traduzimos, nao expandimos sigla, nao
 * "corrigimos" para o nome em portugues: um premio chamado de outro jeito e
 * outro premio. O nome vem VERBATIM do reconhecedor e atravessa este modulo sem
 * ser tocado — travado por teste literal.
 *
 * POR QUE "Concorreu a" E NAO "Indicado a"
 * ----------------------------------------
 * "Indicado" concorda em genero com o sujeito: um FILME e indicado, uma SERIE e
 * indicada. A faixa e a mesma nas duas verticais, e escolher um genero fixo
 * erraria metade do catalogo. "Concorreu a" e verbo, nao flexiona, e diz
 * exatamente o que "Nominated for" diz.
 */

import { parseOmdbAwards, type OmdbAwards } from "@screena/schemas";

export {
  parseOmdbAwards,
  type AwardsHighlight,
  type AwardsOutcome,
  type AwardsRejectionReason,
  type OmdbAwards,
  type OmdbAwardsParse,
} from "@screena/schemas";

/** Contagem agregada ja escrita em pt-BR. */
export interface AwardsTallyView {
  readonly wins: number | null;
  readonly nominations: number | null;
  /** "160 vitórias · 220 indicações"; `null` quando nao ha contagem nenhuma. */
  readonly label: string | null;
}

/**
 * Atribuicao exigida pela licenca da fonte do fato.
 *
 * Vive AQUI, e nao no componente, porque o caminho de leitura (`entity-awards.ts`)
 * precisa do tipo e o typecheck da raiz nao compila `.tsx` — importar o tipo do
 * componente derrubaria `pnpm typecheck` inteiro.
 */
export interface AwardsCredit {
  /** `source_licenses.attribution_text`. Sem ele nao ha faixa. */
  readonly text: string;
  /** Linkback, quando a licenca o exige/permite. */
  readonly url: string | null;
}

export interface AwardsView {
  /**
   * O destaque em pt-BR, com o NOME DO PREMIO VERBATIM ("Venceu 4 Oscars").
   * `null` quando a frase so traz a contagem agregada.
   */
  readonly headline: string | null;
  readonly tally: AwardsTallyView;
}

/** Milhar com ponto (pt-BR), sem `Intl` (deterministico entre runtimes). */
function formatCount(value: number): string {
  const digits = String(value);
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ".";
  }
  return out;
}

/** "8 vitórias · 51 indicações", com singular correto. `null` se nao ha nada. */
function tallyLabel(wins: number | null, nominations: number | null): string | null {
  const parts: string[] = [];
  if (wins !== null) {
    parts.push(`${formatCount(wins)} ${wins === 1 ? "vitória" : "vitórias"}`);
  }
  if (nominations !== null) {
    parts.push(`${formatCount(nominations)} ${nominations === 1 ? "indicação" : "indicações"}`);
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * Compoe a faixa a partir da estrutura reconhecida.
 *
 * O nome do premio entra por interpolacao direta, sem passar por nenhuma tabela
 * de traducao — nao existe uma, de proposito.
 */
export function buildAwardsView(awards: OmdbAwards): AwardsView {
  const highlight = awards.highlight;
  const headline =
    highlight === null
      ? null
      : `${highlight.outcome === "won" ? "Venceu" : "Concorreu a"} ${formatCount(
          highlight.count,
        )} ${highlight.awardName}`;

  return {
    headline,
    tally: {
      wins: awards.tally.wins,
      nominations: awards.tally.nominations,
      label: tallyLabel(awards.tally.wins, awards.tally.nominations),
    },
  };
}

/**
 * Atalho literal -> faixa, para quem tem a string bruta na mao (o caminho de
 * leitura guarda a estrutura, entao usa `buildAwardsView` direto).
 *
 * Devolve `null` quando a frase e recusada — e o chamador registra o motivo. A
 * ausencia NAO e muda em lugar nenhum: ver `section-absence.ts`.
 */
export function buildAwardsViewFromRaw(raw: unknown): AwardsView | null {
  const parsed = parseOmdbAwards(raw);
  return parsed.recognized ? buildAwardsView(parsed.awards) : null;
}
