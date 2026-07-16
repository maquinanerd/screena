/**
 * Testes dos normalizadores das entidades de referencia (PURO, sem rede/DB).
 */

import { describe, expect, it } from 'vitest'
import {
  extractAlternativeTitles,
  extractCollectionRef,
  extractKeywords,
  extractNetworks,
  extractProductionCompanies,
  normalizeCollectionDetail,
  normalizeCollectionParts,
  normalizeCompanyDetail,
  normalizeKeywordDetail,
  normalizeNetworkDetail,
} from '../normalize.js'

describe('normalizeCollectionDetail', () => {
  it('normaliza o detalhe da colecao', () => {
    const row = normalizeCollectionDetail({
      id: 10,
      name: 'Colecao Matrix',
      overview: 'A franquia',
      poster_path: '/p.jpg',
      backdrop_path: '/b.jpg',
    })
    expect(row).toEqual({
      tmdbId: 10,
      name: 'Colecao Matrix',
      overview: 'A franquia',
      posterPath: '/p.jpg',
      backdropPath: '/b.jpg',
    })
  })

  it('descarta payload sem id ou sem nome (nunca inventa fato)', () => {
    expect(normalizeCollectionDetail({ name: 'sem id' })).toBeNull()
    expect(normalizeCollectionDetail({ id: 10 })).toBeNull()
    expect(normalizeCollectionDetail({ id: 0, name: 'id invalido' })).toBeNull()
    expect(normalizeCollectionDetail(null)).toBeNull()
    expect(normalizeCollectionDetail([])).toBeNull()
  })

  it('normaliza os membros (parts) preservando a ordem', () => {
    const parts = normalizeCollectionParts({
      id: 10,
      parts: [{ id: 603 }, { id: 604 }, { nope: true }, { id: 605 }],
    })
    expect(parts).toEqual([
      { tmdbId: 603, position: 0 },
      { tmdbId: 604, position: 1 },
      { tmdbId: 605, position: 2 },
    ])
  })
})

describe('normalizeCompanyDetail / normalizeNetworkDetail / normalizeKeywordDetail', () => {
  it('normaliza produtora', () => {
    expect(
      normalizeCompanyDetail({
        id: 5,
        name: 'Warner',
        logo_path: '/l.png',
        origin_country: 'US',
        headquarters: 'Burbank',
        homepage: 'https://warner.com',
      }),
    ).toEqual({
      tmdbId: 5,
      name: 'Warner',
      logoPath: '/l.png',
      originCountry: 'US',
      headquarters: 'Burbank',
      homepage: 'https://warner.com',
    })
  })

  it('rede usa a mesma forma de produtora', () => {
    expect(normalizeNetworkDetail({ id: 213, name: 'Netflix' })?.name).toBe('Netflix')
  })

  it('normaliza keyword e descarta invalida', () => {
    expect(normalizeKeywordDetail({ id: 9715, name: 'superhero' })).toEqual({
      tmdbId: 9715,
      name: 'superhero',
    })
    expect(normalizeKeywordDetail({ id: 9715, name: '   ' })).toBeNull()
  })
})

describe('extractCollectionRef', () => {
  it('extrai belongs_to_collection do detalhe do filme', () => {
    const ref = extractCollectionRef({
      id: 603,
      belongs_to_collection: { id: 2344, name: 'Colecao Matrix', poster_path: '/p.jpg' },
    })
    expect(ref?.tmdbId).toBe(2344)
    expect(ref?.overview).toBeNull() // o GET dedicado traz o overview
  })

  it('filme sem colecao => null', () => {
    expect(extractCollectionRef({ id: 603, belongs_to_collection: null })).toBeNull()
    expect(extractCollectionRef({ id: 603 })).toBeNull()
  })
})

describe('extractProductionCompanies / extractNetworks', () => {
  it('extrai e deduplica produtoras', () => {
    const rows = extractProductionCompanies({
      production_companies: [
        { id: 5, name: 'Warner', logo_path: '/w.png', origin_country: 'US' },
        { id: 5, name: 'Warner (dup)' },
        { name: 'sem id' },
        { id: 7, name: 'Village Roadshow' },
      ],
    })
    expect(rows.map((r) => r.tmdbId)).toEqual([5, 7])
    expect(rows[0]?.originCountry).toBe('US')
  })

  it('extrai redes do detalhe de tv', () => {
    const rows = extractNetworks({ networks: [{ id: 213, name: 'Netflix', origin_country: 'US' }] })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('Netflix')
  })

  it('sem bloco => lista vazia', () => {
    expect(extractProductionCompanies({})).toEqual([])
    expect(extractNetworks(null)).toEqual([])
  })
})

describe('extractKeywords', () => {
  it('aceita a forma de movie (keywords[]) e de tv (results[])', () => {
    expect(extractKeywords({ keywords: { keywords: [{ id: 1, name: 'a' }] } })).toEqual([
      { tmdbId: 1, name: 'a' },
    ])
    expect(extractKeywords({ keywords: { results: [{ id: 2, name: 'b' }] } })).toEqual([
      { tmdbId: 2, name: 'b' },
    ])
  })

  it('deduplica por tmdbId', () => {
    const rows = extractKeywords({
      keywords: { keywords: [{ id: 1, name: 'a' }], results: [{ id: 1, name: 'a dup' }] },
    })
    expect(rows).toHaveLength(1)
  })
})

describe('extractAlternativeTitles', () => {
  it('aceita movie (titles[]) e tv (results[]) e dobra o normalized', () => {
    const rows = extractAlternativeTitles({
      alternative_titles: {
        titles: [{ iso_3166_1: 'BR', title: 'A Sociedade do Anel', type: 'BR title' }],
      },
    })
    expect(rows).toEqual([
      {
        countryCode: 'BR',
        title: 'A Sociedade do Anel',
        normalized: 'a sociedade do anel',
        type: 'BR title',
      },
    ])
  })

  it('normalized e acento-insensivel (alimenta o alias exato da busca)', () => {
    const rows = extractAlternativeTitles({
      alternative_titles: { results: [{ iso_3166_1: 'FR', title: 'Amélie' }] },
    })
    expect(rows[0]?.normalized).toBe('amelie')
  })

  it('deduplica por (pais, titulo dobrado) e descarta titulo vazio', () => {
    const rows = extractAlternativeTitles({
      alternative_titles: {
        titles: [
          { iso_3166_1: 'BR', title: 'Matrix' },
          { iso_3166_1: 'BR', title: 'MATRIX' }, // mesma dobra => duplicata
          { iso_3166_1: 'US', title: 'Matrix' }, // pais diferente => distinto
          { iso_3166_1: 'BR', title: '  ' },
        ],
      },
    })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.countryCode)).toEqual(['BR', 'US'])
  })

  it('sem bloco => lista vazia', () => {
    expect(extractAlternativeTitles({})).toEqual([])
  })
})
