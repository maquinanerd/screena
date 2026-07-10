/**
 * Testes do client Film/Show Ratings. 100% offline: o transporte HTTP e injetado
 * e captura a URL efetivamente montada. Nenhuma normalizacao acontece no client.
 */

import { describe, expect, it } from 'vitest'
import type { HttpResponse, HttpTransport, RapidApiClientConfig } from '@screena/rapidapi-core'
import { FilmShowRatingsClient, buildItemRequest, buildPopularRequest } from '../client.js'
import { FILM_SHOW_RATINGS_ITEM_ENDPOINT, isImdbId } from '../provider.js'
import { FILM_SHOW_RATINGS_KEY_ENV, loadFilmShowRatingsConfig } from '../config.js'

const FAKE_KEY = 'test-key-0000000000'

function makeConfig(): RapidApiClientConfig {
  return loadFilmShowRatingsConfig({ [FILM_SHOW_RATINGS_KEY_ENV]: FAKE_KEY })
}

/**
 * Instancia o client com um transporte que devolve `body` (200) e registra as
 * URLs disparadas. Retorna a URL da primeira (e unica) chamada.
 */
function makeClient(body: string): { client: FilmShowRatingsClient; urls: string[] } {
  const urls: string[] = []
  const transport: HttpTransport = async (request) => {
    urls.push(request.url)
    const response: HttpResponse = { status: 200, headers: {}, body }
    return response
  }
  const client = new FilmShowRatingsClient(makeConfig(), { transport })
  return { client, urls }
}

/** Le a URL da chamada `index`, falhando se o transporte nao rodou. */
function urlAt(urls: string[], index: number): string {
  const url = urls[index]
  if (url === undefined) throw new Error(`nenhuma requisicao no indice ${index}`)
  return url
}

describe('buildPopularRequest', () => {
  it("type 'film' -> endpoint /popular/ e params {type:'film'}", () => {
    const request = buildPopularRequest('film')
    expect(request.endpoint).toBe('/popular/')
    expect(request.params).toEqual({ type: 'film' })
  })

  it("type 'show' -> params {type:'show'}", () => {
    const request = buildPopularRequest('show')
    expect(request.endpoint).toBe('/popular/')
    expect(request.params).toEqual({ type: 'show' })
  })

  it('type undefined -> /popular/ sem params', () => {
    const request = buildPopularRequest(undefined)
    expect(request.endpoint).toBe('/popular/')
    expect(request.params).toEqual({})
    expect(request.cacheKey.requestKey).toBe('/popular/')
  })

  it('cacheKey e preenchida e deterministica', () => {
    const first = buildPopularRequest('film')
    const second = buildPopularRequest('film')
    expect(first.cacheKey.requestKey).toBe('/popular/?type=film')
    expect(first.cacheKey.paramsHash).toBeTruthy()
    expect(typeof first.cacheKey.paramsHash).toBe('string')
    expect(second.cacheKey).toEqual(first.cacheKey)
  })
})

describe('buildItemRequest (/item/?id=)', () => {
  it("id 'tt9603208' -> endpoint /item/, params {id}, cacheKey estavel", () => {
    const request = buildItemRequest('tt9603208')
    expect(request.endpoint).toBe(FILM_SHOW_RATINGS_ITEM_ENDPOINT)
    expect(request.endpoint).toBe('/item/')
    expect(request.params).toEqual({ id: 'tt9603208' })
    expect(request.cacheKey.requestKey).toBe('/item/?id=tt9603208')
    expect(request.cacheKey.paramsHash).toBeTruthy()

    // Deterministica: mesma entrada -> mesma chave.
    expect(buildItemRequest('tt9603208').cacheKey).toEqual(request.cacheKey)
    // Ids distintos -> requestKeys distintas.
    expect(buildItemRequest('tt0111161').cacheKey.requestKey).toBe('/item/?id=tt0111161')
  })
})

describe('isImdbId', () => {
  it('aceita tt<digitos>, rejeita tmdb id/lixo', () => {
    expect(isImdbId('tt9603208')).toBe(true)
    expect(isImdbId('  tt0111161 ')).toBe(true)
    expect(isImdbId('575265')).toBe(false)
    expect(isImdbId('tt')).toBe(false)
    expect(isImdbId('abc')).toBe(false)
    expect(isImdbId('')).toBe(false)
  })
})

describe('FilmShowRatingsClient.getItem — URL montada', () => {
  it("id 'tt9603208' produz uma URL terminada em /item/?id=tt9603208 (segredo so em header)", async () => {
    const { client, urls } = makeClient('{}')
    await client.getItem('tt9603208')
    const url = urlAt(urls, 0)
    expect(url.endsWith('/item/?id=tt9603208')).toBe(true)
    expect(url).not.toContain(FAKE_KEY)
  })

  it('devolve o payload cru sem normalizar', async () => {
    const weird = { status: 'success', result: { ratings: { IMDb: { audience: { rating: 7.1 } } } } }
    const { client } = makeClient(JSON.stringify(weird))
    const result = await client.getItem('tt9603208')
    expect(result).toEqual(weird)
  })
})

describe('FilmShowRatingsClient.getPopular — URL montada', () => {
  it("type 'film' produz uma URL terminada em /popular/?type=film", async () => {
    const { client, urls } = makeClient('{}')
    await client.getPopular('film')
    const url = urlAt(urls, 0)
    expect(url.endsWith('/popular/?type=film')).toBe(true)
    // O segredo viaja so em header — jamais na URL.
    expect(url).not.toContain(FAKE_KEY)
  })

  it("type 'show' produz uma URL terminada em /popular/?type=show", async () => {
    const { client, urls } = makeClient('{}')
    await client.getPopular('show')
    const url = urlAt(urls, 0)
    expect(url.endsWith('/popular/?type=show')).toBe(true)
  })

  it('type undefined produz /popular/ SEM querystring', async () => {
    const { client, urls } = makeClient('{}')
    await client.getPopular(undefined)
    const url = urlAt(urls, 0)
    expect(url.endsWith('/popular/')).toBe(true)
    expect(url).not.toContain('?')
  })
})

describe('FilmShowRatingsClient.getPopular — payload cru', () => {
  it('devolve o JSON parseado sem normalizar (deep equal do payload esquisito)', async () => {
    const weird = {
      unexpected: [1, 2, { nested: 'x' }],
      type: 'nao-normalizado',
      imdb: 'raw-value',
      extra: { a: null, b: false, list: ['z', 'y'] },
    }
    const { client } = makeClient(JSON.stringify(weird))
    const result = await client.getPopular('film')
    expect(result).toEqual(weird)
  })
})
