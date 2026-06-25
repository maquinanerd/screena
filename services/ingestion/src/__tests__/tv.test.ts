/**
 * Testes de contrato/mapeamento do normalizer de serie.
 */

import { describe, expect, it } from 'vitest'
import type { TmdbTvDetail } from '@screena/tmdb-client'
import { normalizeTvShow } from '../normalizers/tv.js'

const TV: TmdbTvDetail = {
  id: 1399,
  original_name: 'Game of Thrones',
  name: 'A Guerra dos Tronos',
  original_language: 'en',
  first_air_date: '2011-04-17',
  last_air_date: '2019-05-19',
  status: 'Ended',
  number_of_seasons: 8,
  number_of_episodes: 73,
  popularity: 300,
  vote_average: 8.4,
  vote_count: 20000,
  poster_path: '/got.jpg',
  backdrop_path: '/gotb.jpg',
  external_ids: { imdb_id: 'tt0944947' },
  seasons: [
    { season_number: 0, episode_count: 5 },
    { season_number: 1, episode_count: 10 },
    { season_number: 2, episode_count: 10 },
  ],
}

describe('normalizeTvShow', () => {
  it('mapeia campos canonicos usando o nome ORIGINAL', () => {
    const { tvShow } = normalizeTvShow(TV)
    expect(tvShow.tmdbId).toBe(1399)
    expect(tvShow.nameOriginal).toBe('Game of Thrones')
    expect(tvShow.numberOfSeasons).toBe(8)
    expect(tvShow.numberOfEpisodes).toBe(73)
    expect(tvShow.firstAirDate).toBe('2011-04-17')
    expect(tvShow.imdbId).toBe('tt0944947')
  })

  it('extrai seasonNumbers (incluindo a temporada 0 / specials)', () => {
    const { seasonNumbers } = normalizeTvShow(TV)
    expect(seasonNumbers).toEqual([0, 1, 2])
  })

  it('gera external id imdb com URL canonica', () => {
    const { externalIds } = normalizeTvShow(TV)
    expect(externalIds).toContainEqual({
      source: 'imdb',
      externalId: 'tt0944947',
      url: 'https://www.imdb.com/title/tt0944947/',
    })
  })
})
