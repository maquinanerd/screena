/**
 * omdb-awards.ts — Reconhecedor ESTRITO do campo `Awards` da OMDb. Modulo PURO
 * (sem rede, sem DB, sem IO, sem `Date`).
 *
 * DE ONDE ESTE CODIGO VEIO. O reconhecedor nasceu em
 * `apps/web/src/lib/awards-presenter.ts` (PR #163), quando ainda nao havia
 * fonte ligada. Ele subiu para ca porque agora tem DOIS consumidores que nao
 * podem divergir:
 *
 *   1. `services/ratings` — promove o literal de `api_cache` para o dominio, e
 *      precisa guardar a forma ESTRUTURADA junto com o bruto;
 *   2. `apps/web` — compoe a frase em pt-BR a partir da mesma estrutura.
 *
 * Duas implementacoes do mesmo reconhecimento produziriam uma faixa na tela
 * que nao corresponde ao que o banco guardou. As regras (regex, contagem,
 * recusas) sao as de #163; o que MUDOU aqui esta declarado na secao seguinte.
 *
 * O QUE MUDOU EM RELACAO A #163
 * -----------------------------
 * #163 devolvia o destaque VERBATIM em ingles (`"Won 4 Oscars"`). Isso ia para
 * a tela de um site em portugues. A regra nova separa as duas metades da frase:
 *
 *   - o NOME do premio e afirmacao factual da fonte e sai VERBATIM
 *     (`"Oscars"`, `"Primetime Emmys"`, `"BAFTA Film Award"`);
 *   - a ESTRUTURA da frase e nossa e vai para pt-BR — mas quem a escreve e o
 *     apresentador (`apps/web`), nao este modulo. Aqui a frase e DECOMPOSTA em
 *     `{ outcome, count, awardName }`; nenhuma palavra e traduzida.
 *
 * Consequencia: o destaque so e reconhecido quando decompoe. Um prefixo que
 * comece com "Won"/"Nominated for" e nao case com `<verbo> <numero> <nome>.`
 * NAO vira faixa — vira recusa com o valor bruto, para o reconhecedor ser
 * estendido depois com evidencia. Antes ele passava inteiro para a tela; um
 * literal que nao entendemos escrito na cara do leitor e pior que bloco
 * ausente.
 *
 * O RESTO TEM DE ACABAR. A frase e conferida por INTEIRO: o que sobrar depois
 * de retirar destaque e contagem (fora pontuacao e espaco) derruba o
 * reconhecimento. Sem isso, `"Won 4 Oscars. 160 wins & 220 nominations total.
 * Also disqualified in 1972"` viraria uma faixa que apaga a metade que nao
 * lemos, em silencio.
 */

/** Desfecho declarado pelo destaque da frase. */
export type AwardsOutcome = "won" | "nominated";

/** O destaque: "Won 4 Oscars" / "Nominated for 3 Oscars", ja decomposto. */
export interface AwardsHighlight {
  readonly outcome: AwardsOutcome;
  /** Quantos premios daquele nome. Sempre >= 1 (a fonte nunca escreve zero). */
  readonly count: number;
  /**
   * O nome do premio, VERBATIM da fonte: `"Oscars"`, `"Oscar"`,
   * `"Primetime Emmys"`, `"BAFTA Film Award"`. Nunca traduzido, nunca expandido,
   * nunca "corrigido" — traduzir o nome de um premio e inventar um premio.
   */
  readonly awardName: string;
}

/** Contagem agregada, quando a frase a declara. */
export interface AwardsTally {
  readonly wins: number | null;
  readonly nominations: number | null;
}

/** A frase inteira, reconhecida. */
export interface OmdbAwards {
  /** `null` quando a frase so traz a contagem agregada. */
  readonly highlight: AwardsHighlight | null;
  readonly tally: AwardsTally;
}

/** Por que a frase nao virou faixa de premios. */
export type AwardsRejectionReason =
  /** Campo ausente, nulo, vazio ou de tipo errado. */
  | "absent"
  /** A OMDb escreve `"N/A"` quando nao conhece premio para o titulo. */
  | "not_available"
  /** A frase existe e nao casa com nenhum formato conhecido. */
  | "unrecognized_format";

export type OmdbAwardsParse =
  | { readonly recognized: true; readonly awards: OmdbAwards }
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
 * O destaque, decomposto. `\s+` (nao ` `) porque a fonte ja publicou espaco
 * duplo; `[^.]+` para o nome porque ele acaba no ponto final e pode ter varias
 * palavras ("Primetime Emmys", "BAFTA Film Award").
 *
 * A ancora `^` e o que impede `"8 wins & 51 nominations total"` de virar
 * destaque — sem ela, a faixa repetiria a contagem duas vezes.
 */
const HEADLINE = /^\s*(Won|Nominated for)\s+(\d+)\s+([^.]+?)\s*\.\s*/i;

/**
 * A contagem agregada. `Another` e a grafia antiga da OMDb ("Won 4 Oscars.
 * Another 152 wins & 213 nominations."); `total` e a atual. As duas sao aceitas
 * porque as duas aparecem em payload real, e nenhuma delas muda o numero.
 */
const TALLY =
  /^\s*(?:Another\s+)?(?:(\d+)\s+wins?(?:\s*&\s*(\d+)\s+nominations?)?|(\d+)\s+nominations?)(?:\s+total)?\s*\.?\s*/i;

/** Sobra tolerada apos destaque + contagem: so pontuacao e espaco. */
const ONLY_PUNCTUATION = /^[\s.]*$/;

/**
 * Interpreta o literal `Awards` da OMDb.
 *
 * FAIL-CLOSED: qualquer frase que nao case INTEIRA com um formato conhecido e
 * RECUSADA com o valor bruto. Nunca "0 vitorias" inventado a partir de texto
 * que nao entendemos — zero e uma afirmacao sobre o mundo, e nao sabemos
 * faze-la.
 */
export function parseOmdbAwards(raw: unknown): OmdbAwardsParse {
  if (typeof raw !== "string") return { recognized: false, reason: "absent", raw: null };
  const value = raw.trim();
  if (value === "") return { recognized: false, reason: "absent", raw: null };
  if (value.toUpperCase() === "N/A") {
    return { recognized: false, reason: "not_available", raw: value };
  }

  let rest = value;

  let highlight: AwardsHighlight | null = null;
  const headlineMatch = HEADLINE.exec(rest);
  if (headlineMatch !== null) {
    const count = Number(headlineMatch[2]);
    const awardName = headlineMatch[3]!.trim();
    // Contagem zero ou nome vazio nao sao "destaque fraco": sao frase que nao
    // entendemos. Recusar e a unica saida honesta.
    if (Number.isFinite(count) && count > 0 && awardName !== "") {
      highlight = {
        outcome: headlineMatch[1]!.toLowerCase() === "won" ? "won" : "nominated",
        count,
        awardName,
      };
      rest = rest.slice(headlineMatch[0].length);
    }
  }

  let wins: number | null = null;
  let nominations: number | null = null;
  const tallyMatch = TALLY.exec(rest);
  if (tallyMatch !== null) {
    if (tallyMatch[1] !== undefined) {
      wins = Number(tallyMatch[1]);
      if (tallyMatch[2] !== undefined) nominations = Number(tallyMatch[2]);
    } else if (tallyMatch[3] !== undefined) {
      nominations = Number(tallyMatch[3]);
    }
    rest = rest.slice(tallyMatch[0].length);
  }

  // Nem destaque, nem contagem: a frase existe e nao sabemos le-la.
  if (highlight === null && wins === null && nominations === null) {
    return { recognized: false, reason: "unrecognized_format", raw: value };
  }
  // Lemos uma parte e sobrou frase. Exibir a parte lida seria apagar o resto em
  // silencio — recusamos a frase INTEIRA e guardamos o bruto.
  if (!ONLY_PUNCTUATION.test(rest)) {
    return { recognized: false, reason: "unrecognized_format", raw: value };
  }

  return { recognized: true, awards: { highlight, tally: { wins, nominations } } };
}
