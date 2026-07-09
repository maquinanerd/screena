/**
 * Testes do retry minimo do core (P0-00d): classificacao transitorio/permanente
 * e contagem de retries/429 com um source fake (sem rede, sem timers reais).
 */

import { describe, expect, it, vi } from 'vitest'
import {
  computeBackoffMs,
  createRawSyncBackoff,
  fetchWithRetry,
  isCircuitOpenError,
  isRetryableError,
  retryAfterMsOf,
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

describe('isCircuitOpenError', () => {
  it('detecta pelo name (TmdbCircuitOpenError) ou por openUntil numerico', () => {
    expect(isCircuitOpenError({ name: 'TmdbCircuitOpenError' })).toBe(true)
    expect(isCircuitOpenError({ openUntil: 123456 })).toBe(true)
  })

  it('nao confunde com erro comum, status ou null', () => {
    expect(isCircuitOpenError({ status: 503 })).toBe(false)
    expect(isCircuitOpenError(new Error('x'))).toBe(false)
    expect(isCircuitOpenError(null)).toBe(false)
  })

  it('circuito aberto NAO e retentavel (evita girar em falso ate o cooldown)', () => {
    expect(isRetryableError({ name: 'TmdbCircuitOpenError' })).toBe(false)
    expect(isRetryableError({ openUntil: 999 })).toBe(false)
  })
})

describe('retryAfterMsOf', () => {
  it('le retryAfterMs (ms) direto', () => {
    expect(retryAfterMsOf({ retryAfterMs: 2000 })).toBe(2000)
  })

  it('converte retryAfter (segundos) em ms', () => {
    expect(retryAfterMsOf({ retryAfter: 3 })).toBe(3000)
  })

  it('null quando ausente/invalido (caso comum: client ja consumiu Retry-After)', () => {
    expect(retryAfterMsOf({ status: 429 })).toBeNull()
    expect(retryAfterMsOf({ retryAfterMs: -1 })).toBeNull()
    expect(retryAfterMsOf(null)).toBeNull()
  })
})

describe('computeBackoffMs', () => {
  // random fixo => jitter deterministico (facilita a asserticao exata).
  const random = () => 0.5

  it('Retry-After explicito vence o exponencial (limitado ao teto)', () => {
    expect(computeBackoffMs({ attempt: 1, is429: true, retryAfterMs: 1500 }, { random })).toBe(1500)
    // acima do teto => corta no maxMs
    expect(
      computeBackoffMs({ attempt: 1, is429: true, retryAfterMs: 99_999 }, { maxMs: 5000, random }),
    ).toBe(5000)
  })

  it('exponencial cresce com a tentativa (sem Retry-After)', () => {
    const base = 100
    const a1 = computeBackoffMs({ attempt: 1, is429: false, retryAfterMs: null }, { baseMs: base, jitterMs: 0, random })
    const a2 = computeBackoffMs({ attempt: 2, is429: false, retryAfterMs: null }, { baseMs: base, jitterMs: 0, random })
    const a3 = computeBackoffMs({ attempt: 3, is429: false, retryAfterMs: null }, { baseMs: base, jitterMs: 0, random })
    expect(a1).toBe(100) // 100 * 2^0
    expect(a2).toBe(200) // 100 * 2^1
    expect(a3).toBe(400) // 100 * 2^2
  })

  it('429 recebe UM degrau a mais de backoff que um 5xx equivalente', () => {
    const opts = { baseMs: 100, jitterMs: 0, random }
    const err5xx = computeBackoffMs({ attempt: 1, is429: false, retryAfterMs: null }, opts)
    const err429 = computeBackoffMs({ attempt: 1, is429: true, retryAfterMs: null }, opts)
    expect(err429).toBe(err5xx * 2)
  })

  it('jitter e deterministico via random injetado e o resultado respeita o teto', () => {
    const value = computeBackoffMs(
      { attempt: 1, is429: false, retryAfterMs: null },
      { baseMs: 100, jitterMs: 40, random: () => 0.25 },
    )
    expect(value).toBe(110) // 100 + 0.25*40
    const capped = computeBackoffMs(
      { attempt: 8, is429: false, retryAfterMs: null },
      { baseMs: 500, maxMs: 10_000, random: () => 0.9 },
    )
    expect(capped).toBe(10_000)
  })

  it('createRawSyncBackoff aplica a config injetada', () => {
    const backoff = createRawSyncBackoff({ baseMs: 100, jitterMs: 0, random })
    expect(backoff({ attempt: 2, is429: false, retryAfterMs: null })).toBe(200)
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

  it('onAttempt dispara 1x por tentativa (base do teto de requisicoes)', async () => {
    const counters: RetryCounters = { retries: 0, rate429: 0 }
    const onAttempt = vi.fn()
    let calls = 0
    await expect(
      fetchWithRetry(
        () => {
          calls += 1
          return Promise.reject({ status: 503 })
        },
        { maxAttempts: 3, sleep: noSleep, onAttempt },
        counters,
      ),
    ).rejects.toMatchObject({ status: 503 })
    expect(calls).toBe(3)
    expect(onAttempt).toHaveBeenCalledTimes(3) // conta TODAS as tentativas, inclusive a ultima
  })

  it('circuito aberto NAO retenta: uma tentativa so, relanca e nao conta retry', async () => {
    const counters: RetryCounters = { retries: 0, rate429: 0 }
    const onAttempt = vi.fn()
    let calls = 0
    await expect(
      fetchWithRetry(
        () => {
          calls += 1
          return Promise.reject({ name: 'TmdbCircuitOpenError', openUntil: 999 })
        },
        { maxAttempts: 3, sleep: noSleep, onAttempt },
        counters,
      ),
    ).rejects.toMatchObject({ name: 'TmdbCircuitOpenError' })
    expect(calls).toBe(1)
    expect(onAttempt).toHaveBeenCalledTimes(1)
    expect(counters).toEqual({ retries: 0, rate429: 0 })
  })

  it('backoffMs recebe o contexto da falha (attempt/is429/retryAfterMs)', async () => {
    const counters: RetryCounters = { retries: 0, rate429: 0 }
    const seen: Array<{ attempt: number; is429: boolean; retryAfterMs: number | null }> = []
    const backoffMs = vi.fn((info: { attempt: number; is429: boolean; retryAfterMs: number | null }) => {
      seen.push(info)
      return 0
    })
    let calls = 0
    const value = await fetchWithRetry(
      () => {
        calls += 1
        if (calls === 1) return Promise.reject({ status: 429, retryAfterMs: 2000 })
        return Promise.resolve('ok')
      },
      { maxAttempts: 2, sleep: noSleep, backoffMs },
      counters,
    )
    expect(value).toBe('ok')
    expect(seen).toEqual([{ attempt: 1, is429: true, retryAfterMs: 2000 }])
  })
})
