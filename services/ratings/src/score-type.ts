/**
 * score-type.ts — Classificacao PURA da natureza de uma nota (critics /
 * audience / editorial).
 *
 * Por que isto existe: "IMDb 8.4" e "Tomatometer 92%" nao sao a mesma especie
 * de coisa. Uma e a media de votos do publico; a outra e a porcentagem de
 * criticos que aprovaram. Sem classificar, uma UI acabaria empilhando as duas
 * lado a lado como se fossem comparaveis — e a Rotten Tomatoes publica AS DUAS
 * (Tomatometer=critica, Popcornmeter=publico), entao nem "a nota da fonte X"
 * identifica uma metrica.
 *
 * FAIL-CLOSED: o que nao da para classificar com certeza devolve `null`, e o
 * trigger `external_ratings_display_guard` proibe exibir nota com
 * `score_type IS NULL`. Nota nao classificada continua no banco (auditavel),
 * so nao vai a vitrine. Chutar "editorial" para tapar o buraco seria pior que
 * nao classificar: `editorial` significa "nota da propria casa" e uma nota de
 * terceiro jamais e isso.
 */

import type { RatingScoreType } from '@screena/config'

/** Entrada da classificacao (tudo que se sabe da nota, ja normalizado). */
export interface ScoreTypeInput {
  readonly ratingSource: string
  readonly metric: string
  readonly ratingLabel: string
}

/**
 * Marcas cujo NOME ja determina a natureza. Vem primeiro porque sao
 * inequivocas: "Tomatometer" e critica por definicao, em qualquer contexto.
 */
const BRANDED: readonly (readonly [RegExp, RatingScoreType])[] = [
  [/tomatometer/i, 'critics'],
  [/popcornmeter/i, 'audience'],
  [/metascore/i, 'critics'],
  [/user\s*score/i, 'audience'],
]

/** Vocabulario generico de metrica, quando a marca nao resolve. */
const METRIC_PATTERNS: readonly (readonly [RegExp, RatingScoreType])[] = [
  [/critic/i, 'critics'],
  [/audience/i, 'audience'],
  [/user/i, 'audience'],
  [/vote/i, 'audience'],
]

/**
 * Fontes cuja nota principal e, por natureza, do publico. IMDb, Letterboxd e
 * FilmAffinity publicam media de votos de usuarios — nao ha painel de criticos.
 * So vale como ULTIMO recurso, e so para a metrica generica de nota da fonte.
 */
const AUDIENCE_BY_NATURE: readonly string[] = ['imdb', 'letterboxd', 'filmaffinity']

/** Metricas genericas ("a nota daquela fonte", sem qualificador). */
const GENERIC_METRICS: readonly string[] = ['rating', 'score', 'user_rating', 'average']

/**
 * Classifica a natureza da nota, ou devolve `null` quando nao da para afirmar.
 *
 * Ordem: marca -> vocabulario da metrica -> natureza da fonte (so em metrica
 * generica). Nada de heuristica alem disso.
 */
export function classifyRatingScoreType(input: ScoreTypeInput): RatingScoreType | null {
  const haystack = `${input.ratingLabel} ${input.metric}`

  for (const [pattern, type] of BRANDED) {
    if (pattern.test(haystack)) return type
  }
  for (const [pattern, type] of METRIC_PATTERNS) {
    if (pattern.test(input.metric)) return type
  }

  const metric = input.metric.trim().toLowerCase()
  if (GENERIC_METRICS.includes(metric) && AUDIENCE_BY_NATURE.includes(input.ratingSource)) {
    return 'audience'
  }

  // Rotten Tomatoes e Metacritic publicam DUAS notas cada. Uma metrica generica
  // dessas fontes e ambigua por construcao — e adivinhar aqui trocaria critica
  // por publico, que e o erro exato que a invariante 1 proibe.
  return null
}
