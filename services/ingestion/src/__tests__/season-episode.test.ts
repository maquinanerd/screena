/**
 * Testes de contrato/mapeamento dos normalizers de temporada e episodio.
 */

import { describe, expect, it } from 'vitest'
import type { TmdbSeasonDetail } from '@screena/tmdb-client'
import { normalizeSeason } from '../normalizers/season.js'
import { normalizeEpisode } from '../normalizers/episode.js'

const SEASON: TmdbSeasonDetail = {
  id: 3624,
  season_number: 1,
  name: 'Season 1',
  overview: 'descricao crua',
  air_date: '2011-04-17',
  poster_path: '/s1.jpg',
  episodes: [
    {
      id: 63056,
      episode_number: 1,
      name: 'Winter Is Coming',
      overview: 'x',
      air_date: '2011-04-17',
      runtime: 62,
      still_path: '/e1.jpg',
    },
    { id: 63057, episode_number: 2, name: 'The Kingsroad', air_date: '2011-04-24', runtime: 56 },
  ],
}

describe('normalizeSeason', () => {
  it('mapeia temporada + episodios e deriva episodeCount do array', () => {
    const { season, episodes } = normalizeSeason(SEASON)
    expect(season.seasonNumber).toBe(1)
    expect(season.tmdbId).toBe(3624)
    expect(season.episodeCount).toBe(2)
    expect(episodes).toHaveLength(2)
    expect(episodes[0]?.episodeNumber).toBe(1)
    expect(episodes[1]?.name).toBe('The Kingsroad')
  })

  it('temporada sem episodios -> episodeCount 0', () => {
    const { season } = normalizeSeason({ season_number: 5 })
    expect(season.episodeCount).toBe(0)
  })
})

describe('normalizeEpisode', () => {
  it('mapeia campos e descarta data invalida', () => {
    const episode = normalizeEpisode({ id: 1, episode_number: 3, air_date: '' })
    expect(episode.episodeNumber).toBe(3)
    expect(episode.airDate).toBeNull()
  })
})
