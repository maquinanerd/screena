/**
 * Testes de contrato/mapeamento do normalizer de filme.
 */

import { describe, expect, it } from 'vitest'
import type { TmdbMovieDetail } from '@screena/tmdb-client'
import { normalizeMovie } from '../normalizers/movie.js'
import { NormalizationError } from '../types.js'

const FIXTURE: TmdbMovieDetail = {
  id: 27205,
  original_title: 'Inception',
  title: 'A Origem',
  original_language: 'en',
  release_date: '2010-07-15',
  runtime: 148,
  status: 'Released',
  popularity: 80.5,
  vote_average: 8.4,
  vote_count: 34000,
  poster_path: '/poster.jpg',
  backdrop_path: '/backdrop.jpg',
  external_ids: { imdb_id: 'tt1375666' },
  credits: {
    cast: [
      {
        id: 6193,
        name: 'Leonardo DiCaprio',
        character: 'Cobb',
        order: 0,
        credit_id: 'c1',
        known_for_department: 'Acting',
        gender: 2,
        profile_path: '/leo.jpg',
      },
    ],
    crew: [
      {
        id: 525,
        name: 'Christopher Nolan',
        department: 'Directing',
        job: 'Director',
        credit_id: 'c2',
        known_for_department: 'Directing',
        gender: 2,
        profile_path: '/nolan.jpg',
      },
    ],
  },
}

describe('normalizeMovie', () => {
  it('mapeia campos canonicos usando o titulo ORIGINAL', () => {
    const { movie } = normalizeMovie(FIXTURE)
    expect(movie.tmdbId).toBe(27205)
    expect(movie.titleOriginal).toBe('Inception')
    expect(movie.imdbId).toBe('tt1375666')
    expect(movie.originalLanguage).toBe('en')
    expect(movie.releaseDate).toBe('2010-07-15')
    expect(movie.runtimeMinutes).toBe(148)
    expect(movie.voteAverageTmdb).toBe(8.4)
    expect(movie.voteCountTmdb).toBe(34000)
  })

  it('gera external ids tmdb + imdb com URLs canonicas', () => {
    const { externalIds } = normalizeMovie(FIXTURE)
    expect(externalIds).toEqual([
      { source: 'tmdb', externalId: '27205', url: 'https://www.themoviedb.org/movie/27205' },
      { source: 'imdb', externalId: 'tt1375666', url: 'https://www.imdb.com/title/tt1375666/' },
    ])
  })

  it('normaliza cast e crew com stubs de pessoa', () => {
    const { cast, crew } = normalizeMovie(FIXTURE)
    expect(cast[0]).toMatchObject({
      personTmdbId: 6193,
      character: 'Cobb',
      billingOrder: 0,
      creditId: 'c1',
    })
    expect(cast[0]?.person.name).toBe('Leonardo DiCaprio')
    expect(crew[0]).toMatchObject({ personTmdbId: 525, job: 'Director', department: 'Directing' })
  })

  it('imdb_id vazio -> null e sem external id imdb', () => {
    const { movie, externalIds } = normalizeMovie({
      ...FIXTURE,
      imdb_id: '',
      external_ids: { imdb_id: '' },
    })
    expect(movie.imdbId).toBeNull()
    expect(externalIds.some((entry) => entry.source === 'imdb')).toBe(false)
  })

  it('idioma fora do seed -> null (R1)', () => {
    const { movie } = normalizeMovie({ ...FIXTURE, original_language: 'ja' })
    expect(movie.originalLanguage).toBeNull()
  })

  it('lanca NormalizationError sem titulo', () => {
    expect(() => normalizeMovie({ id: 1, original_title: '', title: '' })).toThrow(
      NormalizationError,
    )
  })
})
