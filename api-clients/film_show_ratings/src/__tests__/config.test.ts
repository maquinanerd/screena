/**
 * Testes da configuracao do client Film/Show Ratings. Puros, sem rede.
 *
 * O ambiente e passado como objeto simples (nunca `process.env`). Garantimos:
 *  - falha explicita (RapidApiConfigError) quando a chave falta ou esta em branco;
 *  - a mensagem cita o NOME da env var, nunca um segredo (sem env dump);
 *  - defaults e overrides de host/baseUrl/cacheTtl.
 */

import { describe, expect, it } from 'vitest'
import { RapidApiConfigError, type RapidApiEnv } from '@screena/rapidapi-core'
import {
  FILM_SHOW_RATINGS_BASE_URL_ENV,
  FILM_SHOW_RATINGS_HOST_ENV,
  FILM_SHOW_RATINGS_KEY_ENV,
  loadFilmShowRatingsConfig,
} from '../config.js'
import {
  FILM_SHOW_RATINGS_DEFAULT_BASE_URL,
  FILM_SHOW_RATINGS_DEFAULT_CACHE_TTL_MS,
  FILM_SHOW_RATINGS_DEFAULT_HOST,
  FILM_SHOW_RATINGS_PROVIDER_API,
} from '../provider.js'

/** Segredo-isca: se um dia a mensagem despejar o env, ele apareceria. */
const DECOY_SECRET = 'test-key-decoy-9999999999'
/** Chave valida de teste (obviamente falsa). */
const FAKE_KEY = 'test-key-0000000000'

function withKey(extra: RapidApiEnv = {}): RapidApiEnv {
  return { [FILM_SHOW_RATINGS_KEY_ENV]: FAKE_KEY, ...extra }
}

/** Captura o erro lancado por `fn`, ou falha o teste se nada for lancado. */
function catchThrown(fn: () => unknown): unknown {
  try {
    fn()
  } catch (err) {
    return err
  }
  throw new Error('esperava um erro, mas nada foi lancado')
}

describe('loadFilmShowRatingsConfig — chave obrigatoria', () => {
  it('lanca RapidApiConfigError quando a chave esta ausente; cita a env var, nao vaza segredo', () => {
    // A isca vive numa var NAO lida pela config: um env dump a exporia.
    const thrown = catchThrown(() =>
      loadFilmShowRatingsConfig({ UNRELATED_SECRET: DECOY_SECRET }),
    )
    expect(thrown).toBeInstanceOf(RapidApiConfigError)
    const message = (thrown as Error).message
    expect(message).toContain(FILM_SHOW_RATINGS_KEY_ENV)
    expect(message).not.toContain(DECOY_SECRET)
  })

  it('trata chave em branco (vazia) como ausente e nao vaza segredo', () => {
    const thrown = catchThrown(() =>
      loadFilmShowRatingsConfig({
        [FILM_SHOW_RATINGS_KEY_ENV]: '',
        UNRELATED_SECRET: DECOY_SECRET,
      }),
    )
    expect(thrown).toBeInstanceOf(RapidApiConfigError)
    const message = (thrown as Error).message
    expect(message).toContain(FILM_SHOW_RATINGS_KEY_ENV)
    expect(message).not.toContain(DECOY_SECRET)
  })

  it('trata chave presente-mas-so-espacos como ausente; mensagem cita a env var', () => {
    const thrown = catchThrown(() =>
      loadFilmShowRatingsConfig({
        [FILM_SHOW_RATINGS_KEY_ENV]: '   ',
        UNRELATED_SECRET: DECOY_SECRET,
      }),
    )
    expect(thrown).toBeInstanceOf(RapidApiConfigError)
    const message = (thrown as Error).message
    expect(message).toContain(FILM_SHOW_RATINGS_KEY_ENV)
    // Nenhum segredo (nem o da isca) vaza mesmo com a chave presente-mas-em-branco.
    expect(message).not.toContain(DECOY_SECRET)
  })

  it('nao lanca e carrega a chave quando presente e valida', () => {
    const config = loadFilmShowRatingsConfig(withKey())
    expect(config.apiKey).toBe(FAKE_KEY)
  })
})

describe('loadFilmShowRatingsConfig — identidade e defaults', () => {
  it('providerApi e exatamente rapidapi_film_show_ratings', () => {
    const config = loadFilmShowRatingsConfig(withKey())
    expect(config.providerApi).toBe('rapidapi_film_show_ratings')
    expect(config.providerApi).toBe(FILM_SHOW_RATINGS_PROVIDER_API)
  })

  it('host e baseUrl caem nos defaults documentados', () => {
    const config = loadFilmShowRatingsConfig(withKey())
    expect(config.host).toBe('film-show-ratings.p.rapidapi.com')
    expect(config.host).toBe(FILM_SHOW_RATINGS_DEFAULT_HOST)
    expect(config.baseUrl).toBe('https://film-show-ratings.p.rapidapi.com')
    expect(config.baseUrl).toBe(FILM_SHOW_RATINGS_DEFAULT_BASE_URL)
  })

  it('cacheTtlMs default e 24h (86_400_000)', () => {
    const config = loadFilmShowRatingsConfig(withKey())
    expect(config.cacheTtlMs).toBe(86_400_000)
    expect(config.cacheTtlMs).toBe(FILM_SHOW_RATINGS_DEFAULT_CACHE_TTL_MS)
  })
})

describe('loadFilmShowRatingsConfig — overrides', () => {
  it('_HOST e _BASE_URL sobrescrevem os defaults', () => {
    const config = loadFilmShowRatingsConfig(
      withKey({
        [FILM_SHOW_RATINGS_HOST_ENV]: 'custom-host.example.com',
        [FILM_SHOW_RATINGS_BASE_URL_ENV]: 'https://custom.example.com',
      }),
    )
    expect(config.host).toBe('custom-host.example.com')
    expect(config.baseUrl).toBe('https://custom.example.com')
  })

  it('cacheTtlMs numerico e parseado; env invalido cai no default', () => {
    const parsed = loadFilmShowRatingsConfig(
      withKey({ RAPIDAPI_FILM_SHOW_RATINGS_CACHE_TTL_MS: '3600000' }),
    )
    expect(parsed.cacheTtlMs).toBe(3_600_000)

    const invalid = loadFilmShowRatingsConfig(
      withKey({ RAPIDAPI_FILM_SHOW_RATINGS_CACHE_TTL_MS: 'nao-numero' }),
    )
    expect(invalid.cacheTtlMs).toBe(86_400_000)
  })
})
