/**
 * Testes da chave de cache deterministica.
 */

import { describe, expect, it } from 'vitest'
import { buildCacheKey } from '../utils/cache-key.js'

describe('buildCacheKey', () => {
  it('e independente da ordem dos params', () => {
    const a = buildCacheKey('/movie/1', { language: 'pt-BR', append_to_response: 'credits' })
    const b = buildCacheKey('/movie/1', { append_to_response: 'credits', language: 'pt-BR' })
    expect(a).toEqual(b)
  })

  it('omite valores undefined', () => {
    const a = buildCacheKey('/movie/1', { language: 'pt-BR', extra: undefined })
    const b = buildCacheKey('/movie/1', { language: 'pt-BR' })
    expect(a).toEqual(b)
  })

  it('requestKey junta endpoint + query ordenada; paramsHash tem 64 hex', () => {
    const key = buildCacheKey('/movie/1', { language: 'pt-BR' })
    expect(key.requestKey).toBe('/movie/1?language=pt-BR')
    expect(key.paramsHash).toHaveLength(64)
  })

  it('endpoint sem params: requestKey e o proprio endpoint', () => {
    expect(buildCacheKey('/movie/1').requestKey).toBe('/movie/1')
  })
})
