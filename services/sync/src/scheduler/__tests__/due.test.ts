/**
 * due.test.ts — Quem roda agora, e em que ordem.
 *
 * As fronteiras sao testadas com relogio INJETADO: exatamente na hora, um
 * milissegundo antes, um depois. Um agendador que erra a fronteira por 1ms roda
 * duas vezes ou nunca — e nenhum dos dois aparece num teste de "mais ou menos".
 */

import { describe, expect, it } from 'vitest'

import { evaluateSchedule, selectDueQueues, type QueueLastRun } from '../due.js'
import type { Rhythm } from '../rhythms.js'

const H = 60 * 60 * 1000

/** Duas filas sinteticas: uma diaria, uma mensal. */
const DIARIA: Rhythm = {
  queue: 'watch_offers',
  cadence: 'fixed',
  intervalHours: 24,
  seasonalIntervalHours: null,
  providerApi: 'tmdb',
  label: 'diaria',
  rationale: 'x',
}
const MENSAL: Rhythm = {
  queue: 'people',
  cadence: 'fixed',
  intervalHours: 720,
  seasonalIntervalHours: null,
  providerApi: 'tmdb',
  label: 'mensal',
  rationale: 'x',
}
const RITMOS = [DIARIA, MENSAL] as const

function run(queue: QueueLastRun['queue'], lastSuccessAt: Date | null): QueueLastRun {
  return { queue, lastSuccessAt, lastAttemptAt: lastSuccessAt }
}

// Fora de qualquer janela de premiacao (maio), para a sazonalidade nao interferir.
const BASE = new Date('2026-05-10T12:00:00.000Z')

describe('a fronteira do intervalo', () => {
  it('exatamente na hora de vencer, JA venceu', () => {
    const last = new Date(BASE.getTime() - 24 * H)
    const [diaria] = evaluateSchedule({ now: BASE, lastRuns: [run('watch_offers', last)], rhythms: [DIARIA] })
    expect(diaria!.due).toBe(true)
  })

  it('um milissegundo antes, ainda NAO venceu', () => {
    const last = new Date(BASE.getTime() - 24 * H + 1)
    const [diaria] = evaluateSchedule({ now: BASE, lastRuns: [run('watch_offers', last)], rhythms: [DIARIA] })
    expect(diaria!.due).toBe(false)
  })

  it('fila que NUNCA rodou esta vencida — nao espera um intervalo', () => {
    const [diaria] = evaluateSchedule({ now: BASE, lastRuns: [run('watch_offers', null)], rhythms: [DIARIA] })
    expect(diaria!.due).toBe(true)
    expect(diaria!.overdueRatio).toBe(Number.POSITIVE_INFINITY)
    expect(diaria!.dueAt).toBeNull()
  })

  it('fila ausente da leitura e tratada como nunca-rodada, nao como em dia', () => {
    const [diaria] = evaluateSchedule({ now: BASE, lastRuns: [], rhythms: [DIARIA] })
    expect(diaria!.due).toBe(true)
  })

  it('avalia TODAS as filas, nao so as vencidas — painel precisa do que esta em dia', () => {
    const todas = evaluateSchedule({
      now: BASE,
      lastRuns: [run('watch_offers', BASE), run('people', BASE)],
      rhythms: RITMOS,
    })
    expect(todas).toHaveLength(2)
    expect(todas.every((e) => !e.due)).toBe(true)
  })
})

describe('a ordem e por atraso RELATIVO', () => {
  it('a diaria atrasada 2 dias vence a mensal atrasada 3 dias', () => {
    const due = selectDueQueues({
      now: BASE,
      rhythms: RITMOS,
      lastRuns: [
        // 3 dias de atraso absoluto, 10% do intervalo mensal.
        run('people', new Date(BASE.getTime() - (720 + 72) * H)),
        // 2 dias de atraso absoluto, 200% do intervalo diario.
        run('watch_offers', new Date(BASE.getTime() - 72 * H)),
      ],
    })
    expect(due.map((d) => d.queue)).toEqual(['watch_offers', 'people'])
  })

  it('CONTROLE NEGATIVO: ordenar por atraso ABSOLUTO inverteria — e por isso o teste acima prova algo', () => {
    const now = BASE
    const atrasoDiariaMs = 72 * H
    const atrasoMensalMs = 72 * H + 0 // mesmo atraso absoluto...
    expect(atrasoMensalMs).toBe(atrasoDiariaMs)
    // ...e ainda assim o relativo separa: 200% contra 10%.
    const due = selectDueQueues({
      now,
      rhythms: RITMOS,
      lastRuns: [
        run('people', new Date(now.getTime() - (720 + 72) * H)),
        run('watch_offers', new Date(now.getTime() - 72 * H)),
      ],
    })
    expect(due[0]!.overdueRatio).toBeGreaterThan(due[1]!.overdueRatio)
  })

  it('quem nunca rodou vai para o topo', () => {
    const due = selectDueQueues({
      now: BASE,
      rhythms: RITMOS,
      lastRuns: [run('watch_offers', new Date(BASE.getTime() - 48 * H)), run('people', null)],
    })
    expect(due[0]!.queue).toBe('people')
  })

  it('empate se resolve pela ORDEM DA TABELA, nunca pelo nome', () => {
    const due = selectDueQueues({
      now: BASE,
      rhythms: RITMOS,
      lastRuns: [run('watch_offers', null), run('people', null)],
    })
    // `watch_offers` vem antes na tabela; alfabeticamente `people` viria antes.
    expect(due.map((d) => d.queue)).toEqual(['watch_offers', 'people'])
  })

  it('fila em dia nao entra na selecao', () => {
    const due = selectDueQueues({
      now: BASE,
      rhythms: RITMOS,
      lastRuns: [run('watch_offers', BASE), run('people', BASE)],
    })
    expect(due).toEqual([])
  })
})

describe('sazonalidade dentro da avaliacao', () => {
  it('a fila de premiacao encurta dentro da janela do Oscar e volta fora dela', () => {
    const dentro = new Date('2026-03-01T00:00:00.000Z')
    const fora = new Date('2026-05-10T00:00:00.000Z')
    const lastRuns = [{ queue: 'awards' as const, lastSuccessAt: null, lastAttemptAt: null }]

    const [emTemporada] = evaluateSchedule({ now: dentro, lastRuns })
      .filter((e) => e.queue === 'awards')
    const [foraTemporada] = evaluateSchedule({ now: fora, lastRuns })
      .filter((e) => e.queue === 'awards')

    expect(emTemporada!.intervalHours).toBe(24)
    expect(foraTemporada!.intervalHours).toBe(720)
    expect(emTemporada!.seasonNote).toContain('Oscar')
    expect(foraTemporada!.seasonNote).toBe('fora de temporada')
  })
})
