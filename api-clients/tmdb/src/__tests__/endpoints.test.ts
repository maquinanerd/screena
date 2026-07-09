/**
 * Testes dos endpoints TMDB: paths e params corretos. Sem rede.
 *
 * As asserts de `append_to_response` derivam das constantes canonicas
 * (`append-to-response.ts`) — nunca de string escrita a mao — e leem o valor
 * ja decodificado via `URL.searchParams`, sem depender do encoding do query.
 */

import { describe, expect, it } from 'vitest'
import {
  MOVIE_APPEND,
  PERSON_APPEND,
  TV_APPEND,
  TV_EPISODE_APPEND,
  TV_SEASON_APPEND,
} from '../append-to-response.js'
import { loadTmdbConfig } from '../config.js'
import { createTmdbEndpoints } from '../endpoints.js'
import { TmdbHttpClient, type HttpResponse } from '../http.js'

function setup() {
  const urls: string[] = []
  const config = loadTmdbConfig({ TMDB_API_KEY: 'k', TMDB_DEFAULT_LANGUAGE: 'pt-BR' })
  const response: HttpResponse = { status: 200, headers: {}, body: '{}' }
  const client = new TmdbHttpClient(config, {
    transport: async (request) => {
      urls.push(request.url)
      return response
    },
    now: () => 0,
    sleep: async () => {},
    random: () => 0,
  })
  return { endpoints: createTmdbEndpoints(client, config), urls }
}

/** Le o `append_to_response` ja decodificado da ultima URL capturada. */
function appendOf(url: string): string | null {
  return new URL(url).searchParams.get('append_to_response')
}

describe('createTmdbEndpoints', () => {
  it('getMovie usa /movie/{id} com append_to_response MAXIMO e language=pt-BR', async () => {
    const { endpoints, urls } = setup()
    await endpoints.getMovie(27205)
    const url = urls[0] ?? ''
    expect(url).toContain('/movie/27205')
    expect(appendOf(url)).toBe(MOVIE_APPEND.join(','))
    expect(new URL(url).searchParams.get('language')).toBe('pt-BR')
  })

  it('getTvShow usa /tv/{id} com append_to_response MAXIMO', async () => {
    const { endpoints, urls } = setup()
    await endpoints.getTvShow(1399)
    const url = urls[0] ?? ''
    expect(url).toContain('/tv/1399')
    expect(appendOf(url)).toBe(TV_APPEND.join(','))
  })

  it('getTvSeason usa /tv/{id}/season/{n} com append_to_response MAXIMO', async () => {
    const { endpoints, urls } = setup()
    await endpoints.getTvSeason(1399, 2)
    const url = urls[0] ?? ''
    expect(url).toContain('/tv/1399/season/2')
    expect(appendOf(url)).toBe(TV_SEASON_APPEND.join(','))
  })

  it('getTvEpisode usa /tv/{id}/season/{n}/episode/{e} com append_to_response MAXIMO', async () => {
    const { endpoints, urls } = setup()
    await endpoints.getTvEpisode(1399, 2, 5)
    const url = urls[0] ?? ''
    expect(url).toContain('/tv/1399/season/2/episode/5')
    expect(appendOf(url)).toBe(TV_EPISODE_APPEND.join(','))
  })

  it('getPerson usa /person/{id} com append_to_response MAXIMO', async () => {
    const { endpoints, urls } = setup()
    await endpoints.getPerson(287)
    const url = urls[0] ?? ''
    expect(url).toContain('/person/287')
    expect(appendOf(url)).toBe(PERSON_APPEND.join(','))
  })

  it('todos os detalhes pedem translations num unico request', async () => {
    const { endpoints, urls } = setup()
    await endpoints.getMovie(1)
    await endpoints.getTvShow(1)
    await endpoints.getTvSeason(1, 1)
    await endpoints.getTvEpisode(1, 1, 1)
    await endpoints.getPerson(1)
    for (const url of urls) {
      expect(appendOf(url)?.split(',')).toContain('translations')
    }
  })

  it('getUpcomingMovies usa /movie/upcoming com defaults language=pt-BR, region=BR, page=1', async () => {
    const { endpoints, urls } = setup()
    await endpoints.getUpcomingMovies()
    const url = urls[0] ?? ''
    expect(url).toContain('/movie/upcoming')
    expect(url).toContain('language=pt-BR')
    expect(url).toContain('region=BR')
    expect(url).toContain('page=1')
  })

  it('getUpcomingMovies respeita params (region/language/page) sobrescritos', async () => {
    const { endpoints, urls } = setup()
    await endpoints.getUpcomingMovies({ region: 'US', language: 'en-US', page: 3 })
    const url = urls[0] ?? ''
    expect(url).toContain('region=US')
    expect(url).toContain('language=en-US')
    expect(url).toContain('page=3')
  })
})
