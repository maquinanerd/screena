/**
 * cinerie-score-methodology.test.ts — a pagina de metodologia descreve a conta que
 * a FORMULA faz, e nenhuma outra.
 *
 * A pagina nao pode importar `@screena/cinerie-score` (o pacote se declara
 * offline-only), entao os numeros dela sao literais em
 * `apps/web/src/lib/cinerie-score-methodology.ts`. Este teste pode importar o
 * pacote, e e aqui que os literais sao conferidos contra a formula vigente.
 */

import {
  CINERIE_SCORE_FORMULA_V1,
  CINERIE_SCORE_SCALE,
  MINIMUM_COUNTED_SOURCES,
  TMDB_MINIMUM_VOTE_COUNT,
  composeScore,
  normalizeRating,
  selectCountedSources,
  shouldDisplayCinerieScore,
  type CinerieScoreRatingInput,
} from '@screena/cinerie-score'
import { describe, expect, it } from 'vitest'

import {
  SCORE_EXAMPLE,
  SCORE_FORMULA_VERSION,
  SCORE_IMDB_WEIGHT,
  SCORE_MINIMUM_SOURCES,
  SCORE_SCALE,
  SCORE_TMDB_MINIMUM_VOTES,
  SCORE_TMDB_WEIGHT,
  formatScoreCount,
  formatScoreDecimal,
  scoreExampleSteps,
} from '../../apps/web/src/lib/cinerie-score-methodology'

function nota(
  source: string,
  type: string,
  value: number,
  best: number,
  count: number | null = null,
): CinerieScoreRatingInput {
  return { source, type, value, best, count, licenseDecisionId: 'decisao-de-teste' }
}

describe('os numeros da pagina sao os da formula', () => {
  it('versao, escala, piso de fontes e piso de votos do TMDB', () => {
    expect(SCORE_FORMULA_VERSION).toBe(CINERIE_SCORE_FORMULA_V1)
    expect(SCORE_SCALE).toBe(CINERIE_SCORE_SCALE)
    expect(SCORE_MINIMUM_SOURCES).toBe(MINIMUM_COUNTED_SOURCES)
    expect(SCORE_TMDB_MINIMUM_VOTES).toBe(TMDB_MINIMUM_VOTE_COUNT)
  })

  it('pesos do grupo de publico: IMDb e TMDB', () => {
    expect(normalizeRating(nota('imdb', 'audience', 7, 10))?.weight).toBe(SCORE_IMDB_WEIGHT)
    expect(normalizeRating(nota('tmdb', 'audience', 7, 10, 500))?.weight).toBe(SCORE_TMDB_WEIGHT)
  })

  it('o que a pagina diz que NAO entra, nao entra', () => {
    // "A nota de publico do Rotten Tomatoes nao entra."
    expect(normalizeRating(nota('rotten_tomatoes', 'audience', 90, 100))).toBeNull()
    // "TMDB ... so quando tem pelo menos N votos."
    expect(normalizeRating(nota('tmdb', 'audience', 7, 10, SCORE_TMDB_MINIMUM_VOTES - 1))).toBeNull()
    expect(normalizeRating(nota('tmdb', 'audience', 7, 10, SCORE_TMDB_MINIMUM_VOTES))).not.toBeNull()
    // "Com uma fonte so nao ha composicao ... nao aparece."
    expect(shouldDisplayCinerieScore(selectCountedSources([nota('imdb', 'audience', 8, 10)]))).toBe(false)
  })

  it('"com um grupo so, e esse grupo"', () => {
    const soCritica = composeScore([nota('rotten_tomatoes', 'critics', 90, 100), nota('metacritic', 'critics', 70, 100)])
    expect(soCritica?.value).toBe(80)
    expect(soCritica?.audience).toBeNull()
  })

  it('o exemplo inteiro e recalculado pela formula', () => {
    const composto = composeScore(
      SCORE_EXAMPLE.ratings.map((rating) =>
        nota(rating.source, rating.group, rating.value, rating.best, rating.count),
      ),
    )
    expect(composto).not.toBeNull()
    expect(composto?.critics).toBe(SCORE_EXAMPLE.critics)
    expect(composto?.audience).toBe(SCORE_EXAMPLE.audience)
    expect(composto?.value).toBe(SCORE_EXAMPLE.value)
    for (const rating of SCORE_EXAMPLE.ratings) {
      const contada = composto?.counted.find((fonte) => fonte.source === rating.source)
      expect(contada?.normalized, rating.source).toBe(rating.normalized)
      expect(contada?.group, rating.source).toBe(rating.group)
    }
  })
})

describe('como a pagina escreve a conta', () => {
  it('numeros em pt-BR, sem Intl', () => {
    expect(formatScoreDecimal(80)).toBe('80')
    expect(formatScoreDecimal(77.5)).toBe('77,5')
    expect(formatScoreDecimal(78.75)).toBe('78,75')
    expect(formatScoreCount(1200)).toBe('1.200')
    expect(formatScoreCount(50)).toBe('50')
  })

  it('as tres contas do exemplo', () => {
    expect(scoreExampleSteps()).toEqual({
      critics: '(90 + 70) ÷ 2 = 80',
      audience: '(80 × 3 + 70 × 1) ÷ 4 = 77,5',
      value: '(80 + 77,5) ÷ 2 = 78,75, arredondado para 79',
    })
  })
})
