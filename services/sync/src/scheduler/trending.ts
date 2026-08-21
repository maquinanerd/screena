/**
 * trending.ts — O SINAL DE AGORA na prioridade da fila. Modulo PURO.
 *
 * ============================================================================
 * O DEFEITO QUE ISTO CORRIGE
 * ============================================================================
 * A fila ordena por `popularity` do TMDB, que e ACUMULADA. Um titulo que
 * estreou ontem e explodiu tem popularity acumulada baixa: ele cai na faixa de
 * CAUDA (`+16`) e espera atras de milhares de titulos antigos e mornos — no
 * exato dia em que a pagina dele mais e procurada.
 *
 * `popularity` responde "quanta atencao este titulo acumulou". `trending/day`
 * responde "quanta atencao ele esta recebendo AGORA". Sao perguntas diferentes,
 * e a fila precisa da segunda.
 *
 * ============================================================================
 * O PESO: A POSICAO DO TRENDING **SUBSTITUI** O RANK DE POPULARIDADE
 * ============================================================================
 * Nao soma, nao pondera, nao mistura: substitui.
 *
 * O motivo e que somar exigiria uma constante inventada. `popularity` e um
 * float sem teto publicado; a posicao do trending e um ordinal de 1 a 20. Nao
 * existe taxa de conversao entre os dois — nem o TMDB publica uma, nem nos
 * medimos. Qualquer peso ("trending vale 5.000 pontos de popularity") seria um
 * numero escolhido para produzir o resultado desejado, e o proximo ajuste teria
 * de ser escolhido do mesmo jeito.
 *
 * Substituir nao precisa de constante nenhuma, porque os dois sinais ja sao a
 * MESMA grandeza: uma ordem de atencao. So mudam a janela. Quando existe a
 * medida da janela curta, ela e a melhor resposta para "quem o leitor procura
 * hoje" — e a acumulada volta a valer para todo o resto do catalogo, que e a
 * esmagadora maioria.
 *
 * EFEITO EM NUMEROS (as faixas de `POPULARITY_PRIORITY_OFFSETS`): um titulo em
 * rank 40.000 de popularidade (offset `+16`, cauda) que aparece na posicao 3 do
 * trending do dia passa a valer rank 3 — offset `0`, a faixa do topo. Sao 16
 * pontos de prioridade, do fundo da fila `scheduled` para a frente dela.
 *
 * ============================================================================
 * O TETO CONTINUA VALENDO, E ELE E O QUE IMPEDE O ABUSO
 * ============================================================================
 * O deslocamento continua saindo de `popularityPriorityOffset`, ou seja fica em
 * `[0, 16]`. Trending NAO cria uma faixa nova nem um bonus negativo: ele so
 * escolhe um rank melhor DENTRO da mesma janela. Por construcao, um titulo em
 * trending com motivo `scheduled` continua perdendo para qualquer `changes` e
 * para qualquer `on_demand` — o motivo domina, como sempre.
 *
 * ============================================================================
 * O LIMITE, DITO COM TODAS AS LETRAS
 * ============================================================================
 * O snapshot so guarda item cuja entidade JA ESTA PROMOVIDA no catalogo (o
 * store descarta o resto — `discovery-snapshot-store.ts`). Logo este sinal
 * acelera titulo que ja existe no banco; ele NAO acelera a primeira ingestao de
 * um titulo que o catalogo ainda nao tem. Quem descobre esse e o Daily ID
 * Export, pela fila `discovery`.
 */

/** Posicao 1-based de um titulo no trending, por `tmdb_id`. */
export type TrendingRanks = ReadonlyMap<number, number>

/** Mapa vazio. Nomeado para o chamador nao construir `new Map()` solto. */
export const NO_TRENDING: TrendingRanks = new Map()

/**
 * Converte a POSICAO gravada no snapshot em RANK 1-based.
 *
 * `discovery_snapshot_items.position` e 0-BASED (o store reindexa densamente a
 * partir de zero). `popularityPriorityOffset` trata `rank <= 0` como "sem
 * posicao medida" e devolve a faixa de CAUDA — ou seja, passar a posicao crua
 * mandaria o titulo MAIS trending do dia para o fundo da fila, silenciosamente,
 * fazendo o sinal parecer ligado e quebrado ao mesmo tempo.
 *
 * Esta funcao existe so para essa conversao ter nome e teste.
 */
export function rankFromPosition(position: number): number {
  return Math.max(1, Math.trunc(position) + 1)
}

/**
 * O rank EFETIVO de um titulo: o do trending quando ele esta la, senao o de
 * popularidade.
 *
 * `popularityRank` pode ser `null` (o chamador ranqueia, mas este item nao tem
 * posicao medida) — e nesse caso o trending, quando existe, e a UNICA medida
 * disponivel, o que reforca a substituicao em vez de enfraquece-la.
 */
export function effectiveRank(
  tmdbId: number,
  popularityRank: number | null,
  trending: TrendingRanks,
): { readonly rank: number | null; readonly signal: 'trending' | 'popularity' | 'none' } {
  const trendingRank = trending.get(tmdbId)
  if (trendingRank !== undefined) return { rank: trendingRank, signal: 'trending' }
  if (popularityRank !== null) return { rank: popularityRank, signal: 'popularity' }
  return { rank: null, signal: 'none' }
}
