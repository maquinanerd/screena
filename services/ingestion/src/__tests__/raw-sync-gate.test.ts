/**
 * Testes do gate de seguranca do raw sync (P0-00d): o maior risco e rodar o
 * piloto no ambiente errado. A decisao e pura e fail-closed. Sem rede, sem DB.
 */

import { describe, expect, it } from 'vitest'
import {
  describeRawSyncGateReason,
  evaluateRawSyncGate,
  type RawSyncGateInput,
} from '../raw-sync/gate.js'

const SAFE_APPLY: RawSyncGateInput = {
  apply: true,
  isProd: false,
  hasDb: true,
  hasToken: true,
  queueFound: true,
}

describe('evaluateRawSyncGate', () => {
  it('apply em ambiente seguro (nao-prod + db + token + fila) => permitido', () => {
    expect(evaluateRawSyncGate(SAFE_APPLY)).toEqual({ allowed: true, reason: null })
  })

  it('producao real bloqueia SEMPRE (precedencia maxima)', () => {
    expect(evaluateRawSyncGate({ ...SAFE_APPLY, isProd: true })).toEqual({
      allowed: false,
      reason: 'production',
    })
  })

  it('fila ausente bloqueia (inclusive em dry-run)', () => {
    expect(evaluateRawSyncGate({ ...SAFE_APPLY, apply: false, queueFound: false })).toEqual({
      allowed: false,
      reason: 'queue-missing',
    })
  })

  it('dry-run so exige fila + nao-prod (dispensa db/token)', () => {
    expect(
      evaluateRawSyncGate({
        apply: false,
        isProd: false,
        hasDb: false,
        hasToken: false,
        queueFound: true,
      }),
    ).toEqual({ allowed: true, reason: null })
  })

  it('apply sem DATABASE_URL nao roda piloto real', () => {
    expect(evaluateRawSyncGate({ ...SAFE_APPLY, hasDb: false })).toEqual({
      allowed: false,
      reason: 'no-database-url',
    })
  })

  it('apply sem token TMDB nao roda piloto real', () => {
    expect(evaluateRawSyncGate({ ...SAFE_APPLY, hasToken: false })).toEqual({
      allowed: false,
      reason: 'no-token',
    })
  })

  it('todo motivo tem mensagem pt-BR nao vazia', () => {
    for (const reason of ['production', 'queue-missing', 'no-database-url', 'no-token'] as const) {
      expect(describeRawSyncGateReason(reason).length).toBeGreaterThan(0)
    }
  })
})
