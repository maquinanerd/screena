/**
 * Testes da configuracao do client TMDB. Puros, sem rede.
 */

import { describe, expect, it } from 'vitest'
import { TmdbConfigError, loadTmdbConfig } from '../config.js'

describe('loadTmdbConfig', () => {
  it('lanca TmdbConfigError quando nao ha nenhuma forma de auth', () => {
    expect(() => loadTmdbConfig({})).toThrow(TmdbConfigError)
  })

  it('trata strings vazias/espacos como auth ausente', () => {
    expect(() => loadTmdbConfig({ TMDB_READ_ACCESS_TOKEN: '   ', TMDB_API_KEY: '' })).toThrow(
      TmdbConfigError,
    )
  })

  it('prefere v4 (Bearer) sobre v3 quando ambos existem', () => {
    const config = loadTmdbConfig({ TMDB_READ_ACCESS_TOKEN: 'tok', TMDB_API_KEY: 'key' })
    expect(config.auth).toEqual({ mode: 'v4', token: 'tok' })
  })

  it('usa v3 (api_key) quando so ha TMDB_API_KEY', () => {
    const config = loadTmdbConfig({ TMDB_API_KEY: 'key' })
    expect(config.auth).toEqual({ mode: 'v3', apiKey: 'key' })
  })

  it('aplica defaults e parseia tunables; valores invalidos caem no default', () => {
    const config = loadTmdbConfig({
      TMDB_API_KEY: 'k',
      TMDB_MAX_RPS: '7',
      TMDB_MAX_RETRIES: 'nao-numero',
    })
    expect(config.baseUrl).toBe('https://api.themoviedb.org/3')
    expect(config.defaultLanguage).toBe('pt-BR')
    expect(config.maxRps).toBe(7)
    expect(config.maxRetries).toBe(4)
    expect(config.breakerThreshold).toBe(5)
    expect(config.cacheTtlMs).toBe(86_400_000)
  })
})
