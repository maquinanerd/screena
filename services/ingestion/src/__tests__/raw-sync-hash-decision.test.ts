/**
 * Testes da idempotencia por hash do raw sync (P0-00d): hash estavel (independe
 * da ordem das chaves) e a decisao create/update/skip. Sem rede, sem DB.
 */

import { describe, expect, it } from 'vitest'
import { computeRawPayloadHash, decideRawOutcome } from '../raw-sync/hash-decision.js'

describe('computeRawPayloadHash', () => {
  it('e estavel: payload equivalente (ordem de chaves diferente) => MESMO hash', () => {
    const a = computeRawPayloadHash({ id: 1, title: 'X', nested: { a: 1, b: 2 } })
    const b = computeRawPayloadHash({ nested: { b: 2, a: 1 }, title: 'X', id: 1 })
    expect(a).toBe(b)
  })

  it('payload diferente => hash diferente', () => {
    const a = computeRawPayloadHash({ id: 1, title: 'X' })
    const b = computeRawPayloadHash({ id: 1, title: 'Y' })
    expect(a).not.toBe(b)
  })
})

describe('decideRawOutcome', () => {
  it('hash ausente (registro novo) => create', () => {
    expect(decideRawOutcome(null, 'h1')).toBe('create')
  })

  it('hash igual => skip (sem update, sem bump de updatedAt)', () => {
    expect(decideRawOutcome('h1', 'h1')).toBe('skip')
  })

  it('hash diferente => update', () => {
    expect(decideRawOutcome('h1', 'h2')).toBe('update')
  })
})
