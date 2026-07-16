/**
 * Testes da maquina de estados PURA da fila de jobs (retry/dead-letter/reclaim/
 * replay). Sem DB, sem timers reais.
 */

import { describe, expect, it } from 'vitest'
import { isReclaimable, planFailure, planReclaim, planReplay } from '../transitions.js'

const ERR = { code: 'tmdb_5xx', safe: 'upstream 503' }

describe('planFailure', () => {
  it('agenda retry_wait com backoff enquanto ha tentativas', () => {
    const plan = planFailure({ attempts: 1, maxAttempts: 5 }, ERR, 0)
    expect(plan.status).toBe('retry_wait')
    expect(plan.exhausted).toBe(false)
    expect(plan.availableInMs).not.toBeNull()
    expect(plan.availableInMs!).toBeGreaterThan(0)
    expect(plan.lastErrorCode).toBe('tmdb_5xx')
    expect(plan.lastErrorSafe).toBe('upstream 503')
  })

  it('vai para dead_letter quando esgota as tentativas', () => {
    const plan = planFailure({ attempts: 5, maxAttempts: 5 }, ERR, 0)
    expect(plan.status).toBe('dead_letter')
    expect(plan.exhausted).toBe(true)
    expect(plan.availableInMs).toBeNull()
    expect(plan.lastErrorCode).toBe('tmdb_5xx')
  })

  it('o backoff cresce entre tentativas consecutivas', () => {
    const first = planFailure({ attempts: 1, maxAttempts: 9 }, ERR, 1)
    const later = planFailure({ attempts: 4, maxAttempts: 9 }, ERR, 1)
    expect(later.availableInMs!).toBeGreaterThan(first.availableInMs!)
  })
})

describe('isReclaimable', () => {
  const now = new Date('2026-07-16T12:00:00.000Z')
  const ago = (ms: number) => new Date(now.getTime() - ms)

  it('recupera job running com heartbeat expirado', () => {
    expect(
      isReclaimable(
        { status: 'running', heartbeatAt: ago(60_000), claimedAt: ago(120_000) },
        now,
        30_000,
      ),
    ).toBe(true)
  })

  it('nao recupera job com heartbeat recente', () => {
    expect(
      isReclaimable(
        { status: 'running', heartbeatAt: ago(5_000), claimedAt: ago(120_000) },
        now,
        30_000,
      ),
    ).toBe(false)
  })

  it('usa claimedAt quando nao ha heartbeat ainda', () => {
    expect(
      isReclaimable({ status: 'claimed', heartbeatAt: null, claimedAt: ago(60_000) }, now, 30_000),
    ).toBe(true)
  })

  it('nao recupera job que nao esta em voo', () => {
    expect(
      isReclaimable({ status: 'pending', heartbeatAt: ago(999_999), claimedAt: null }, now, 30_000),
    ).toBe(false)
    expect(
      isReclaimable(
        { status: 'succeeded', heartbeatAt: ago(999_999), claimedAt: null },
        now,
        30_000,
      ),
    ).toBe(false)
  })

  it('nao recupera job em voo sem heartbeat nem claimedAt (defensivo)', () => {
    expect(
      isReclaimable({ status: 'running', heartbeatAt: null, claimedAt: null }, now, 30_000),
    ).toBe(false)
  })
})

describe('planReclaim', () => {
  it('trata o orfao como falha (retry enquanto ha tentativa)', () => {
    const plan = planReclaim({ attempts: 2, maxAttempts: 5 }, 0)
    expect(plan.status).toBe('retry_wait')
    expect(plan.lastErrorCode).toBe('worker_heartbeat_timeout')
  })

  it('manda orfao esgotado para dead_letter', () => {
    const plan = planReclaim({ attempts: 5, maxAttempts: 5 }, 0)
    expect(plan.status).toBe('dead_letter')
    expect(plan.exhausted).toBe(true)
  })
})

describe('planReplay', () => {
  it('zera o job de dead-letter de volta a pending', () => {
    const plan = planReplay()
    expect(plan).toEqual({ status: 'pending', attempts: 0, clearError: true, clearClaim: true })
  })
})
