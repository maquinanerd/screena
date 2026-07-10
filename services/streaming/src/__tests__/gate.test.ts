/**
 * gate.test.ts — Gate fail-closed do worker de disponibilidade.
 *
 * Precedencia: producao > sem chave > sem banco > liberado. Diferenca-chave em
 * relacao ao worker de ratings: aqui `--sample` TAMBEM precisa do banco, porque
 * as entidades vem do PostgreSQL (nao ha lista fixa embutida).
 */

import { describe, expect, it } from 'vitest'

import {
  describeStreamingGateReason,
  evaluateStreamingGate,
  needsNetwork,
  type StreamingGateReason,
} from '../streaming-availability/gate.js'

const BASE = { isProd: false, apply: false, sample: false, hasKey: false, hasDb: false }

describe('evaluateStreamingGate — precedencia fail-closed', () => {
  it('producao bloqueia PRIMEIRO, mesmo em dry-run puro', () => {
    const result = evaluateStreamingGate({ ...BASE, isProd: true })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('production')
  })

  it('producao vence "sem chave" e "sem banco" (mais restritivo)', () => {
    const result = evaluateStreamingGate({
      isProd: true,
      apply: true,
      sample: true,
      hasKey: false,
      hasDb: false,
    })
    expect(result.reason).toBe('production')
  })

  it('--sample sem chave -> no-api-key', () => {
    const result = evaluateStreamingGate({ ...BASE, sample: true })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('no-api-key')
  })

  it('--apply sem chave -> no-api-key', () => {
    const result = evaluateStreamingGate({ ...BASE, apply: true })
    expect(result.reason).toBe('no-api-key')
  })

  it('--sample COM chave mas SEM banco -> no-database-url (sample tambem exige DB)', () => {
    const result = evaluateStreamingGate({ ...BASE, sample: true, hasKey: true, hasDb: false })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('no-database-url')
  })

  it('--apply COM chave mas SEM banco -> no-database-url', () => {
    const result = evaluateStreamingGate({ ...BASE, apply: true, hasKey: true, hasDb: false })
    expect(result.reason).toBe('no-database-url')
  })

  it('--sample com chave e banco -> liberado', () => {
    const result = evaluateStreamingGate({ ...BASE, sample: true, hasKey: true, hasDb: true })
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('dry-run puro (sem rede) sem chave -> liberado', () => {
    const result = evaluateStreamingGate({ ...BASE })
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })
})

describe('needsNetwork', () => {
  it('so precisa de rede com --sample ou --apply', () => {
    expect(needsNetwork({ apply: false, sample: false })).toBe(false)
    expect(needsNetwork({ apply: false, sample: true })).toBe(true)
    expect(needsNetwork({ apply: true, sample: false })).toBe(true)
  })
})

describe('describeStreamingGateReason', () => {
  const reasons: readonly StreamingGateReason[] = ['production', 'no-api-key', 'no-database-url']

  it('cada motivo tem mensagem pt-BR nao-vazia e sem segredo', () => {
    for (const reason of reasons) {
      const message = describeStreamingGateReason(reason)
      expect(typeof message).toBe('string')
      expect(message.length).toBeGreaterThan(10)
      // Nunca vaza um segredo: nenhum run de 20+ caracteres alfanumericos.
      expect(message).not.toMatch(/[A-Za-z0-9]{20,}/)
    }
  })

  it('a mensagem de no-api-key cita a variavel de ambiente, nao o valor', () => {
    const message = describeStreamingGateReason('no-api-key')
    expect(message).toContain('RAPIDAPI_STREAMING_AVAILABILITY_KEY')
  })

  it('a mensagem de no-database-url explica que as entidades vem do PostgreSQL', () => {
    const message = describeStreamingGateReason('no-database-url')
    expect(message).toMatch(/DATABASE_URL/)
    expect(message).toMatch(/PostgreSQL/)
  })
})
