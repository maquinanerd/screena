/**
 * score-type.test.ts — Classificacao critics/audience.
 *
 * O caso que importa: quando NAO da para afirmar, `null` e a resposta certa.
 * Um chute aqui troca critica por publico — o erro exato da invariante 1.
 */

import { describe, expect, it } from 'vitest'

import { classifyRatingScoreType } from '../score-type.js'

describe('classificacao por MARCA (inequivoca em qualquer contexto)', () => {
  it('Tomatometer e critica', () => {
    expect(
      classifyRatingScoreType({ ratingSource: 'rotten_tomatoes', metric: 'tomatometer', ratingLabel: 'Tomatometer' }),
    ).toBe('critics')
  })

  it('Popcornmeter e publico', () => {
    expect(
      classifyRatingScoreType({ ratingSource: 'rotten_tomatoes', metric: 'popcornmeter', ratingLabel: 'Popcornmeter' }),
    ).toBe('audience')
  })

  it('Metascore e critica; User Score e publico (mesma fonte, notas opostas)', () => {
    expect(
      classifyRatingScoreType({ ratingSource: 'metacritic', metric: 'metascore', ratingLabel: 'Metascore' }),
    ).toBe('critics')
    expect(
      classifyRatingScoreType({ ratingSource: 'metacritic', metric: 'userscore', ratingLabel: 'User Score' }),
    ).toBe('audience')
  })

  it('a marca vence o vocabulario generico da metrica', () => {
    // Metrica diz "critic", rotulo diz "Popcornmeter". Popcornmeter e publico,
    // ponto — a marca e mais especifica que a palavra solta.
    expect(
      classifyRatingScoreType({ ratingSource: 'rotten_tomatoes', metric: 'critic_x', ratingLabel: 'Popcornmeter' }),
    ).toBe('audience')
  })
})

describe('classificacao por vocabulario da metrica', () => {
  it.each([
    ['critics', 'critics'],
    ['critic_score', 'critics'],
    ['audience', 'audience'],
    ['user_rating', 'audience'],
    ['vote_average', 'audience'],
  ])('metrica "%s" => %s', (metric, expected) => {
    expect(classifyRatingScoreType({ ratingSource: 'imdb', metric, ratingLabel: 'IMDb Rating' })).toBe(expected)
  })
})

describe('classificacao por natureza da fonte (ultimo recurso, metrica generica)', () => {
  it.each(['imdb', 'letterboxd', 'filmaffinity'])(
    '%s com metrica generica e nota de publico (nao ha painel de criticos)',
    (source) => {
      expect(classifyRatingScoreType({ ratingSource: source, metric: 'rating', ratingLabel: source })).toBe('audience')
    },
  )
})

describe('fail-closed: o que nao da para afirmar devolve null', () => {
  it('metrica generica de fonte que publica DUAS notas e ambigua => null', () => {
    // Rotten Tomatoes e Metacritic publicam critica E publico. "score" nao diz
    // qual. Adivinhar trocaria uma pela outra.
    expect(
      classifyRatingScoreType({ ratingSource: 'rotten_tomatoes', metric: 'score', ratingLabel: 'Rotten Tomatoes' }),
    ).toBeNull()
    expect(
      classifyRatingScoreType({ ratingSource: 'metacritic', metric: 'score', ratingLabel: 'Metacritic' }),
    ).toBeNull()
  })

  it('metrica desconhecida => null (nunca "editorial" de consolo)', () => {
    // `editorial` significa "nota da propria casa". Uma nota de terceiro jamais
    // e isso — usar editorial como default seria pior que nao classificar.
    const result = classifyRatingScoreType({ ratingSource: 'imdb', metric: 'xyz_novo', ratingLabel: 'IMDb' })
    expect(result).toBeNull()
    expect(result).not.toBe('editorial')
  })
})
