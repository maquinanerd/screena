/**
 * normalize-detail-facts.test.ts — Os fatos da ficha que o detalhe entregava e
 * o pipeline descartava (quarta ocorrencia do padrao).
 *
 * O que se trava: a classificacao persistida e SO a do recorte BR (a americana
 * nunca entra com rotulo de brasileira); orcamento 0 = "nao informado" e vira
 * null; pais e grafado ISO alpha-2 ou nao entra; e a semantica de PRESENCA
 * (payload sem o bloco nunca vira "lista vazia" que apaga o gravado).
 */

import { describe, expect, it } from 'vitest'

import {
  normalizeBrContentRating,
  normalizeBrReleaseFacts,
  normalizeBudget,
  normalizeMovieProductionCountries,
  normalizeTvOriginCountries,
} from '../normalizers/detail-facts.js'

describe('normalizeBudget', () => {
  it('inteiro positivo entra como bigint', () => {
    expect(normalizeBudget(63_000_000)).toBe(63_000_000n)
  })
  it('0 do upstream significa "nao informado" e vira null — nunca orcamento de zero', () => {
    expect(normalizeBudget(0)).toBeNull()
  })
  it('negativo, fracionario, string e ausencia nao entram', () => {
    expect(normalizeBudget(-5)).toBeNull()
    expect(normalizeBudget(1.5)).toBeNull()
    expect(normalizeBudget('63000000')).toBeNull()
    expect(normalizeBudget(undefined)).toBeNull()
  })
})

describe('paises de origem', () => {
  it('filme: preserva a ordem do payload e descarta codigo fora da grafia ISO', () => {
    const out = normalizeMovieProductionCountries([
      { iso_3166_1: 'US', name: 'United States of America' },
      { iso_3166_1: 'us ', name: 'duplicata em caixa baixa' },
      { iso_3166_1: 'BRA', name: 'alpha-3 nao entra' },
      { iso_3166_1: 'NZ', name: 'New Zealand' },
    ])
    expect(out.present).toBe(true)
    expect(out.links).toEqual([
      { countryCode: 'US', position: 0 },
      { countryCode: 'NZ', position: 1 },
    ])
  })

  it('serie: origin_country e lista de strings', () => {
    const out = normalizeTvOriginCountries(['BR', 'US'])
    expect(out.links.map((l) => l.countryCode)).toEqual(['BR', 'US'])
  })

  it('PRESENCA: payload sem o bloco NAO e lista vazia (nada e apagado)', () => {
    expect(normalizeMovieProductionCountries(undefined).present).toBe(false)
    expect(normalizeTvOriginCountries(undefined).present).toBe(false)
    expect(normalizeMovieProductionCountries([]).present).toBe(true)
  })
})

describe('recorte BR de release_dates (filme)', () => {
  const payload = {
    results: [
      {
        iso_3166_1: 'US',
        release_dates: [
          { certification: 'R', release_date: '1999-03-31T00:00:00.000Z', type: 3 },
        ],
      },
      {
        iso_3166_1: 'BR',
        release_dates: [
          { certification: '', release_date: '1999-06-10T00:00:00.000Z', type: 4 },
          { certification: '14', release_date: '1999-05-21T00:00:00.000Z', type: 3 },
        ],
      },
    ],
  }

  it('a classificacao e a BRASILEIRA — a americana nunca entra com rotulo de brasileira', () => {
    const out = normalizeBrReleaseFacts(payload)
    expect(out.certification).toBe('14')
    expect(out.certification).not.toBe('R')
  })

  it('a estreia regional e a de CINEMA do recorte BR', () => {
    expect(normalizeBrReleaseFacts(payload).releaseDateBr).toBe('1999-05-21')
  })

  it('SO a americana no payload => NADA e persistido (nem cert, nem data)', () => {
    const out = normalizeBrReleaseFacts({
      results: [
        {
          iso_3166_1: 'US',
          release_dates: [
            { certification: 'PG-13', release_date: '2010-07-16T00:00:00.000Z', type: 3 },
          ],
        },
      ],
    })
    expect(out.present).toBe(true)
    expect(out.certification).toBeNull()
    expect(out.releaseDateBr).toBeNull()
  })

  it('sem cinema no BR, a estreia e a MENOR data valida do recorte', () => {
    const out = normalizeBrReleaseFacts({
      results: [
        {
          iso_3166_1: 'BR',
          release_dates: [
            { certification: '12', release_date: '2020-09-02T00:00:00.000Z', type: 4 },
            { certification: '', release_date: '2020-08-20T00:00:00.000Z', type: 6 },
          ],
        },
      ],
    })
    expect(out.releaseDateBr).toBe('2020-08-20')
    expect(out.certification).toBe('12')
  })

  it('PRESENCA: payload sem o append nao substitui nada', () => {
    expect(normalizeBrReleaseFacts(undefined).present).toBe(false)
    expect(normalizeBrReleaseFacts({}).present).toBe(false)
  })
})

describe('recorte BR de content_ratings (serie)', () => {
  it('a classificacao e a do BR; TV-MA americano nao vira rotulo brasileiro', () => {
    const out = normalizeBrContentRating({
      results: [
        { iso_3166_1: 'US', rating: 'TV-MA' },
        { iso_3166_1: 'BR', rating: '16' },
      ],
    })
    expect(out.certification).toBe('16')
  })

  it('so o americano => null (a ficha nao mostra, em vez de mentir o pais)', () => {
    const out = normalizeBrContentRating({
      results: [{ iso_3166_1: 'US', rating: 'TV-MA' }],
    })
    expect(out.present).toBe(true)
    expect(out.certification).toBeNull()
  })
})
