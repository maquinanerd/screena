/**
 * strategies.ts — Quais estrategias cada caminho aceita, e a recusa (PURO).
 *
 * O DEFEITO QUE ESTE MODULO EXISTE PARA IMPEDIR, e ele ja aconteceu:
 * `plan-bootstrap` recebia `--strategy` como texto CRU do CLI e nunca o
 * validava. Uma estrategia desconhecida caia no `else` da cadeia de listas,
 * virava `popular` — e o relatorio ainda a REPORTAVA com o nome pedido. Quem
 * dimensionasse a semente com `--strategy daily-exports` recebia um plano de
 * `popular` rotulado como daily-exports: **o numero errado com o carimbo
 * certo**, que e pior que numero nenhum, porque ninguem volta para conferir um
 * resultado que parece ter respondido.
 *
 * POR QUE OS DOIS CAMINHOS DIVERGIRAM. `catalog bootstrap` monta um JOB, e o
 * payload do job passa por `validateDiscoverIdsInput`/`validateBootstrapInput`,
 * que validam `strategy` contra `DISCOVER_STRATEGIES` e LANCAM no desconhecido.
 * `plan-bootstrap` e o unico comando que NAO monta job — ele le o TMDB direto e
 * calcula. Ao pular a camada de job, pulou tambem a validacao que ela dava de
 * graca. Acidente de arquitetura, nao decisao.
 *
 * A LICAO GENERALIZADA: o conjunto aceito por cada caminho tem de ser DADO,
 * declarado num lugar so, e nao a consequencia de qual `if` pegou primeiro.
 */

/**
 * Estrategias que a INGESTAO aceita (o caminho que escreve).
 *
 * Espelha `DISCOVER_STRATEGIES` de `catalog-jobs/handlers/schemas.ts`. A copia
 * e deliberada e travada por teste: este modulo e puro e nao pode importar o
 * schema sem arrastar a cadeia de validacao inteira para dentro do planejador.
 * O teste `strategies.test.ts` reprova se as duas listas divergirem.
 */
export const INGESTION_STRATEGIES = [
  'daily-exports',
  'popular',
  'trending',
  'top_rated',
  'upcoming',
  'now_playing',
  'airing_today',
  'on_the_air',
  'discover',
  'explicit-ids',
] as const

/** Uma estrategia de ingestao. */
export type IngestionStrategy = (typeof INGESTION_STRATEGIES)[number]

/**
 * Estrategias que `plan-bootstrap` sabe PLANEJAR.
 *
 * E um SUBCONJUNTO PROPRIO do que a ingestao aceita, e isso e correto, nao um
 * bug: o planejador percorre LISTAS do TMDB para colher candidatos e pedir o
 * detalhe de cada serie. Ele nao le o Daily ID Export, e `explicit-ids` nao tem
 * o que planejar (o operador ja sabe os ids).
 *
 * O que NAO pode acontecer e a diferenca ser silenciosa — dai
 * {@link assertPlannableStrategy}.
 */
export const PLANNABLE_STRATEGIES = [
  'popular',
  'top_rated',
  'now_playing',
  'on_the_air',
] as const

/** Uma estrategia planejavel. */
export type PlannableStrategy = (typeof PLANNABLE_STRATEGIES)[number]

/** Recusa de estrategia, com a lista do que era aceito. */
export class UnsupportedStrategyError extends Error {
  constructor(
    readonly strategy: string,
    readonly accepted: readonly string[],
    message: string,
  ) {
    super(message)
    this.name = 'UnsupportedStrategyError'
  }
}

/** `value` e uma estrategia que a ingestao aceita? */
export function isIngestionStrategy(value: string): value is IngestionStrategy {
  return (INGESTION_STRATEGIES as readonly string[]).includes(value)
}

/** `value` e planejavel? */
export function isPlannableStrategy(value: string): value is PlannableStrategy {
  return (PLANNABLE_STRATEGIES as readonly string[]).includes(value)
}

/**
 * Exige uma estrategia planejavel, ou recusa com a lista.
 *
 * A mensagem distingue os dois motivos de recusa, porque a acao do operador e
 * diferente: estrategia que a INGESTAO aceita mas o planejador nao (o caso do
 * `daily-exports`) pede "planeje com popular"; estrategia que ninguem aceita e
 * erro de digitacao.
 */
export function assertPlannableStrategy(strategy: string): PlannableStrategy {
  if (isPlannableStrategy(strategy)) return strategy

  const known = isIngestionStrategy(strategy)
  const detail = known
    ? `"${strategy}" e valida na INGESTAO, mas o planejador nao a simula: ele percorre listas do TMDB. ` +
      `Para dimensionar por popularidade, planeje com "popular".`
    : `"${strategy}" nao existe em nenhum caminho.`

  throw new UnsupportedStrategyError(
    strategy,
    PLANNABLE_STRATEGIES,
    `--strategy ${detail}\n  planejaveis: ${PLANNABLE_STRATEGIES.join(', ')}`,
  )
}
