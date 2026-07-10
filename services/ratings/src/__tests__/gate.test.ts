/**
 * gate.test.ts — Gate FAIL-CLOSED do worker de ratings.
 *
 * Precedencia (mais restritivo primeiro): producao -> chave -> banco -> liberado.
 * Dry-run puro nunca toca rede nem banco, entao passa sem chave/DB.
 */

import { describe, it, expect } from 'vitest'

import {
  evaluateRatingsGate,
  describeRatingsGateReason,
  needsNetwork,
  type RatingsGateReason,
} from '../film-show-ratings/gate.js'

const FAKE_SECRET = 'test-key-0000000000'

describe('evaluateRatingsGate', () => {
  it('producao bloqueia SEMPRE, mesmo com apply=false e sample=false (checada primeiro)', () => {
    const result = evaluateRatingsGate({
      isProd: true,
      apply: false,
      sample: false,
      hasKey: false,
      hasDb: false,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('production')
  })

  it('producao vence mesmo quando apply/sample/chave/db estao presentes', () => {
    const result = evaluateRatingsGate({
      isProd: true,
      apply: true,
      sample: true,
      hasKey: true,
      hasDb: true,
    })
    // Producao e checada antes de qualquer outra condicao.
    expect(result.reason).toBe('production')
  })

  it('sample=true sem chave -> no-api-key', () => {
    const result = evaluateRatingsGate({
      isProd: false,
      apply: false,
      sample: true,
      hasKey: false,
      hasDb: false,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('no-api-key')
  })

  it('apply=true sem chave -> no-api-key', () => {
    const result = evaluateRatingsGate({
      isProd: false,
      apply: true,
      sample: false,
      hasKey: false,
      hasDb: true,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('no-api-key')
  })

  it('apply=true com chave porem sem banco -> no-database-url', () => {
    const result = evaluateRatingsGate({
      isProd: false,
      apply: true,
      sample: false,
      hasKey: true,
      hasDb: false,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('no-database-url')
  })

  // Regra "todo sync externo gera log": qualquer execucao que toca a rede grava
  // api_cache + api_sync_logs. Um --sample sem banco seria ingestao silenciosa.
  it('sample=true com chave porem sem banco -> no-database-url (sample tambem loga)', () => {
    const result = evaluateRatingsGate({
      isProd: false,
      apply: false,
      sample: true,
      hasKey: true,
      hasDb: false,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('no-database-url')
  })

  it('dry-run puro (apply=false, sample=false) sem chave e sem DB -> LIBERADO', () => {
    const result = evaluateRatingsGate({
      isProd: false,
      apply: false,
      sample: false,
      hasKey: false,
      hasDb: false,
    })
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })
})

describe('needsNetwork', () => {
  it('true quando apply, true quando sample, false caso contrario', () => {
    expect(needsNetwork({ apply: true, sample: false })).toBe(true)
    expect(needsNetwork({ apply: false, sample: true })).toBe(true)
    expect(needsNetwork({ apply: false, sample: false })).toBe(false)
  })
})

describe('describeRatingsGateReason', () => {
  const reasons: readonly RatingsGateReason[] = ['production', 'no-api-key', 'no-database-url']

  it('retorna string pt-BR nao-vazia para cada motivo e nunca vaza segredo', () => {
    for (const reason of reasons) {
      const message = describeRatingsGateReason(reason)
      expect(typeof message).toBe('string')
      expect(message.length).toBeGreaterThan(0)
      expect(message).toContain('Bloqueado')
      // A mensagem cita apenas o NOME da variavel/segredo, nunca um valor.
      expect(message).not.toContain(FAKE_SECRET)
    }
  })

  it('no-api-key cita o NOME da env var (nao o valor)', () => {
    const message = describeRatingsGateReason('no-api-key')
    expect(message).toContain('RAPIDAPI_FILM_SHOW_RATINGS_KEY')
  })

  it('no-database-url cita DATABASE_URL', () => {
    const message = describeRatingsGateReason('no-database-url')
    expect(message).toContain('DATABASE_URL')
  })
})
