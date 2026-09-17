/**
 * cinerie-score-methodology.ts — os numeros que `/pt/cinerie-score/` mostra. PURO.
 *
 * ============================================================================
 * POR QUE NAO IMPORTA `@screena/cinerie-score`
 * ============================================================================
 * O pacote do Score se declara offline-only: "Nunca importe deste pacote no
 * caminho de render". A pagina de metodologia e render. Entao os numeros vivem
 * aqui como literais — e `tests/web/cinerie-score-methodology.test.ts` os confere
 * contra a FORMULA: versao, escala, piso de fontes, piso de votos do TMDB, pesos,
 * as fontes que nao entram e o exemplo inteiro, recalculado por `composeScore`.
 * Mudou a formula e esqueceu a pagina? O teste reprova — a pagina nunca descreve
 * uma conta que o calculo nao faz.
 */

/** A versao da formula descrita (`CINERIE_SCORE_FORMULA_V1`). */
export const SCORE_FORMULA_VERSION = "cinerie-score/2026-08-v1";

/** Quando o proprietario aprovou a formula (cabecalho de `formula-2026-08-v1.ts`). */
export const SCORE_FORMULA_APPROVED_ON = "20 de agosto de 2026";

export const SCORE_SCALE = 100;

/** Piso de fontes contadas para o numero aparecer (`MINIMUM_COUNTED_SOURCES`). */
export const SCORE_MINIMUM_SOURCES = 2;

/** Piso de votos para o TMDB entrar (`TMDB_MINIMUM_VOTE_COUNT`). */
export const SCORE_TMDB_MINIMUM_VOTES = 50;

/** Pesos do grupo de publico. */
export const SCORE_IMDB_WEIGHT = 3;
export const SCORE_TMDB_WEIGHT = 1;

export interface ScoreExampleRating {
  readonly source: "rotten_tomatoes" | "metacritic" | "imdb" | "tmdb";
  readonly label: string;
  readonly group: "critics" | "audience";
  /** Na escala da propria fonte. */
  readonly value: number;
  readonly best: number;
  readonly count: number | null;
  /** Ja de 0 a 100. */
  readonly normalized: number;
}

export interface ScoreExample {
  readonly ratings: readonly [ScoreExampleRating, ScoreExampleRating, ScoreExampleRating, ScoreExampleRating];
  readonly critics: number;
  readonly audience: number;
  readonly value: number;
}

/** Um exemplo com numeros HIPOTETICOS — a pagina diz isso com todas as letras. */
export const SCORE_EXAMPLE: ScoreExample = {
  ratings: [
    {
      source: "rotten_tomatoes",
      label: "Rotten Tomatoes (crítica)",
      group: "critics",
      value: 90,
      best: 100,
      count: null,
      normalized: 90,
    },
    { source: "metacritic", label: "Metacritic", group: "critics", value: 70, best: 100, count: null, normalized: 70 },
    { source: "imdb", label: "IMDb", group: "audience", value: 8, best: 10, count: null, normalized: 80 },
    { source: "tmdb", label: "TMDB", group: "audience", value: 7, best: 10, count: 1200, normalized: 70 },
  ],
  critics: 80,
  audience: 77.5,
  value: 79,
};

/**
 * Numero em pt-BR com ate duas casas: "80", "77,5", "78,75". Sem `Intl`, como o
 * presenter do Score: a mesma entrada sai igual em qualquer runtime.
 */
export function formatScoreDecimal(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

/** Inteiro com separador de milhar pt-BR: "1.200". */
export function formatScoreCount(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** As tres contas do exemplo, escritas como a pagina as mostra. */
export function scoreExampleSteps(example: ScoreExample = SCORE_EXAMPLE): {
  readonly critics: string;
  readonly audience: string;
  readonly value: string;
} {
  const [rottenTomatoes, metacritic, imdb, tmdb] = example.ratings;
  const unrounded = (example.critics + example.audience) / 2;
  const d = formatScoreDecimal;
  return {
    critics: `(${d(rottenTomatoes.normalized)} + ${d(metacritic.normalized)}) ÷ 2 = ${d(example.critics)}`,
    audience:
      `(${d(imdb.normalized)} × ${SCORE_IMDB_WEIGHT} + ${d(tmdb.normalized)} × ${SCORE_TMDB_WEIGHT}) ` +
      `÷ ${SCORE_IMDB_WEIGHT + SCORE_TMDB_WEIGHT} = ${d(example.audience)}`,
    value: `(${d(example.critics)} + ${d(example.audience)}) ÷ 2 = ${d(unrounded)}, arredondado para ${d(example.value)}`,
  };
}
