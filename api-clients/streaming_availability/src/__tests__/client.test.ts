/**
 * Testes do client Streaming Availability. 100% offline: o transporte HTTP e
 * injetado e captura a URL montada. Cobrem o guard anti path-injection do showId,
 * a barra NAO escapada de `movie/278`, o param opcional output_language, os
 * helpers (tmdbShowId/isImdbId) e a garantia de que a chave nunca entra na URL.
 */

import { describe, expect, it } from 'vitest'
import {
  RAPIDAPI_KEY_HEADER,
  RapidApiConfigError,
  type HttpResponse,
  type HttpTransport,
  type RapidApiClientConfig,
} from '@screena/rapidapi-core'
import {
  StreamingAvailabilityClient,
  buildShowRequest,
  isSafeShowId,
} from '../client.js'
import { STREAMING_AVAILABILITY_KEY_ENV, loadStreamingAvailabilityConfig } from '../config.js'
import {
  STREAMING_AVAILABILITY_DEFAULT_COUNTRY,
  isImdbId,
  tmdbShowId,
} from '../provider.js'

const FAKE_KEY = 'test-key-0000000000'

function makeConfig(): RapidApiClientConfig {
  return loadStreamingAvailabilityConfig({ [STREAMING_AVAILABILITY_KEY_ENV]: FAKE_KEY })
}

interface Capture {
  readonly url: string
  readonly headers: Record<string, string>
}

/** Client com transporte que registra url+headers de cada chamada. */
function makeClient(body = '{}'): {
  client: StreamingAvailabilityClient
  calls: Capture[]
} {
  const calls: Capture[] = []
  const transport: HttpTransport = async (request) => {
    calls.push({ url: request.url, headers: request.headers })
    const response: HttpResponse = { status: 200, headers: {}, body }
    return response
  }
  const client = new StreamingAvailabilityClient(makeConfig(), { transport })
  return { client, calls }
}

function callAt(calls: Capture[], index: number): Capture {
  const call = calls[index]
  if (call === undefined) throw new Error(`nenhuma requisicao no indice ${index}`)
  return call
}

describe('buildShowRequest — TMDB id (movie/tv)', () => {
  it("showId 'movie/278' -> endpoint /shows/movie/278, params {country:'BR'}", () => {
    const request = buildShowRequest({ showId: 'movie/278', country: 'BR' })
    expect(request.endpoint).toBe('/shows/movie/278')
    expect(request.params).toEqual({ country: 'BR' })
  })

  it("showId 'tt0111161' -> endpoint /shows/tt0111161", () => {
    const request = buildShowRequest({ showId: 'tt0111161', country: 'BR' })
    expect(request.endpoint).toBe('/shows/tt0111161')
  })
})

describe('StreamingAvailabilityClient.getShow — URL montada', () => {
  it('a barra de movie/278 NAO e percent-encoded na URL final', async () => {
    const { client, calls } = makeClient()
    await client.getShow({ showId: 'movie/278', country: 'BR' })
    const { url } = callAt(calls, 0)
    expect(url).toContain('/shows/movie/278?country=BR')
    expect(url).not.toContain('%2F')
  })

  it('a chave da API nunca aparece na URL (viaja so em header)', async () => {
    const { client, calls } = makeClient()
    await client.getShow({ showId: 'movie/278', country: 'BR' })
    const { url, headers } = callAt(calls, 0)
    expect(url).not.toContain(FAKE_KEY)
    // Prova positiva: a chave esta no header dedicado, nao na URL.
    expect(headers[RAPIDAPI_KEY_HEADER]).toBe(FAKE_KEY)
  })
})

describe('buildShowRequest — output_language opcional', () => {
  it('adiciona output_language quando informado', () => {
    const request = buildShowRequest({
      showId: 'movie/278',
      country: 'BR',
      outputLanguage: 'pt',
    })
    expect(request.params).toEqual({ country: 'BR', output_language: 'pt' })
  })

  it('omite output_language quando undefined', () => {
    const request = buildShowRequest({ showId: 'movie/278', country: 'BR' })
    expect(request.params).toEqual({ country: 'BR' })
    expect('output_language' in request.params).toBe(false)
  })
})

describe('isSafeShowId — guard anti path-injection', () => {
  const accepted = ['tt123', 'movie/278', 'tv/1396']
  const rejected = ['../etc', 'movie/abc', 'tt', 'movie/278?x=1', 'movie/278#f', '']

  for (const id of accepted) {
    it(`aceita "${id}"`, () => {
      expect(isSafeShowId(id)).toBe(true)
    })
  }

  for (const id of rejected) {
    it(`rejeita ${JSON.stringify(id)}`, () => {
      expect(isSafeShowId(id)).toBe(false)
    })

    it(`buildShowRequest lanca RapidApiConfigError para ${JSON.stringify(id)}`, () => {
      expect(() => buildShowRequest({ showId: id, country: 'BR' })).toThrow(RapidApiConfigError)
    })
  }
})

describe('provider helpers', () => {
  it('tmdbShowId compoe kind/id', () => {
    expect(tmdbShowId('movie', 278)).toBe('movie/278')
    expect(tmdbShowId('tv', 1396)).toBe('tv/1396')
  })

  it('isImdbId aceita tt<digitos> e rejeita o resto', () => {
    expect(isImdbId('tt0111161')).toBe(true)
    expect(isImdbId('tt1')).toBe(true)
    expect(isImdbId('tt')).toBe(false)
    expect(isImdbId('movie/278')).toBe(false)
    expect(isImdbId('TT123')).toBe(false)
    expect(isImdbId('tt12a')).toBe(false)
    expect(isImdbId('')).toBe(false)
  })

  it('pais padrao desta fase e BR', () => {
    expect(STREAMING_AVAILABILITY_DEFAULT_COUNTRY).toBe('BR')
  })
})
