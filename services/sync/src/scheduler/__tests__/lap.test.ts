/**
 * lap.test.ts — A volta de uma fila, com o verde que TEM de poder ficar vermelho.
 */

import { describe, expect, it } from 'vitest'

import { computeLap, computeMeasuredLap, LAP_ALERT_DAYS, lapDays } from '../lap.js'

describe('computeLap — a conta declarada', () => {
  it('teto global de 200 sobre 70.537 titulos numa fila diaria: ~353 dias e VERMELHO', () => {
    const volta = computeLap({ universe: { kind: 'counted', items: 70_537 }, perCycle: 200, intervalHours: 24 })
    expect(volta.kind).toBe('days')
    if (volta.kind !== 'days') return
    expect(volta.days).toBeCloseTo(352.685, 3)
    expect(volta.alert).toBe(true)
  })

  it('CONTROLE NEGATIVO: o teto proprio de 12.000 fecha em ~5,9 dias e NAO alerta', () => {
    const volta = computeLap({ universe: { kind: 'counted', items: 70_537 }, perCycle: 12_000, intervalHours: 24 })
    expect(volta.kind === 'days' && volta.alert).toBe(false)
    expect(volta.kind === 'days' ? volta.days : NaN).toBeCloseTo(5.878, 3)
  })

  it('a fronteira e ESTRITA: exatamente 30 dias nao alerta; um pouco acima, alerta', () => {
    const exato = computeLap({ universe: { kind: 'counted', items: 30 * 100 }, perCycle: 100, intervalHours: 24 })
    const acima = computeLap({ universe: { kind: 'counted', items: 30 * 100 + 1 }, perCycle: 100, intervalHours: 24 })
    expect(exato.kind === 'days' && exato.alert).toBe(false)
    expect(acima.kind === 'days' && acima.alert).toBe(true)
    expect(LAP_ALERT_DAYS).toBe(30)
  })

  it('fila SEMANAL: 200 por 7 dias e 28,6 por dia', () => {
    const volta = computeLap({ universe: { kind: 'counted', items: 10_000 }, perCycle: 200, intervalHours: 168 })
    expect(volta.kind === 'days' ? volta.perDay : NaN).toBeCloseTo(28.571, 3)
    expect(volta.kind === 'days' ? volta.days : NaN).toBeCloseTo(350, 6)
  })

  it('usa a MESMA formula que o teste de teto usa (fonte unica)', () => {
    const volta = computeLap({ universe: { kind: 'counted', items: 67_288 }, perCycle: 200, intervalHours: 24 })
    expect(volta.kind === 'days' ? volta.days : NaN).toBe(lapDays(67_288, 200, 24))
  })

  it('universo nao contavel passa adiante com o motivo — nunca vira zero', () => {
    expect(computeLap({ universe: { kind: 'not_applicable', reason: '4 listas' }, perCycle: 4, intervalHours: 6 })).toEqual({
      kind: 'not_applicable',
      reason: '4 listas',
    })
    expect(
      computeLap({ universe: { kind: 'undeterminable', reason: 'export fora do banco' }, perCycle: null, intervalHours: 24 }).kind,
    ).toBe('undeterminable')
  })

  it('teto desconhecido e indeterminado; teto zero e "nunca"; universo vazio e zero dias', () => {
    expect(computeLap({ universe: { kind: 'counted', items: 10 }, perCycle: null, intervalHours: 24 }).kind).toBe('undeterminable')
    expect(computeLap({ universe: { kind: 'counted', items: 10 }, perCycle: 0, intervalHours: 24 }).kind).toBe('never')
    expect(computeLap({ universe: { kind: 'counted', items: 0 }, perCycle: 0, intervalHours: 24 })).toMatchObject({ kind: 'days', days: 0 })
  })
})

describe('computeMeasuredLap — a volta pelo que a fila FEZ', () => {
  it('sem execucao na janela: indeterminado, nao zero', () => {
    expect(computeMeasuredLap({ kind: 'counted', items: 100 }, null).kind).toBe('undeterminable')
  })

  it('processou zero: a volta nao fecha', () => {
    expect(computeMeasuredLap({ kind: 'counted', items: 100 }, 0).kind).toBe('never')
  })

  it('300 dias medidos saem em vermelho; 3 dias nao', () => {
    const lenta = computeMeasuredLap({ kind: 'counted', items: 60_000 }, 200)
    const rapida = computeMeasuredLap({ kind: 'counted', items: 600 }, 200)
    expect(lenta).toMatchObject({ kind: 'days', days: 300, alert: true })
    expect(rapida).toMatchObject({ kind: 'days', days: 3, alert: false })
  })
})
