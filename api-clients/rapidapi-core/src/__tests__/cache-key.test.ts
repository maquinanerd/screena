/**
 * Testes da chave deterministica de cache (`api_cache`).
 *
 * A ordem de insercao dos params nunca muda a chave; `undefined` e omitido;
 * sem params a `requestKey` e o proprio endpoint; params distintos geram
 * `paramsHash` distinto.
 */

import { describe, expect, it } from 'vitest'
import { buildCacheKey } from '../cache-key.js'
import { sha256Hex } from '../hash.js'

describe('buildCacheKey', () => {
  it('e deterministica independentemente da ordem de insercao dos params', () => {
    const a = buildCacheKey('/popular/', { type: 'film', page: 2, lang: 'pt' })
    const b = buildCacheKey('/popular/', { lang: 'pt', page: 2, type: 'film' })

    expect(a.requestKey).toBe(b.requestKey)
    expect(a.paramsHash).toBe(b.paramsHash)
    // querystring ordenada por chave
    expect(a.requestKey).toBe('/popular/?lang=pt&page=2&type=film')
  })

  it('omite params undefined (equivale a nao passa-los)', () => {
    const withUndef = buildCacheKey('/shows/movie/278', { lang: 'pt', region: undefined })
    const without = buildCacheKey('/shows/movie/278', { lang: 'pt' })

    expect(withUndef.requestKey).toBe('/shows/movie/278?lang=pt')
    expect(withUndef.requestKey).toBe(without.requestKey)
    expect(withUndef.paramsHash).toBe(without.paramsHash)
  })

  it('sem params: requestKey === endpoint e paramsHash === sha256 da string vazia', () => {
    const noArgs = buildCacheKey('/popular/')
    const emptyObj = buildCacheKey('/popular/', {})

    expect(noArgs.requestKey).toBe('/popular/')
    expect(emptyObj.requestKey).toBe('/popular/')
    expect(noArgs.paramsHash).toBe(sha256Hex(''))
    expect(noArgs.paramsHash).toBe(emptyObj.paramsHash)
  })

  it('params diferentes geram paramsHash diferente', () => {
    const one = buildCacheKey('/popular/', { type: 'film' })
    const two = buildCacheKey('/popular/', { type: 'series' })

    expect(one.paramsHash).not.toBe(two.paramsHash)
    expect(one.requestKey).not.toBe(two.requestKey)
  })
})
