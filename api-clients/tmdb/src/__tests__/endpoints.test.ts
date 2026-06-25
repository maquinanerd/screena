/**
 * Testes dos endpoints TMDB: paths e params corretos. Sem rede.
 */

import { describe, expect, it } from 'vitest'
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

describe('createTmdbEndpoints', () => {
  it('getMovie usa /movie/{id} com append_to_response=external_ids,credits e language', async () => {
    const { endpoints, urls } = setup()
    await endpoints.getMovie(27205)
    const url = urls[0] ?? ''
    expect(url).toContain('/movie/27205')
    expect(url).toContain('append_to_response=external_ids%2Ccredits')
    expect(url).toContain('language=pt-BR')
  })

  it('getTvShow usa /tv/{id} com append_to_response=external_ids,credits', async () => {
    const { endpoints, urls } = setup()
    await endpoints.getTvShow(1399)
    const url = urls[0] ?? ''
    expect(url).toContain('/tv/1399')
    expect(url).toContain('append_to_response=external_ids%2Ccredits')
  })

  it('getTvSeason usa /tv/{id}/season/{n}', async () => {
    const { endpoints, urls } = setup()
    await endpoints.getTvSeason(1399, 2)
    const url = urls[0] ?? ''
    expect(url).toContain('/tv/1399/season/2')
  })

  it('getPerson usa /person/{id} com append_to_response=external_ids', async () => {
    const { endpoints, urls } = setup()
    await endpoints.getPerson(287)
    const url = urls[0] ?? ''
    expect(url).toContain('/person/287')
    expect(url).toContain('append_to_response=external_ids')
  })
})
