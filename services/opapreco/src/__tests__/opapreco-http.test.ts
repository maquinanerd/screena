/**
 * @screena/opapreco — o transporte: teto de tempo, de destino e de tipo.
 * Toda chamada usa um `fetch` injetado; nenhuma sai para a rede.
 */

import { describe, expect, it } from 'vitest'

import {
  buildAdRequestUrl,
  fetchAllowedImage,
  fireImpression,
  isAdServerUrl,
  requestAdDecision,
} from '../index'

type Call = { url: string; init?: RequestInit }

function fakeFetch(respond: (url: string) => Response | Promise<Response>, calls: Call[] = []) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    return respond(url)
  }
}

describe('requestAdDecision', () => {
  it('monta GET {base}/v1/ad com publisher e os parametros nao vazios', () => {
    const url = buildAdRequestUrl('https://ads.example/base/', 'cinerie', { slot: 'title-mid', entity: '' })
    expect(url).toBe('https://ads.example/base/v1/ad?publisher=cinerie&slot=title-mid')
  })

  it('200 com JSON -> ad; 204 -> empty; 500 -> error', async () => {
    const ok = await requestAdDecision({
      adServerUrl: 'https://ads.example',
      publisher: 'cinerie',
      query: { slot: 'title-mid' },
      fetchImpl: fakeFetch(() => Response.json({ requestId: 'x' })),
    })
    expect(ok).toEqual({ kind: 'ad', body: { requestId: 'x' } })
    const vazio = await requestAdDecision({
      adServerUrl: 'https://ads.example',
      publisher: 'cinerie',
      query: {},
      fetchImpl: fakeFetch(() => new Response(null, { status: 204 })),
    })
    expect(vazio).toEqual({ kind: 'empty' })
    const erro = await requestAdDecision({
      adServerUrl: 'https://ads.example',
      publisher: 'cinerie',
      query: {},
      fetchImpl: fakeFetch(() => new Response('x', { status: 500 })),
    })
    expect(erro).toEqual({ kind: 'error', reason: 'status_500' })
  })

  it('estouro do teto vira timeout, sem excecao', async () => {
    const lento = await requestAdDecision({
      adServerUrl: 'https://ads.example',
      publisher: 'cinerie',
      query: {},
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    })
    expect(lento).toEqual({ kind: 'error', reason: 'timeout' })
  })
})

describe('fetchAllowedImage', () => {
  const png = (type: string, size = 10) =>
    new Response(new Uint8Array(size), { status: 200, headers: { 'content-type': type } })

  it('aceita raster, recusa SVG, HTML e o que passa do teto', async () => {
    expect(await fetchAllowedImage({ url: 'https://img.example/a', fetchImpl: fakeFetch(() => png('image/webp')) })).not.toBeNull()
    expect(await fetchAllowedImage({ url: 'https://img.example/a', fetchImpl: fakeFetch(() => png('image/svg+xml')) })).toBeNull()
    expect(await fetchAllowedImage({ url: 'https://img.example/a', fetchImpl: fakeFetch(() => png('text/html')) })).toBeNull()
    expect(
      await fetchAllowedImage({ url: 'https://img.example/a', maxBytes: 5, fetchImpl: fakeFetch(() => png('image/png', 6)) }),
    ).toBeNull()
  })

  it('nao segue redirect', async () => {
    const calls: Call[] = []
    await fetchAllowedImage({ url: 'https://img.example/a', fetchImpl: fakeFetch(() => png('image/png'), calls) })
    expect(calls[0]?.init?.redirect).toBe('error')
  })
})

describe('fireImpression', () => {
  it('so dispara URL da origem do ad server, em https', async () => {
    const calls: Call[] = []
    const fetchImpl = fakeFetch(() => new Response(null, { status: 204 }), calls)
    expect(await fireImpression({ url: 'https://ads.example/i/1', adServerUrl: 'https://ads.example', fetchImpl })).toBe(true)
    expect(await fireImpression({ url: 'https://evil.example/i/1', adServerUrl: 'https://ads.example', fetchImpl })).toBe(false)
    expect(await fireImpression({ url: 'http://ads.example/i/1', adServerUrl: 'https://ads.example', fetchImpl })).toBe(false)
    expect(
      await fireImpression({ url: 'https://fixtures.opapreco.invalid/impression/x', adServerUrl: 'https://ads.example', fetchImpl }),
    ).toBe(false)
    expect(calls.map((call) => call.url)).toEqual(['https://ads.example/i/1'])
    expect(isAdServerUrl('https://ads.example.evil.com/x', 'https://ads.example')).toBe(false)
  })
})
