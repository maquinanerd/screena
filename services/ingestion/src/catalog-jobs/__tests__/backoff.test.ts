/**
 * Testes do backoff exponencial com jitter (PURO, sem timers reais).
 */

import { describe, expect, it } from 'vitest'
import { computeJobBackoffMs, DEFAULT_JOB_BACKOFF, type JobBackoffConfig } from '../backoff.js'

const NO_JITTER = 0 // full jitter em 0 => metade do teto do passo
const FULL_JITTER = 0.999999 // ~ teto do passo

describe('computeJobBackoffMs', () => {
  it('cresce exponencialmente com a tentativa (jitter maximo => valor cheio)', () => {
    const cfg: JobBackoffConfig = { baseMs: 1000, factor: 2, maxMs: 1_000_000 }
    // attempt 1 => base 1000; attempt 2 => 2000; attempt 3 => 4000 (jitter cheio)
    expect(computeJobBackoffMs(1, FULL_JITTER, cfg)).toBeGreaterThanOrEqual(999)
    expect(computeJobBackoffMs(1, FULL_JITTER, cfg)).toBeLessThanOrEqual(1000)
    expect(computeJobBackoffMs(2, FULL_JITTER, cfg)).toBeGreaterThan(
      computeJobBackoffMs(1, FULL_JITTER, cfg),
    )
    expect(computeJobBackoffMs(3, FULL_JITTER, cfg)).toBeGreaterThan(
      computeJobBackoffMs(2, FULL_JITTER, cfg),
    )
  })

  it('full jitter mantem o resultado em [capped/2, capped]', () => {
    const cfg: JobBackoffConfig = { baseMs: 1000, factor: 2, maxMs: 1_000_000 }
    // attempt 3 => capped 4000; faixa esperada [2000, 4000]
    expect(computeJobBackoffMs(3, NO_JITTER, cfg)).toBe(2000)
    expect(computeJobBackoffMs(3, FULL_JITTER, cfg)).toBeLessThanOrEqual(4000)
    expect(computeJobBackoffMs(3, FULL_JITTER, cfg)).toBeGreaterThanOrEqual(2000)
    expect(computeJobBackoffMs(3, 0.5, cfg)).toBe(3000)
  })

  it('nunca ultrapassa maxMs', () => {
    const cfg: JobBackoffConfig = { baseMs: 1000, factor: 10, maxMs: 5000 }
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect(computeJobBackoffMs(attempt, FULL_JITTER, cfg)).toBeLessThanOrEqual(5000)
    }
  })

  it('trata jitter fora de [0,1) de forma defensiva', () => {
    const cfg: JobBackoffConfig = { baseMs: 1000, factor: 2, maxMs: 1_000_000 }
    // jitter negativo/NaN => 0 (metade); jitter >= 1 => quase cheio
    expect(computeJobBackoffMs(3, -5, cfg)).toBe(2000)
    expect(computeJobBackoffMs(3, Number.NaN, cfg)).toBe(2000)
    expect(computeJobBackoffMs(3, 5, cfg)).toBeLessThanOrEqual(4000)
  })

  it('usa o backoff padrao quando nenhum config e passado', () => {
    expect(DEFAULT_JOB_BACKOFF.maxMs).toBe(3_600_000)
    expect(computeJobBackoffMs(1, NO_JITTER)).toBe(Math.round(DEFAULT_JOB_BACKOFF.baseMs / 2))
  })
})
