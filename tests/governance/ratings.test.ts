/**
 * Testes de governanca — integridade de ratings (@screena/schemas).
 *
 * Garantem as invariantes 1 (nao misturar fontes/escalas/linguagem) e
 * 2 (provider_api != rating_source) na fronteira de validacao de ratings.
 */

import { describe, expect, it } from 'vitest'
import { validateRating, type RatingInput } from '@screena/schemas'

describe('validateRating', () => {
  it('(1) falha quando ratingSource e "imdb" mas o label e "Tomatometer"', () => {
    const input: RatingInput = {
      ratingSource: 'imdb',
      ratingLabel: 'Tomatometer',
      metric: 'tomatometer',
      ratingValue: 92,
      ratingScale: 10,
      providerApi: 'imdb236',
    }

    const result = validateRating(input)

    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.toLowerCase().includes('cross-label'))).toBe(true)
  })

  it('(2) falha quando providerApi e igual ao ratingSource', () => {
    const input: RatingInput = {
      ratingSource: 'imdb',
      ratingLabel: 'IMDb Rating',
      metric: 'user_rating',
      ratingValue: 8.4,
      ratingScale: 10,
      providerApi: 'imdb',
    }

    const result = validateRating(input)

    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.toLowerCase().includes('provider_api'))).toBe(true)
  })

  it('(3) falha quando imdb usa escala 100 (deveria ser 10)', () => {
    const input: RatingInput = {
      ratingSource: 'imdb',
      ratingLabel: 'IMDb Rating',
      metric: 'user_rating',
      ratingValue: 84,
      ratingScale: 100,
      providerApi: 'imdb236',
    }

    const result = validateRating(input)

    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.toLowerCase().includes('escala'))).toBe(true)
  })

  it('(4) passa: imdb 8.4 escala 10 label "IMDb Rating" provider "imdb236"', () => {
    const input: RatingInput = {
      ratingSource: 'imdb',
      ratingLabel: 'IMDb Rating',
      metric: 'user_rating',
      ratingValue: 8.4,
      ratingScale: 10,
      providerApi: 'imdb236',
    }

    const result = validateRating(input)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })
})
