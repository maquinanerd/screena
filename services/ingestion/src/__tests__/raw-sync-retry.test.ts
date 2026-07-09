/**
 * Testes do retry minimo do core (P0-00d): classificacao transitorio/permanente
 * e contagem de retries/429 com um source fake (sem rede, sem timers reais).
 */

import { describe, expect, it, vi } from 'vitest'
import {
  fetchWithRetry,
  isRetryableError,
  statusOf,
  type RetryCounters,
} from '../raw-sync/retry.js'

const noSleep = () => Promise.resolve()

describe('isRetryableError', () => {
  it('respeita `.permanent` do TmdbHttpError', () => {
    expect(isRetryableError({ permanent: false, status: 500 })).toBe(true)
    expect(isRetryableError({ permanent: true, status: 404 })).toBe(false)
  })

  it('por status: 429 e 5xx transitorios; 4xx (exceto 429) permanentes', () => {
    expect(isRetryableError({ status: 429 })).toBe(true)
    expect(isRetryableError({ status: 503 })).toBe(true)
    expect(isRetryableError({ status: 404 })).toBe(false)
    expect(isRetryableError({ status: 400 })).toBe(false)
  })

  it('erro sem status (rede/desconhecido) => transitorio', () => {
    expect(isRetryableError(new Error('network down'))).toBe(true)
    expect(isRetryableError(null)).toBe(true)
  })
})

describe('statusOf', () => {
  it('extrai status numerico quando existe', () => {
    expect(statusOf({ status: 429 })).toBe(429)
    expect(statusOf(new Error('x'))).toBeNull()
  })
})

describe('fetchWithRetry', () => {
  it('429 seguido de sucesso: retenta, conta retries/429 e retorna o valor', async () => {
    const counters: RetryCounters = { retries: 0, rate429: 0 }
    const sleep = vi.fn(noSleep)
    let calls = 0
    const value = await fetchWithRetry(
      () => {
        calls += 1
        if (calls === 1) return Promise.reject({ status: 429 })
        return Promise.resolve('ok')
      },
      { maxAttempts: 2, sleep },
      counters,
    )
    expect(value).toBe('ok')
    expect(calls).toBe(2)
    expect(counters).toEqual({ retries: 1, rate429: 1 })
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('erro permanente (4xx) NAO retenta e nao conta retry', async () => {
    const counters: RetryCounters = { retries: 0, rate429: 0 }
    let calls = 0
    await expect(
      fetchWithRetry(
        () => {
          calls += 1
          return Promise.reject({ permanent: true, status: 404 })
        },
        { maxAttempts: 3, sleep: noSleep },
        counters,
      ),
    ).rejects.toMatchObject({ status: 404 })
    expect(calls).toBe(1)
    expect(counters).toEqual({ retries: 0, rate429: 0 })
  })

  it('esgota tentativas em 5xx: relanca e conta os retries (sem 429)', async () => {
    const counters: RetryCounters = { retries: 0, rate429: 0 }
    let calls = 0
    await expect(
      fetchWithRetry(
        () => {
          calls += 1
          return Promise.reject({ status: 503 })
        },
        { maxAttempts: 3, sleep: noSleep },
        counters,
      ),
    ).rejects.toMatchObject({ status: 503 })
    expect(calls).toBe(3)
    expect(counters).toEqual({ retries: 2, rate429: 0 })
  })
})
