/**
 * Testes do hash estavel de payload.
 */

import { describe, expect, it } from 'vitest'
import { hashPayload, sha256Hex, stableStringify } from '../utils/hash.js'

describe('hash', () => {
  it('stableStringify ordena chaves recursivamente', () => {
    const a = stableStringify({ b: 1, a: { d: 2, c: 3 } })
    const b = stableStringify({ a: { c: 3, d: 2 }, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  it('hashPayload e independente da ordem das chaves', () => {
    expect(hashPayload({ x: 1, y: 2 })).toBe(hashPayload({ y: 2, x: 1 }))
  })

  it('hashPayload muda quando o conteudo muda', () => {
    expect(hashPayload({ x: 1 })).not.toBe(hashPayload({ x: 2 }))
  })

  it('sha256Hex e deterministico e tem 64 hex', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'))
    expect(sha256Hex('abc')).toHaveLength(64)
  })
})
