/**
 * cinerie-score-escala-unica.test.ts — UMA escala para a nota, em TODOS os
 * pontos de leitura.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE ARQUIVO TRAVA
 * ============================================================================
 * O worker (`services/ratings score:compute`) sempre gravou o Cinerie Score em
 * escala **100**. A ficha sempre o exibiu em **100**
 * (`CINERIE_SCORE_DISPLAY_SCALE`). E `home-hero-presenter.ts` declarava
 * `SCREEN_SCORE_SCALE = 5`, com o gate dos cards e do hero exigindo
 * `scale === 5`.
 *
 * Isso nao e arredondamento: e uma nota lida errada por um fator de 20. Na
 * pratica nem chegava a ser lida errada — era descartada em silencio, porque um
 * calculo em 100 nunca passa num gate que pede 5. A nota nao aparecia em
 * NENHUMA listagem, card ou busca, e nada em lugar nenhum reclamava.
 *
 * ============================================================================
 * O TESTE E POR VALOR, NAO POR CONSTANTE
 * ============================================================================
 * Comparar `SCREEN_SCORE_SCALE === CINERIE_SCORE_DISPLAY_SCALE` provaria pouco:
 * as duas poderiam ser 5 e o teste passaria com a nota igualmente invisivel. Por
 * isso o eixo aqui e um NUMERO CONCRETO — uma nota gravada como 82 tem de sair
 * como 82 nos dois lados — e o controle negativo confere que a escala errada
 * continua sendo recusada.
 */

import { describe, expect, it } from 'vitest'

import {
  CINERIE_SCORE_DISPLAY_SCALE,
  decideCinerieScore,
} from '../../apps/web/src/lib/cinerie-score-presenter'
import {
  resolveHeroRating,
  SCREEN_SCORE_EDITORIAL_SOURCE,
  SCREEN_SCORE_SCALE,
  type HeroSlideInput,
} from '../../apps/web/src/lib/home-hero-presenter'
import { resolveCardScreenScore } from '../../apps/web/src/lib/entity-index-presenter'

/** A nota de referencia: 82, na escala em que o worker de fato grava. */
const NOTA = 82

function slide(overrides: Partial<HeroSlideInput> = {}): HeroSlideInput {
  return {
    kind: 'movie',
    title: 'Deadpool 2',
    slug: 'deadpool-2',
    year: 2018,
    seasonsCount: null,
    episodesCount: null,
    certification: null,
    screenScore: NOTA,
    screenScoreScale: SCREEN_SCORE_SCALE,
    screenScoreDisplay: true,
    screenScoreSource: SCREEN_SCORE_EDITORIAL_SOURCE,
    director: null,
    cast: [],
    summary: null,
    backdropPath: null,
    posterPath: null,
    ...overrides,
  }
}

describe('a escala do Cinerie Score e UMA so', () => {
  it('vale 100 — a escala em que o worker grava e a ficha exibe', () => {
    expect(SCREEN_SCORE_SCALE).toBe(100)
    expect(CINERIE_SCORE_DISPLAY_SCALE).toBe(100)
  })

  it('hero e card leem a MESMA escala do presenter da ficha', () => {
    expect(SCREEN_SCORE_SCALE).toBe(CINERIE_SCORE_DISPLAY_SCALE)
  })
})

describe('82 sai 82 em todos os pontos de leitura', () => {
  it('FICHA: decideCinerieScore devolve 82/100', () => {
    const decision = decideCinerieScore({
      authorized: true,
      value: NOTA,
      counted: [
        { source: 'imdb', normalized: 82, group: 'audience', weight: 1 },
        { source: 'rotten_tomatoes', normalized: 83, group: 'critics', weight: 1 },
      ],
    })
    expect(decision.rendered).toBe(true)
    if (!decision.rendered) return
    expect(decision.view.value).toBe(NOTA)
    expect(decision.view.scale).toBe(100)
  })

  it('HERO: resolveHeroRating devolve 82/100 (e nao null)', () => {
    const rating = resolveHeroRating(slide())
    expect(rating).not.toBeNull()
    expect(rating?.value).toBe(NOTA)
    expect(rating?.scale).toBe(100)
  })

  it('CARD: resolveCardScreenScore devolve "82" — inteiro, sem decimal fantasma', () => {
    expect(
      resolveCardScreenScore({
        screenScore: NOTA,
        screenScoreScale: SCREEN_SCORE_SCALE,
        screenScoreDisplay: true,
        screenScoreSource: SCREEN_SCORE_EDITORIAL_SOURCE,
      }),
    ).toBe('82')
  })
})

describe('CONTROLE NEGATIVO: a escala errada continua sendo recusada', () => {
  it('a nota gravada na escala ANTIGA (5) nao passa mais — e nao vira 4,1', () => {
    // Este e o teste que impede a "correcao" preguicosa de aceitar as duas
    // escalas. Aceitar as duas faria 4.1 e 82 conviverem na mesma coluna da
    // mesma tela, e nenhuma leitura estaria errada isoladamente.
    expect(resolveHeroRating(slide({ screenScore: 4.1, screenScoreScale: 5 }))).toBeNull()
    expect(
      resolveCardScreenScore({
        screenScore: 4.1,
        screenScoreScale: 5,
        screenScoreDisplay: true,
        screenScoreSource: SCREEN_SCORE_EDITORIAL_SOURCE,
      }),
    ).toBeNull()
  })

  it('valor acima da escala nao passa', () => {
    expect(resolveHeroRating(slide({ screenScore: 101 }))).toBeNull()
  })

  it('sem origem editorial nao passa, mesmo na escala certa', () => {
    expect(resolveHeroRating(slide({ screenScoreSource: null }))).toBeNull()
  })

  it('sem display liberado nao passa, mesmo na escala certa', () => {
    expect(resolveHeroRating(slide({ screenScoreDisplay: false }))).toBeNull()
  })
})
