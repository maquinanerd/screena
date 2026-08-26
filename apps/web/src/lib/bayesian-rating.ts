/**
 * bayesian-rating.ts — Nota PONDERADA por volume de votos. Puro, sem IO.
 *
 * ============================================================================
 * POR QUE NOTA CRUA NÃO SERVE PARA ORDENAR
 * ============================================================================
 * `vote_average` do TMDB é a média simples. Um título com 8,9 e 40 votos vence
 * um com 7,2 e 12 mil — e o primeiro é ruído, não qualidade. Quanto MENOS
 * votos, mais fácil é chegar ao topo por acidente, então ordenar por nota crua
 * ordena, na prática, por obscuridade.
 *
 * A correção é a média bayesiana (a mesma que o TMDB usa no próprio Top Rated):
 *
 *     WR = (v / (v + m)) * R + (m / (v + m)) * C
 *
 *   R = nota do título          v = votos do título
 *   C = média do conjunto       m = peso do prior (em "votos equivalentes")
 *
 * Ler em uma frase: cada título começa com `m` votos imaginários valendo a
 * média do conjunto, e precisa de votos REAIS para se afastar dela. Com poucos
 * votos o resultado cola em C; com muitos, converge para R. Nada é descartado —
 * o pouco votado só não chega ao topo de graça.
 *
 * ============================================================================
 * ESTE MÓDULO É DE ORDEM, NUNCA DE EXIBIÇÃO
 * ============================================================================
 * O valor que sai daqui NÃO é uma nota da Cinerie e não pode ser renderizado,
 * nem virar `AggregateRating`: seria fabricar nota própria a partir de nota de
 * terceiro, o que as regras de ratings proíbem (invariantes 1 e 2, e a política
 * de `AggregateRating` em `.claude/rules/ratings.md`). Ele existe para decidir
 * QUEM aparece antes de quem, e morre antes do render — exatamente como o
 * `orderBy` de "Clássicos" já fazia com `voteAverageTmdb`.
 */

/** Um título com o par (nota, votos) do fornecedor. */
export interface WeightedRatingInput {
  /** Nota média do fornecedor. `null` = sem nota. */
  readonly voteAverage: number | null;
  /** Volume de votos do fornecedor. `null` = sem volume. */
  readonly voteCount: number | null;
}

/**
 * Peso do prior, em "votos equivalentes".
 *
 * 500 não é número novo: é o mesmo `CLASSIC_MIN_VOTES` que a aba "Clássicos" já
 * usa como piso. Lá ele CORTA (título com menos de 500 votos não é clássico);
 * aqui ele PONDERA — e é essa a diferença que importa para "No ar", onde um
 * corte duro apagaria a estreia legítima que ainda não juntou votos.
 */
export const BAYESIAN_PRIOR_VOTES = 500;

/**
 * Média do conjunto (C) — média SIMPLES das notas, não ponderada pelo volume.
 *
 * ============================================================================
 * A ARMADILHA QUE ESTA ESCOLHA EVITA (medida ao escrever o teste, 2026-08-26)
 * ============================================================================
 * A primeira versão deste módulo ponderava C pelo volume de votos, com um
 * raciocínio que parece óbvio: "C é a âncora, então precisa resistir ao título
 * de 3 votos". Ponderar TEM esse efeito — e um efeito colateral que destrói a
 * fórmula inteira.
 *
 * Ponderado, o título MAIS VOTADO do conjunto praticamente DEFINE C. E se C é o
 * próprio consagrado, encolher o obscuro "na direção de C" o encolhe na direção
 * do consagrado — e ele para logo ACIMA dele, porque a nota crua era maior.
 * Com os números do enunciado (8,9 com 40 votos contra 7,2 com 12 mil), C
 * ponderado dá 7,206 e o resultado sai 7,331 contra 7,200: o obscuro vence, que
 * é exatamente o que a ponderação existia para impedir.
 *
 * Simples, C = 6,94 no mesmo conjunto, e a ordem se inverte: 7,085 contra
 * 7,190. É também o C do IMDb e do TMDB — "the mean vote across the whole
 * report" é média de médias, não média ponderada por votos.
 *
 * Conjunto vazio devolve `null` — e sem C não há ponderação possível. Quem
 * chama decide o que fazer com isso; inventar um "6,5 razoável" aqui seria
 * fabricar o número mais importante da fórmula.
 */
export function poolMeanRating(items: readonly WeightedRatingInput[]): number | null {
  let soma = 0;
  let n = 0;
  for (const item of items) {
    const r = item.voteAverage;
    const v = item.voteCount;
    if (r === null || v === null || !Number.isFinite(r) || !Number.isFinite(v) || v <= 0) continue;
    soma += r;
    n += 1;
  }
  return n === 0 ? null : soma / n;
}

/**
 * A nota ponderada de UM título contra a média do conjunto.
 *
 * Sem nota, sem votos ou sem C o título vale `0` — o fim da fila, nunca o
 * começo. Um `null` que virasse "média" premiaria o registro incompleto, que é
 * a classe de lixo que o portão do hero existe para conter.
 */
export function bayesianRating(
  item: WeightedRatingInput,
  poolMean: number | null,
  priorVotes: number = BAYESIAN_PRIOR_VOTES,
): number {
  if (poolMean === null) return 0;
  const r = item.voteAverage;
  const v = item.voteCount;
  if (r === null || v === null || !Number.isFinite(r) || !Number.isFinite(v) || v <= 0) return 0;
  const m = Math.max(0, priorVotes);
  if (v + m === 0) return 0;
  return (v / (v + m)) * r + (m / (v + m)) * poolMean;
}

/**
 * Ordena um conjunto pela nota bayesiana, do maior para o menor.
 *
 * C é calculado sobre o CONJUNTO RECEBIDO, não sobre o catálogo inteiro: a
 * pergunta é "entre as séries que foram ao ar esta semana, quais valem o topo",
 * e a âncora certa para isso é a média dessas séries.
 *
 * `tiebreak` desempata de forma determinística — sem ele, duas séries com o
 * mesmo par (nota, votos) trocariam de lugar entre requisições e o leitor veria
 * a lista "tremer" sem nada ter mudado.
 */
export function sortByBayesianRating<T>(
  items: readonly T[],
  read: (item: T) => WeightedRatingInput,
  tiebreak: (item: T) => string,
): T[] {
  const mean = poolMeanRating(items.map(read));
  return [...items].sort((a, b) => {
    const diff = bayesianRating(read(b), mean) - bayesianRating(read(a), mean);
    if (diff !== 0) return diff;
    return tiebreak(a).localeCompare(tiebreak(b));
  });
}
