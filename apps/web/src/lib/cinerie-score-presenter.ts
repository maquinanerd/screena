/**
 * cinerie-score-presenter.ts — O Cinerie Score na tela. PURO.
 *
 * ============================================================================
 * O QUE ESTE MODULO DECIDE, E O QUE ELE NAO DECIDE
 * ============================================================================
 * Ele decide COMO o numero aparece e SE ele pode aparecer. Ele nao calcula: o
 * calculo vive em `@screena/cinerie-score`, roda OFFLINE, e chega aqui como
 * resultado ja persistido (invariantes 3 e 4 — zero API externa e zero IA no
 * render).
 *
 * ============================================================================
 * A REGRA DE EXIBICAO, E ELA E INEGOCIAVEL
 * ============================================================================
 * Exibe se, e somente se, houver >= 2 FONTES CONTADAS. Com uma fonte so nao
 * existe composicao — seria lavar o numero de um terceiro e chamar de nosso.
 *
 * A ausencia distingue TRES estados, porque para quem opera eles pedem acoes
 * diferentes e sem a distincao seriam o mesmo silencio:
 *
 *   `no_approved_formula`         — nao ha decisao de uso que autorize derivar.
 *                                   E o estado de HOJE (ver abaixo).
 *   `single_source_insufficient`  — ha nota, de uma fonte so. Nao compoe.
 *   `no_rating_at_all`            — nao ha nota nenhuma.
 *
 * ============================================================================
 * A AUTORIZACAO PARA DERIVAR — decisao do proprietario, 20/08/2026
 * ============================================================================
 * A formula esta implementada, versionada, testada e REGISTRADA
 * (`cinerie-score/2026-08-v1`). A autorizacao para DERIVAR e a decisao
 * `cinerie_score_display` emitida pelo registro legal (base `owner_decision` —
 * Pablo Eduardo, 20/08/2026, docs/legal/owner-authorization-2026-08-20.md), que
 * revogou a recusa anterior. `authorized` reflete a existencia dessa decisao
 * VIGENTE no banco: ate o proprietario rodar o `legal sources apply` em
 * producao, o estado la continua `no_approved_formula` — e esta ausencia fala.
 *
 * ============================================================================
 * O QUE O SCORE NAO FAZ COM O PAINEL DE NOTAS
 * ============================================================================
 * Ele NAO substitui e NAO esconde a nota de nenhuma fonte. O painel individual
 * continua ao lado, cada nota na sua escala, com seu credito e sua data. Ha
 * teste para isso — se alguem trocar um pelo outro, reprova.
 */

import {
  MINIMUM_COUNTED_SOURCES,
  type CountedSource,
} from "@screena/cinerie-score";

/** Escala do Score na tela. Sempre 0-100, inteiro. */
export const CINERIE_SCORE_DISPLAY_SCALE = 100;

/**
 * Nome da fonte como o leitor a conhece.
 *
 * Mapa FECHADO: fonte sem rotulo declarado nao entra na linha de composicao. Um
 * fallback generico ("outra fonte") descreveria o numero sem nomear quem o
 * compos — que e exatamente o oposto do que a linha existe para fazer.
 */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  imdb: "IMDb",
  tmdb: "TMDB",
  rotten_tomatoes: "Rotten Tomatoes",
  metacritic: "Metacritic",
};

/** Por que o Score nao renderizou. Espelha `SectionAbsenceReason`. */
export type CinerieScoreAbsence =
  | "no_approved_formula"
  | "single_source_insufficient"
  | "no_rating_at_all";

/** O Score pronto para a tela. */
export interface CinerieScoreView {
  /** Inteiro 0-100. */
  readonly value: number;
  readonly scale: number;
  /**
   * Como foi composto e de QUANTAS fontes, NOMEANDO-as.
   *
   * Ex.: "Composto de 3 fontes: IMDb, Rotten Tomatoes e Metacritic."
   * Sem esta linha o numero seria afirmacao sem lastro.
   */
  readonly compositionLine: string;
  /** As fontes, na ordem em que compuseram. Para teste e `data-attr`. */
  readonly sources: readonly string[];
}

/** O resultado da decisao de exibicao: renderiza, ou diz por que nao. */
export type CinerieScoreDecision =
  | { readonly rendered: true; readonly view: CinerieScoreView }
  | { readonly rendered: false; readonly reason: CinerieScoreAbsence };

/** Entrada: o calculo ja persistido, projetado para ca. */
export interface CinerieScoreInputView {
  /**
   * `false` quando nao ha `DataUsageDecision` vigente autorizando derivar.
   * Vira `true` quando a decisao da autorizacao do proprietario (20/08/2026)
   * estiver aplicada e vigente no banco — ver o cabecalho.
   */
  readonly authorized: boolean;
  readonly value: number | null;
  readonly counted: readonly CountedSource[];
}

/**
 * Junta os nomes em pt-BR: "A", "A e B", "A, B e C".
 *
 * Escrito a mao e nao com `Intl.ListFormat` porque este modulo e PURO e
 * deterministico: `Intl` depende de ICU do runtime, e a mesma lista poderia sair
 * diferente entre a maquina de build e o container.
 */
function juntarNomes(nomes: readonly string[]): string {
  if (nomes.length === 0) return "";
  if (nomes.length === 1) return nomes[0] as string;
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1] as string}`;
}

/**
 * Decide se o Cinerie Score vai a tela, e monta a linha de composicao.
 *
 * A ORDEM das checagens importa e nao e arbitraria:
 *  1. autorizacao (licenca) — sem ela nada mais e relevante;
 *  2. zero fontes — nao ha numero;
 *  3. uma fonte — ha numero e ele nao compoe.
 *
 * Inverter (2) e (3) faria um titulo sem nota nenhuma reportar
 * "fonte insuficiente", mandando o operador procurar a segunda fonte de um
 * titulo que nao tem a primeira.
 */
export function decideCinerieScore(input: CinerieScoreInputView): CinerieScoreDecision {
  if (!input.authorized) return { rendered: false, reason: "no_approved_formula" };

  // So conta fonte com rotulo declarado: uma fonte que nao pode ser NOMEADA na
  // linha de composicao tambem nao pode compor o numero em silencio.
  const nomeadas = input.counted.filter((f) => SOURCE_LABELS[f.source] !== undefined);
  if (nomeadas.length === 0) return { rendered: false, reason: "no_rating_at_all" };
  if (nomeadas.length < MINIMUM_COUNTED_SOURCES) {
    return { rendered: false, reason: "single_source_insufficient" };
  }
  if (input.value === null || !Number.isFinite(input.value)) {
    return { rendered: false, reason: "no_rating_at_all" };
  }

  const sources = nomeadas.map((f) => f.source);
  const rotulos = sources.map((s) => SOURCE_LABELS[s] as string);
  return {
    rendered: true,
    view: {
      value: Math.min(CINERIE_SCORE_DISPLAY_SCALE, Math.max(0, Math.round(input.value))),
      scale: CINERIE_SCORE_DISPLAY_SCALE,
      compositionLine: `Composto de ${nomeadas.length} fontes: ${juntarNomes(rotulos)}.`,
      sources,
    },
  };
}
