/**
 * Testes da configuracao do client Streaming Availability. Puros, sem rede.
 *
 * Ambiente passado como objeto simples (nunca `process.env`). Cobrimos falha por
 * chave ausente/em branco (sem vazar segredo), defaults e overrides.
 */

import { describe, expect, it } from 'vitest'
import { RapidApiConfigError, type RapidApiEnv } from '@screena/rapidapi-core'
import {
  STREAMING_AVAILABILITY_BASE_URL_ENV,
  STREAMING_AVAILABILITY_HOST_ENV,
  STREAMING_AVAILABILITY_KEY_ENV,
  loadStreamingAvailabilityConfig,
} from '../config.js'
import {
  STREAMING_AVAILABILITY_DEFAULT_BASE_URL,
  STREAMING_AVAILABILITY_DEFAULT_CACHE_TTL_MS,
  STREAMING_AVAILABILITY_DEFAULT_HOST,
  STREAMING_AVAILABILITY_PROVIDER_API,
} from '../provider.js'

/** Segredo-isca: um env dump na mensagem o exporia. */
const DECOY_SECRET = 'test-key-decoy-9999999999'
/** Chave valida de teste (obviamente falsa). */
const FAKE_KEY = 'test-key-0000000000'

function withKey(extra: RapidApiEnv = {}): RapidApiEnv {
  return { [STREAMING_AVAILABILITY_KEY_ENV]: FAKE_KEY, ...extra }
}

function catchThrown(fn: () => unknown): unknown {
  try {
    fn()
  } catch (err) {
    return err
  }
  throw new Error('esperava um erro, mas nada foi lancado')
}

describe('loadStreamingAvailabilityConfig — chave obrigatoria', () => {
  it('lanca RapidApiConfigError quando a chave esta ausente; cita a env var, nao vaza segredo', () => {
    const thrown = catchThrown(() =>
      loadStreamingAvailabilityConfig({ UNRELATED_SECRET: DECOY_SECRET }),
    )
    expect(thrown).toBeInstanceOf(RapidApiConfigError)
    const message = (thrown as Error).message
    expect(message).toContain(STREAMING_AVAILABILITY_KEY_ENV)
    expect(message).not.toContain(DECOY_SECRET)
  })

  it('trata chave em branco (vazia) como ausente e nao vaza segredo', () => {
    const thrown = catchThrown(() =>
      loadStreamingAvailabilityConfig({
        [STREAMING_AVAILABILITY_KEY_ENV]: '',
        UNRELATED_SECRET: DECOY_SECRET,
      }),
    )
    expect(thrown).toBeInstanceOf(RapidApiConfigError)
    const message = (thrown as Error).message
    expect(message).toContain(STREAMING_AVAILABILITY_KEY_ENV)
    expect(message).not.toContain(DECOY_SECRET)
  })

  it('trata chave presente-mas-so-espacos como ausente; mensagem cita a env var', () => {
    const thrown = catchThrown(() =>
      loadStreamingAvailabilityConfig({
        [STREAMING_AVAILABILITY_KEY_ENV]: '   ',
        UNRELATED_SECRET: DECOY_SECRET,
      }),
    )
    expect(thrown).toBeInstanceOf(RapidApiConfigError)
    const message = (thrown as Error).message
    expect(message).toContain(STREAMING_AVAILABILITY_KEY_ENV)
    expect(message).not.toContain(DECOY_SECRET)
  })

  it('nao lanca e carrega a chave quando presente e valida', () => {
    const config = loadStreamingAvailabilityConfig(withKey())
    expect(config.apiKey).toBe(FAKE_KEY)
  })
})

describe('loadStreamingAvailabilityConfig — identidade e defaults', () => {
  it('providerApi e exatamente streaming_availability', () => {
    const config = loadStreamingAvailabilityConfig(withKey())
    expect(config.providerApi).toBe('streaming_availability')
    expect(config.providerApi).toBe(STREAMING_AVAILABILITY_PROVIDER_API)
  })

  it('host e baseUrl caem nos defaults documentados', () => {
    const config = loadStreamingAvailabilityConfig(withKey())
    expect(config.host).toBe('streaming-availability.p.rapidapi.com')
    expect(config.host).toBe(STREAMING_AVAILABILITY_DEFAULT_HOST)
    expect(config.baseUrl).toBe('https://streaming-availability.p.rapidapi.com')
    expect(config.baseUrl).toBe(STREAMING_AVAILABILITY_DEFAULT_BASE_URL)
  })

  it('cacheTtlMs default e 24h (86_400_000)', () => {
    const config = loadStreamingAvailabilityConfig(withKey())
    expect(config.cacheTtlMs).toBe(86_400_000)
    expect(config.cacheTtlMs).toBe(STREAMING_AVAILABILITY_DEFAULT_CACHE_TTL_MS)
  })
})

describe('loadStreamingAvailabilityConfig — overrides', () => {
  it('_HOST e _BASE_URL sobrescrevem os defaults', () => {
    const config = loadStreamingAvailabilityConfig(
      withKey({
        [STREAMING_AVAILABILITY_HOST_ENV]: 'custom-host.example.com',
        [STREAMING_AVAILABILITY_BASE_URL_ENV]: 'https://custom.example.com',
      }),
    )
    expect(config.host).toBe('custom-host.example.com')
    expect(config.baseUrl).toBe('https://custom.example.com')
  })

  it('cacheTtlMs numerico e parseado; env invalido cai no default', () => {
    const parsed = loadStreamingAvailabilityConfig(
      withKey({ RAPIDAPI_STREAMING_AVAILABILITY_CACHE_TTL_MS: '3600000' }),
    )
    expect(parsed.cacheTtlMs).toBe(3_600_000)

    const invalid = loadStreamingAvailabilityConfig(
      withKey({ RAPIDAPI_STREAMING_AVAILABILITY_CACHE_TTL_MS: 'nao-numero' }),
    )
    expect(invalid.cacheTtlMs).toBe(86_400_000)
  })
})
