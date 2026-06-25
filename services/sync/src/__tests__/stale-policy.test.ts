/**
 * Testes da politica de frescor (stale). Pura, sem rede/DB.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_STALE_WINDOW_MS, isStale, staleAfterFrom } from '../stale-policy.js'

const NOW = new Date('2026-06-25T00:00:00.000Z')

describe('stale policy', () => {
  it('staleAfterFrom soma a janela padrao', () => {
    expect(staleAfterFrom(NOW).getTime()).toBe(NOW.getTime() + DEFAULT_STALE_WINDOW_MS)
  })

  it('staleAfterFrom aceita janela custom', () => {
    expect(staleAfterFrom(NOW, 1000).getTime()).toBe(NOW.getTime() + 1000)
  })

  it('isStale: sem stale_after -> stale', () => {
    expect(isStale(NOW, null)).toBe(true)
  })

  it('isStale: vencido -> stale; futuro -> nao', () => {
    expect(isStale(NOW, new Date(NOW.getTime() - 1))).toBe(true)
    expect(isStale(NOW, new Date(NOW.getTime() + 1))).toBe(false)
  })
})
