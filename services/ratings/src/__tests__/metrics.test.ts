/**
 * metrics.test.ts — Contadores de observabilidade (§12).
 */

import { describe, expect, it } from 'vitest'

import { METRIC_NAMES, createMetricsCollector } from '../metrics.js'

describe('metricas', () => {
  it('expoe exatamente os nove contadores exigidos', () => {
    expect([...METRIC_NAMES].sort()).toEqual(
      [
        'cinerie_score_blocked_total',
        'cinerie_score_calculation_total',
        'ratings_displayable_total',
        'ratings_recognized_total',
        'ratings_rejected_total',
        'ratings_sync_total',
        'streaming_invalid_links_total',
        'streaming_offers_displayable_total',
        'streaming_offers_total',
      ].sort(),
    )
  })

  it('todo contador nasce em ZERO explicito', () => {
    // Contador ausente e ambiguo ("nao aconteceu" ou "nao instrumentei?").
    // Um zero e uma afirmacao.
    const snapshot = createMetricsCollector().snapshot()
    for (const name of METRIC_NAMES) {
      expect(snapshot[name], name).toBe(0)
    }
  })

  it('incrementa por 1 por default e por N quando pedido', () => {
    const metrics = createMetricsCollector()
    metrics.increment('ratings_sync_total')
    metrics.increment('ratings_recognized_total', 5)
    expect(metrics.snapshot().ratings_sync_total).toBe(1)
    expect(metrics.snapshot().ratings_recognized_total).toBe(5)
  })

  it('RECUSA incremento negativo (contador monotonico nao anda para tras)', () => {
    const metrics = createMetricsCollector()
    expect(() => metrics.increment('ratings_sync_total', -1)).toThrow(/invalido/)
    expect(() => metrics.increment('ratings_sync_total', Number.NaN)).toThrow(/invalido/)
  })

  it('render devolve "nome valor" ordenado, com todos os contadores', () => {
    const metrics = createMetricsCollector()
    metrics.increment('ratings_sync_total', 3)
    const lines = metrics.render()
    expect(lines).toHaveLength(METRIC_NAMES.length)
    expect(lines).toContain('ratings_sync_total 3')
    expect([...lines]).toEqual([...lines].sort())
  })

  it('o snapshot e um retrato, nao uma janela viva', () => {
    const metrics = createMetricsCollector()
    const before = metrics.snapshot()
    metrics.increment('ratings_sync_total')
    expect(before.ratings_sync_total).toBe(0)
    expect(metrics.snapshot().ratings_sync_total).toBe(1)
  })
})
