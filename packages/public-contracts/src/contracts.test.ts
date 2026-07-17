/**
 * Testes dos contratos publicos (PURO). Cobre um fixture VALIDO por payload +
 * casos de falha representativos (tipo errado, invariante de busca noindex,
 * governanca de midia).
 */

import { describe, expect, it } from 'vitest'
import {
  filterDisplayAllowedMedia,
  validateMediaPayload,
  type MediaPayload,
  type PublicMediaAsset,
  type SeoPayload,
} from './primitives.js'
import { validateMovieDetail, validatePersonDetail, validateTvDetail } from './detail.js'
import { validateHomePayload } from './home.js'
import { validateSearchPayload, validateSearchResult } from './search.js'
import { validateCatalogStatusPayload, validateCatalogJobView } from './catalog-job.js'

const poster: PublicMediaAsset = {
  id: 'img-1',
  kind: 'poster',
  language: 'pt-BR',
  width: 500,
  height: 750,
  aspectRatio: 0.667,
  source: 'tmdb',
  displayAllowed: true,
  url: 'https://image.tmdb.org/t/p/w500/a.jpg',
  alt: 'Poster',
}

const media: MediaPayload = { poster, backdrop: null, images: [poster], videos: [] }

const seo: SeoPayload = {
  canonicalUrl: 'https://cinerie.com/pt/filmes/matrix/',
  index: true,
  robots: 'index,follow',
  metaTitle: 'Matrix',
  metaDescription: null,
  locale: 'pt-BR',
}

describe('media payload', () => {
  it('aceita um MediaPayload valido', () => {
    expect(validateMediaPayload(media).ok).toBe(true)
  })

  it('rejeita asset sem source tmdb', () => {
    const bad = { ...media, poster: { ...poster, source: 'imdb' } }
    const r = validateMediaPayload(bad)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/source/)
  })

  it('filterDisplayAllowedMedia remove assets nao permitidos (invariante 6)', () => {
    const blocked: PublicMediaAsset = { ...poster, id: 'img-2', displayAllowed: false }
    const filtered = filterDisplayAllowedMedia({
      poster: blocked,
      backdrop: poster,
      images: [poster, blocked],
      videos: [],
    })
    expect(filtered.poster).toBeNull() // poster bloqueado vira null
    expect(filtered.backdrop).not.toBeNull()
    expect(filtered.images).toHaveLength(1)
  })
})

describe('detail payloads', () => {
  it('valida um MovieDetailPayload', () => {
    const r = validateMovieDetail({
      kind: 'movie',
      id: '603',
      canonicalUrl: 'https://cinerie.com/pt/filmes/matrix/',
      title: 'Matrix',
      originalTitle: 'The Matrix',
      aliases: ['The Matrix'],
      overview: null,
      releaseDate: '1999-03-31',
      year: 1999,
      runtimeMinutes: 136,
      certification: '14',
      genres: [{ kind: 'movie', id: '28', title: 'Acao', canonicalUrl: null }],
      cast: [
        {
          person: { kind: 'person', id: '6384', title: 'Keanu Reeves', canonicalUrl: null },
          character: 'Neo',
          job: null,
          department: null,
        },
      ],
      crew: [],
      collection: null,
      media,
      ratings: [],
      streaming: [],
      seo,
    })
    expect(r.ok).toBe(true)
    expect(r.value?.title).toBe('Matrix')
  })

  it('rejeita filme com kind errado', () => {
    const r = validateMovieDetail({
      kind: 'tv',
      id: '1',
      canonicalUrl: 'x',
      title: 't',
      aliases: [],
      genres: [],
      cast: [],
      crew: [],
      collection: null,
      media,
      seo,
    })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/kind/)
  })

  it('valida um TvDetailPayload com temporadas', () => {
    const r = validateTvDetail({
      kind: 'tv',
      id: '1',
      canonicalUrl: 'https://cinerie.com/pt/series/round-6/',
      title: 'Round 6',
      originalTitle: null,
      aliases: [],
      overview: null,
      firstAirDate: null,
      lastAirDate: null,
      year: 2021,
      numberOfSeasons: 2,
      numberOfEpisodes: 16,
      certification: null,
      genres: [],
      cast: [],
      seasons: [
        { id: '10', seasonNumber: 1, name: 'Temporada 1', episodeCount: 9, canonicalUrl: null },
      ],
      media,
      ratings: [],
      streaming: [],
      seo,
    })
    expect(r.ok).toBe(true)
  })

  it('valida um PersonDetailPayload', () => {
    const r = validatePersonDetail({
      kind: 'person',
      id: '6384',
      canonicalUrl: 'https://cinerie.com/pt/pessoas/keanu-reeves/',
      name: 'Keanu Reeves',
      roleLabel: 'Ator',
      birthday: '1964-09-02',
      deathday: null,
      placeOfBirth: 'Beirute, Libano',
      biography: null,
      credits: [],
      media,
      seo,
    })
    expect(r.ok).toBe(true)
  })
})

describe('home payload', () => {
  it('valida uma HomePayload', () => {
    const card = {
      kind: 'movie',
      id: '603',
      title: 'Matrix',
      href: '/pt/filmes/matrix/',
      subtitle: 'Filme · 1999',
      year: 1999,
      image: poster,
      screenScore: 4.5,
    }
    const r = validateHomePayload({ locale: 'pt-BR', hero: [card], trending: [card], upcoming: [] })
    expect(r.ok).toBe(true)
  })
})

describe('search payload', () => {
  const result = {
    entityId: '603',
    type: 'movie',
    title: 'Matrix',
    subtitle: 'Filme · 1999',
    year: 1999,
    image: null,
    canonicalUrl: 'https://cinerie.com/pt/filmes/matrix/',
    matchReason: 'exact',
    score: 1,
  }

  it('valida um SearchResult', () => {
    expect(validateSearchResult(result).ok).toBe(true)
  })

  it('valida um SearchPayload noindex', () => {
    const r = validateSearchPayload({
      query: 'matrix',
      locale: 'pt-BR',
      results: [result],
      total: 1,
      limit: 20,
      offset: 0,
      index: false,
    })
    expect(r.ok).toBe(true)
  })

  it('rejeita SearchPayload que tenta indexar (index !== false)', () => {
    const r = validateSearchPayload({
      query: 'matrix',
      locale: 'pt-BR',
      results: [],
      total: 0,
      limit: 20,
      offset: 0,
      index: true,
    })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/noindex/)
  })
})

describe('catalog job view', () => {
  const job = {
    id: '42',
    jobType: 'sync_details',
    status: 'dead_letter',
    entityType: 'movie',
    externalId: '603',
    attempts: 5,
    maxAttempts: 5,
    priority: 100,
    availableAt: '2026-07-16T12:00:00.000Z',
    lastErrorCode: 'tmdb_5xx',
    lastErrorSafe: 'upstream 503',
  }

  it('valida um CatalogJobView', () => {
    expect(validateCatalogJobView(job).ok).toBe(true)
  })

  it('valida um CatalogStatusPayload com contagens por estado', () => {
    const r = validateCatalogStatusPayload({
      counts: {
        pending: 3,
        claimed: 0,
        running: 1,
        retry_wait: 2,
        succeeded: 10,
        failed: 0,
        dead_letter: 1,
        cancelled: 0,
      },
      deadLetter: [job],
    })
    expect(r.ok).toBe(true)
  })

  it('rejeita status invalido', () => {
    const r = validateCatalogJobView({ ...job, status: 'exploded' })
    expect(r.ok).toBe(false)
  })
})
