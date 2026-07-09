/**
 * Testes do gate de promocao (P0-00f): fail-closed por ambiente. Diferente do raw
 * sync, NAO exige token TMDB (a promocao le tmdb_raw do banco, sem rede). Sem IO.
 */

import { describe, expect, it } from 'vitest'
import {
  describePromoteGateReason,
  evaluatePromoteGate,
  type PromoteGateInput,
} from '../raw-promote/gate.js'

const SAFE: PromoteGateInput = { apply: true, isProd: false, hasDb: true }

describe('evaluatePromoteGate', () => {
  it('apply em ambiente seguro (nao-prod + db) => permitido', () => {
    expect(evaluatePromoteGate(SAFE)).toEqual({ allowed: true, reason: null })
  })

  it('producao real bloqueia SEMPRE (precedencia maxima)', () => {
    expect(evaluatePromoteGate({ ...SAFE, isProd: true })).toEqual({
      allowed: false,
      reason: 'production',
    })
  })

  it('sem DATABASE_URL bloqueia (le tmdb_raw do banco, inclusive em dry-run)', () => {
    expect(evaluatePromoteGate({ ...SAFE, hasDb: false })).toEqual({
      allowed: false,
      reason: 'no-database-url',
    })
    expect(evaluatePromoteGate({ apply: false, isProd: false, hasDb: false })).toEqual({
      allowed: false,
      reason: 'no-database-url',
    })
  })

  it('dry-run com db => permitido (dispensa apply, exige db)', () => {
    expect(evaluatePromoteGate({ apply: false, isProd: false, hasDb: true })).toEqual({
      allowed: true,
      reason: null,
    })
  })

  it('todo motivo tem mensagem pt-BR nao vazia', () => {
    for (const reason of ['production', 'no-database-url'] as const) {
      expect(describePromoteGateReason(reason).length).toBeGreaterThan(0)
    }
  })
})
