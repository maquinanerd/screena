/**
 * awards-presenter.ts — A faixa de premios do canonico, a partir do literal
 * `Awards` da OMDb. PURO: sem rede/DB/IO e sem `Date`.
 *
 * ESTADO: SEM FONTE LIGADA. Este modulo e o CONTRATO DE EXIBICAO, nao a
 * ingestao. Nenhuma pagina o consome hoje, porque nenhuma coluna do banco
 * carrega o texto de premios. Ver docs/frontend/DESIGN-DELTA-detalhe.md para o que a frente de dados
 * precisa fazer para acender a faixa.
 *
 * POR QUE O CONTRATO E UM LITERAL, E NAO NUMEROS
 * ----------------------------------------------
 * A API da TMDB NAO expoe premios (o site tem `/award`, a API v3 nao — nao ha
 * endpoint nem chave de `append_to_response`; ha pedidos abertos no forum desde
 * 2017). Raspar a pagina de premios da TMDB esta fora de questao: custaria o
 * acesso a TMDB, que e a fundacao do catalogo inteiro.
 *
 * A unica fonte plausivel ja no caminho e o campo `Awards` da OMDb — uma FRASE,
 * nao um par de inteiros:
 *
 *     "Nominated for 3 Oscars. 8 wins & 51 nominations total"
 *
 * Por isso a interpretacao vive aqui, testada, em vez de espalhada no JSX.
 *
 * O QUE ESTE MODULO NAO FAZ
 * -------------------------
 * Nao traduz o NOME do premio. "Won 3 Oscars", "Nominated for 2 Primetime
 * Emmys", "1 BAFTA Film Award" — o nome e uma afirmacao factual da fonte, e
 * traduzir arbitrariamente e inventar. O prefixo sai como a fonte escreveu; so
 * a contagem, que e numero, e escrita em pt-BR. Formato nao reconhecido NAO
 * vira premio: devolve o valor bruto para quem chamou registrar.
 */

/** Contagem agregada de premios, quando a frase a declara. */
export interface AwardsTally {
  readonly wins: number | null;
  readonly nominations: number | null;
  /** "8 vitórias · 51 indicações"; `null` quando nao ha contagem nenhuma. */
  readonly label: string | null;
}

export interface AwardsView {
  /**
   * O destaque, VERBATIM da fonte quando existe ("Won 3 Oscars", "Nominated for
   * 3 Oscars"). `null` quando a frase so traz a contagem agregada.
   */
  readonly headline: string | null;
  readonly tally: AwardsTally;
}

/** Por que a frase nao virou faixa de premios. */
export type AwardsRejectionReason =
  /** Campo ausente, nulo ou vazio. */
  | "absent"
  /** A OMDb escreve `"N/A"` quando nao conhece premio para o titulo. */
  | "not_available"
  /** A frase existe e nao casa com nenhum formato conhecido. */
  | "unrecognized_format";

export type AwardsParse =
  | { readonly recognized: true; readonly view: AwardsView }
  | {
      readonly recognized: false;
      readonly reason: AwardsRejectionReason;
      /**
       * O literal BRUTO, para o chamador registrar. E o unico jeito de o
       * reconhecedor ser estendido depois com evidencia em vez de palpite.
       */
      readonly raw: string | null;
    };

/**
 * Frases de contagem que a OMDb usa. Cobrem singular e plural, com e sem o
 * `total` final, e cada metade sozinha.
 *
 * A ancora `\b` em vez de `^` e deliberada: a contagem vem DEPOIS do destaque
 * ("Won 3 Oscars. 8 wins & 51 nominations total").
 */
const WINS_AND_NOMINATIONS = /\b(\d+)\s+wins?\s*&\s*(\d+)\s+nominations?\b/i;
const WINS_ONLY = /\b(\d+)\s+wins?\b/i;
const NOMINATIONS_ONLY = /\b(\d+)\s+nominations?\b/i;

/**
 * O destaque: tudo antes do primeiro ponto final, quando comeca por "Won" ou
 * "Nominated for".
 *
 * Sem essa ancora inicial, "8 wins & 51 nominations total" viraria destaque —
 * e a faixa repetiria a contagem duas vezes.
 */
const HEADLINE = /^\s*((?:Won|Nominated for)\b[^.]*)\./i;

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
 * Interpreta o literal `Awards` da OMDb.
 *
 * Fail-closed: qualquer frase que nao case com um formato conhecido e RECUSADA
 * com o valor bruto. Nunca "0 vitórias" inventado a partir de texto que nao
 * entendemos — zero e uma afirmacao sobre o mundo, e nao sabemos faze-la.
 */
export function parseOmdbAwards(raw: unknown): AwardsParse {
  if (typeof raw !== "string") return { recognized: false, reason: "absent", raw: null };
  const value = raw.trim();
  if (value === "") return { recognized: false, reason: "absent", raw: null };
  if (value.toUpperCase() === "N/A") {
    return { recognized: false, reason: "not_available", raw: value };
  }

  const headlineMatch = HEADLINE.exec(value);
  const headline = headlineMatch === null ? null : headlineMatch[1]!.trim();

  // A contagem e lida DEPOIS do destaque: em "Won 3 Oscars. 8 wins & ...", o
  // "3" pertence ao destaque e nao e vitoria agregada.
  const rest = headlineMatch === null ? value : value.slice(headlineMatch[0].length);

  let wins: number | null = null;
  let nominations: number | null = null;

  const both = WINS_AND_NOMINATIONS.exec(rest);
  if (both !== null) {
    wins = Number(both[1]);
    nominations = Number(both[2]);
  } else {
    const w = WINS_ONLY.exec(rest);
    const n = NOMINATIONS_ONLY.exec(rest);
    if (w !== null) wins = Number(w[1]);
    if (n !== null) nominations = Number(n[1]);
  }

  // Nem destaque, nem contagem: a frase existe e nao sabemos le-la.
  if (headline === null && wins === null && nominations === null) {
    return { recognized: false, reason: "unrecognized_format", raw: value };
  }

  return {
    recognized: true,
    view: { headline, tally: { wins, nominations, label: tallyLabel(wins, nominations) } },
  };
}
