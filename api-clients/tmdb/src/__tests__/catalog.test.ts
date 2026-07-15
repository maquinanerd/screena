/**
 * Testes dos endpoints de CATALOGO do TMDB (Fase 6): paths, params, discover
 * determinista + rejeicao de filtro desconhecido, busca e validadores de
 * envelope. 100% sem rede (transporte injetado).
 */

import { describe, expect, it } from 'vitest'
import {
  TmdbCatalogError,
  createTmdbCatalogEndpoints,
  validateTmdbCertificationList,
  validateTmdbConfiguration,
  validateTmdbGenreList,
  validateTmdbPage,
} from '../catalog.js'
import { loadTmdbConfig } from '../config.js'
import { TmdbHttpClient, type HttpRequest, type HttpResponse } from '../http.js'

function setup(env: Record<string, string> = { TMDB_API_KEY: 'k' }, body = '{}') {
  const calls: HttpRequest[] = []
  const config = loadTmdbConfig({ TMDB_DEFAULT_LANGUAGE: 'pt-BR', ...env })
  const response: HttpResponse = { status: 200, headers: {}, body }
  const client = new TmdbHttpClient(config, {
    transport: async (request) => {
      calls.push(request)
      return response
    },
    now: () => 0,
    sleep: async () => {},
    random: () => 0,
  })
  return { endpoints: createTmdbCatalogEndpoints(client, config), calls }
}

function query(url: string): URLSearchParams {
  return new URL(url).searchParams
}

describe('createTmdbCatalogEndpoints — paths e params', () => {
  it('getConfiguration usa /configuration (sem language)', async () => {
    const { endpoints, calls } = setup()
    await endpoints.getConfiguration()
    expect(calls[0]?.url).toContain('/configuration')
    expect(query(calls[0]?.url ?? '').get('language')).toBeNull()
  })

  it('taxonomias auxiliares usam os paths corretos', async () => {
    const { endpoints, calls } = setup()
    await endpoints.getCountries()
    await endpoints.getLanguages()
    await endpoints.getJobs()
    expect(calls[0]?.url).toContain('/configuration/countries')
    expect(calls[1]?.url).toContain('/configuration/languages')
    expect(calls[2]?.url).toContain('/configuration/jobs')
  })

  it('generos usam /genre/{movie,tv}/list com language default pt-BR', async () => {
    const { endpoints, calls } = setup()
    await endpoints.getMovieGenres()
    await endpoints.getTvGenres('en-US')
    expect(calls[0]?.url).toContain('/genre/movie/list')
    expect(query(calls[0]?.url ?? '').get('language')).toBe('pt-BR')
    expect(calls[1]?.url).toContain('/genre/tv/list')
    expect(query(calls[1]?.url ?? '').get('language')).toBe('en-US')
  })

  it('certificacoes usam /certification/{movie,tv}/list', async () => {
    const { endpoints, calls } = setup()
    await endpoints.getMovieCertifications()
    await endpoints.getTvCertifications()
    expect(calls[0]?.url).toContain('/certification/movie/list')
    expect(calls[1]?.url).toContain('/certification/tv/list')
  })

  it('listas de filme/serie usam os paths e defaults corretos (language=pt-BR, page=1)', async () => {
    const { endpoints, calls } = setup()
    await endpoints.getPopularMovies()
    await endpoints.getTopRatedMovies()
    await endpoints.getNowPlayingMovies({ region: 'BR', page: 2 })
    await endpoints.getPopularTvShows()
    await endpoints.getTopRatedTvShows()
    await endpoints.getAiringTodayTvShows()
    await endpoints.getOnTheAirTvShows()
    expect(calls[0]?.url).toContain('/movie/popular')
    expect(query(calls[0]?.url ?? '').get('language')).toBe('pt-BR')
    expect(query(calls[0]?.url ?? '').get('page')).toBe('1')
    expect(calls[1]?.url).toContain('/movie/top_rated')
    expect(calls[2]?.url).toContain('/movie/now_playing')
    expect(query(calls[2]?.url ?? '').get('region')).toBe('BR')
    expect(query(calls[2]?.url ?? '').get('page')).toBe('2')
    expect(calls[3]?.url).toContain('/tv/popular')
    expect(calls[4]?.url).toContain('/tv/top_rated')
    expect(calls[5]?.url).toContain('/tv/airing_today')
    expect(calls[6]?.url).toContain('/tv/on_the_air')
  })

  it('changes usam /{movie,tv,person}/changes com janela e page', async () => {
    const { endpoints, calls } = setup()
    await endpoints.getMovieChanges({ start_date: '2026-07-01', end_date: '2026-07-08', page: 2 })
    await endpoints.getTvChanges()
    await endpoints.getPersonChanges()
    const q = query(calls[0]?.url ?? '')
    expect(calls[0]?.url).toContain('/movie/changes')
    expect(q.get('start_date')).toBe('2026-07-01')
    expect(q.get('end_date')).toBe('2026-07-08')
    expect(q.get('page')).toBe('2')
    expect(calls[1]?.url).toContain('/tv/changes')
    expect(calls[2]?.url).toContain('/person/changes')
  })
})

describe('discover — determinismo e rejeicao de filtro', () => {
  it('discoverMovies serializa chaves de forma DETERMINISTA (ordenadas)', async () => {
    // Auth v4 (token no header) para nao poluir a query com `api_key` (v3).
    const { endpoints, calls } = setup({ TMDB_READ_ACCESS_TOKEN: 't' })
    await endpoints.discoverMovies({
      with_genres: '28',
      sort_by: 'popularity.desc',
      'vote_count.gte': 100,
      include_adult: false,
    })
    const raw = new URL(calls[0]?.url ?? '').search.replace(/^\?/, '')
    const keys = raw.split('&').map((kv) => kv.split('=')[0])
    const sorted = [...keys].sort()
    expect(keys).toEqual(sorted)
    const q = query(calls[0]?.url ?? '')
    expect(q.get('sort_by')).toBe('popularity.desc')
    expect(q.get('with_genres')).toBe('28')
    expect(q.get('vote_count.gte')).toBe('100')
    expect(q.get('include_adult')).toBe('false')
    expect(q.get('language')).toBe('pt-BR')
    expect(q.get('page')).toBe('1')
  })

  it('discoverMovies rejeita filtro desconhecido (TmdbCatalogError)', async () => {
    const { endpoints } = setup()
    await expect(
      endpoints.discoverMovies({ hacker_filter: 'x' } as never),
    ).rejects.toBeInstanceOf(TmdbCatalogError)
  })

  it('discoverTvShows usa /discover/tv e rejeita filtro fora do allowlist de TV', async () => {
    const { endpoints, calls } = setup()
    await endpoints.discoverTvShows({ with_networks: '213', sort_by: 'first_air_date.desc' })
    expect(calls[0]?.url).toContain('/discover/tv')
    // `region` nao pertence ao allowlist de discover TV.
    await expect(endpoints.discoverTvShows({ region: 'BR' } as never)).rejects.toBeInstanceOf(
      TmdbCatalogError,
    )
  })

  it('discover produz a MESMA query para os mesmos params (idempotencia de serializacao)', async () => {
    const a = setup()
    const b = setup()
    await a.endpoints.discoverMovies({ sort_by: 'popularity.desc', with_genres: '28' })
    await b.endpoints.discoverMovies({ with_genres: '28', sort_by: 'popularity.desc' })
    expect(new URL(a.calls[0]?.url ?? '').search).toBe(new URL(b.calls[0]?.url ?? '').search)
  })
})

describe('busca — query obrigatoria', () => {
  it('search usa /search/{movie,tv,person,multi} com query e language', async () => {
    const { endpoints, calls } = setup()
    await endpoints.searchMovies('duna')
    await endpoints.searchTvShows('severance')
    await endpoints.searchPeople('villeneuve')
    await endpoints.searchMulti('nolan')
    expect(calls[0]?.url).toContain('/search/movie')
    expect(query(calls[0]?.url ?? '').get('query')).toBe('duna')
    expect(query(calls[0]?.url ?? '').get('language')).toBe('pt-BR')
    expect(calls[1]?.url).toContain('/search/tv')
    expect(calls[2]?.url).toContain('/search/person')
    expect(calls[3]?.url).toContain('/search/multi')
  })

  it('search rejeita query vazia (TmdbCatalogError)', async () => {
    const { endpoints } = setup()
    await expect(endpoints.searchMovies('   ')).rejects.toBeInstanceOf(TmdbCatalogError)
  })
})

describe('auth v4 — token no header, nunca na URL', () => {
  it('usa Authorization: Bearer e NAO coloca o token na querystring', async () => {
    const { endpoints, calls } = setup({ TMDB_READ_ACCESS_TOKEN: 'super-secret-token' })
    await endpoints.getConfiguration()
    const req = calls[0]
    expect(req?.headers.authorization).toBe('Bearer super-secret-token')
    expect(req?.url).not.toContain('super-secret-token')
    expect(req?.url).not.toContain('api_key')
  })
})

describe('midia e trending', () => {
  it('imagens usam /{entity}/{id}/images nos paths corretos', async () => {
    const { endpoints, calls } = setup()
    await endpoints.getMovieImages(1)
    await endpoints.getTvImages(2)
    await endpoints.getSeasonImages(2, 3)
    await endpoints.getEpisodeImages(2, 3, 4)
    await endpoints.getPersonImages(5)
    expect(calls[0]?.url).toContain('/movie/1/images')
    expect(calls[1]?.url).toContain('/tv/2/images')
    expect(calls[2]?.url).toContain('/tv/2/season/3/images')
    expect(calls[3]?.url).toContain('/tv/2/season/3/episode/4/images')
    expect(calls[4]?.url).toContain('/person/5/images')
  })

  it('videos usam /{entity}/{id}/videos nos paths corretos', async () => {
    const { endpoints, calls } = setup()
    await endpoints.getMovieVideos(1)
    await endpoints.getTvVideos(2)
    await endpoints.getSeasonVideos(2, 3)
    await endpoints.getEpisodeVideos(2, 3, 4)
    expect(calls[0]?.url).toContain('/movie/1/videos')
    expect(calls[1]?.url).toContain('/tv/2/videos')
    expect(calls[2]?.url).toContain('/tv/2/season/3/videos')
    expect(calls[3]?.url).toContain('/tv/2/season/3/episode/4/videos')
  })

  it('trending usa /trending/{media_type}/{time_window} e valida os segmentos', async () => {
    const { endpoints, calls } = setup()
    await endpoints.getTrending('movie', 'day')
    await endpoints.getTrending('tv', 'week', { page: 2 })
    expect(calls[0]?.url).toContain('/trending/movie/day')
    expect(calls[1]?.url).toContain('/trending/tv/week')
    expect(query(calls[1]?.url ?? '').get('page')).toBe('2')
    await expect(endpoints.getTrending('hacker' as never, 'day')).rejects.toBeInstanceOf(TmdbCatalogError)
    await expect(endpoints.getTrending('movie', 'ano' as never)).rejects.toBeInstanceOf(TmdbCatalogError)
  })
})

describe('validadores de envelope', () => {
  it('validateTmdbPage aceita pagina valida e rejeita results nao-array / item sem id', () => {
    expect(validateTmdbPage({ page: 1, results: [{ id: 1 }], total_pages: 2, total_results: 3 }).ok).toBe(true)
    expect(validateTmdbPage({ results: 'x' }).ok).toBe(false)
    expect(validateTmdbPage({ results: [{ name: 'sem id' }] }).ok).toBe(false)
    expect(validateTmdbPage({ page: 'um' }).ok).toBe(false)
    expect(validateTmdbPage(null).ok).toBe(false)
  })

  it('validateTmdbConfiguration exige images.secure_base_url', () => {
    expect(
      validateTmdbConfiguration({ images: { secure_base_url: 'https://image.tmdb.org/t/p/', poster_sizes: ['w92'] } }).ok,
    ).toBe(true)
    expect(validateTmdbConfiguration({ images: { poster_sizes: ['w92'] } }).ok).toBe(false)
    expect(validateTmdbConfiguration({}).ok).toBe(false)
  })

  it('validateTmdbGenreList exige genres[] com id numerico', () => {
    expect(validateTmdbGenreList({ genres: [{ id: 28, name: 'Acao' }] }).ok).toBe(true)
    expect(validateTmdbGenreList({ genres: [{ name: 'sem id' }] }).ok).toBe(false)
    expect(validateTmdbGenreList({}).ok).toBe(false)
  })

  it('validateTmdbCertificationList exige mapa territorio -> array', () => {
    expect(
      validateTmdbCertificationList({ certifications: { BR: [{ certification: '14', order: 3 }] } }).ok,
    ).toBe(true)
    expect(validateTmdbCertificationList({ certifications: { BR: 'x' } }).ok).toBe(false)
    expect(validateTmdbCertificationList({}).ok).toBe(false)
  })
})
