/**
 * Testes do client Streaming Availability. 100% offline: o transporte HTTP e
 * injetado e captura a URL/headers montados.
 *
 * Foco desta fase: o contrato REAL v4 —
 *   GET /shows/{imdbId}?series_granularity=episode&output_language=en
 * — com a chave da chamada = IMDb id, host correto, SEM o param `country`
 * (filtro por pais e no worker) e SEM o path antigo que dava 404. A
 * `x-rapidapi-key` nunca entra na URL (viaja so em header).
 */

import { describe, expect, it } from 'vitest'
import {
  RAPIDAPI_HOST_HEADER,
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
  STREAMING_AVAILABILITY_DEFAULT_HOST,
  STREAMING_AVAILABILITY_DEFAULT_OUTPUT_LANGUAGE,
  STREAMING_AVAILABILITY_DEFAULT_SERIES_GRANULARITY,
  isImdbId,
  tmdbShowId,
} from '../provider.js'

const FAKE_KEY = 'test-key-0000000000'
/** IMDb id do Titanic (o mesmo do cURL real de referencia). */
const TITANIC_IMDB = 'tt0120338'

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

describe('buildShowRequest — contrato real /shows/{imdbId}', () => {
  it('endpoint /shows/{imdbId} + params series_granularity=episode & output_language=en', () => {
    const request = buildShowRequest({ showId: TITANIC_IMDB })
    expect(request.endpoint).toBe(`/shows/${TITANIC_IMDB}`)
    expect(request.params).toEqual({ series_granularity: 'episode', output_language: 'en' })
  })

  it('NAO emite o param country (o filtro por pais e no worker)', () => {
    const request = buildShowRequest({ showId: TITANIC_IMDB })
    expect('country' in request.params).toBe(false)
  })

  it('os defaults do contrato batem com as constantes do provider', () => {
    expect(STREAMING_AVAILABILITY_DEFAULT_SERIES_GRANULARITY).toBe('episode')
    expect(STREAMING_AVAILABILITY_DEFAULT_OUTPUT_LANGUAGE).toBe('en')
  })

  it('aceita override de series_granularity/output_language', () => {
    const request = buildShowRequest({
      showId: TITANIC_IMDB,
      seriesGranularity: 'show',
      outputLanguage: 'pt',
    })
    expect(request.params).toEqual({ series_granularity: 'show', output_language: 'pt' })
  })
})

describe('StreamingAvailabilityClient.getShow — URL e host montados', () => {
  it('URL final e /shows/{imdbId}?series_granularity=episode&output_language=en', async () => {
    const { client, calls } = makeClient()
    await client.getShow({ showId: TITANIC_IMDB })
    const { url } = callAt(calls, 0)
    expect(url).toContain(`/shows/${TITANIC_IMDB}?series_granularity=episode&output_language=en`)
  })

  it('usa o host streaming-availability.p.rapidapi.com', async () => {
    const { client, calls } = makeClient()
    await client.getShow({ showId: TITANIC_IMDB })
    const { url, headers } = callAt(calls, 0)
    expect(headers[RAPIDAPI_HOST_HEADER]).toBe(STREAMING_AVAILABILITY_DEFAULT_HOST)
    expect(headers[RAPIDAPI_HOST_HEADER]).toBe('streaming-availability.p.rapidapi.com')
    expect(url.startsWith('https://streaming-availability.p.rapidapi.com/shows/')).toBe(true)
  })

  it('NAO usa o param country nem o path antigo que dava 404', async () => {
    const { client, calls } = makeClient()
    await client.getShow({ showId: TITANIC_IMDB })
    const { url } = callAt(calls, 0)
    expect(url).not.toContain('country=')
    // Path antigo (v2/basic/get) do endpoint que retornava 404 nunca aparece.
    expect(url).not.toMatch(/\/(?:v2|get|basic)\b/)
  })

  it('a chave da API nunca aparece na URL (viaja so em header)', async () => {
    const { client, calls } = makeClient()
    await client.getShow({ showId: TITANIC_IMDB })
    const { url, headers } = callAt(calls, 0)
    expect(url).not.toContain(FAKE_KEY)
    // Prova positiva: a chave esta no header dedicado, nao na URL.
    expect(headers[RAPIDAPI_KEY_HEADER]).toBe(FAKE_KEY)
  })
})

describe('isSafeShowId — guard anti path-injection', () => {
  // A chamada canonica usa IMDb id; movie/tv seguem aceitos como defesa/legado.
  const accepted = ['tt123', TITANIC_IMDB, 'movie/278', 'tv/1396']
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
      expect(() => buildShowRequest({ showId: id })).toThrow(RapidApiConfigError)
    })
  }
})

describe('provider helpers', () => {
  it('tmdbShowId compoe kind/id (helper legado, nao usado na chamada desta fase)', () => {
    expect(tmdbShowId('movie', 278)).toBe('movie/278')
    expect(tmdbShowId('tv', 1396)).toBe('tv/1396')
  })

  it('isImdbId aceita tt<digitos> e rejeita o resto', () => {
    expect(isImdbId('tt0111161')).toBe(true)
    expect(isImdbId(TITANIC_IMDB)).toBe(true)
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
