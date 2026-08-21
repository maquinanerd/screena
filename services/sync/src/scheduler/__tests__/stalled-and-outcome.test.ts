/**
 * stalled-and-outcome.test.ts — O alerta de fila parada e a falha parcial.
 *
 * Os dois testes que o dono pediu explicitamente:
 *  - "Uma fila parada dispara o alerta — teste que reprova se o alerta nao sair."
 *  - "Falha parcial e falha visivel. Lote que processa 300 de 500 reporta os 200
 *     e o motivo, nao 'concluido'."
 */

import { describe, expect, it } from 'vitest'

import { evaluateSchedule, type QueueLastRun } from '../due.js'
import type { Rhythm } from '../rhythms.js'
import { classifyRun, describeRun } from '../run-outcome.js'
import { detectStalledQueues, NEVER_RAN_GRACE_HOURS, STALL_THRESHOLD_RATIO } from '../stalled.js'

const H = 60 * 60 * 1000
const BASE = new Date('2026-05-10T12:00:00.000Z')

const DIARIA: Rhythm = {
  queue: 'watch_offers',
  cadence: 'fixed',
  intervalHours: 24,
  seasonalIntervalHours: null,
  providerApi: 'tmdb',
  label: 'diaria',
  rationale: 'x',
}

function schedules(lastSuccessAt: Date | null, now = BASE) {
  const lastRuns: QueueLastRun[] = [{ queue: 'watch_offers', lastSuccessAt, lastAttemptAt: lastSuccessAt }]
  return evaluateSchedule({ now, lastRuns, rhythms: [DIARIA] })
}

describe('alerta de fila parada', () => {
  it('DISPARA quando a fila perde duas janelas inteiras', () => {
    const parada = new Date(BASE.getTime() - STALL_THRESHOLD_RATIO * 24 * H)
    const alerts = detectStalledQueues(schedules(parada), {
      now: BASE,
      startedAt: new Date(BASE.getTime() - 48 * H),
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.kind).toBe('stalled')
    expect(alerts[0]!.queue).toBe('watch_offers')
    // A mensagem tem que carregar o fato, nao so o rotulo.
    expect(alerts[0]!.message).toContain(parada.toISOString())
  })

  it('NAO dispara por uma janela perdida — alerta que grita sempre ninguem le', () => {
    const atrasada = new Date(BASE.getTime() - 1.9 * 24 * H)
    const alerts = detectStalledQueues(schedules(atrasada), {
      now: BASE,
      startedAt: new Date(BASE.getTime() - 48 * H),
    })
    expect(alerts).toEqual([])
  })

  it('fila que nunca rodou vira alerta SO depois da carencia', () => {
    const recemSubido = detectStalledQueues(schedules(null), {
      now: BASE,
      startedAt: new Date(BASE.getTime() - 1 * H),
    })
    expect(recemSubido).toEqual([])

    const jaDeveria = detectStalledQueues(schedules(null), {
      now: BASE,
      startedAt: new Date(BASE.getTime() - (NEVER_RAN_GRACE_HOURS + 1) * H),
    })
    expect(jaDeveria).toHaveLength(1)
    expect(jaDeveria[0]!.kind).toBe('never_ran')
  })

  it('`never_ran` e `stalled` NAO colapsam — pedem acoes diferentes', () => {
    const nunca = detectStalledQueues(schedules(null), {
      now: BASE,
      startedAt: new Date(BASE.getTime() - 24 * H),
    })
    const parou = detectStalledQueues(schedules(new Date(BASE.getTime() - 72 * H)), {
      now: BASE,
      startedAt: new Date(BASE.getTime() - 24 * H),
    })
    expect(nunca[0]!.kind).not.toBe(parou[0]!.kind)
  })

  it('CONTROLE NEGATIVO: com a fila EM DIA, um detector que sempre alertasse seria pego aqui', () => {
    const alerts = detectStalledQueues(schedules(BASE), {
      now: BASE,
      startedAt: new Date(BASE.getTime() - 240 * H),
    })
    expect(alerts).toEqual([])
  })
})

describe('falha parcial e falha visivel', () => {
  const janela = { queue: 'ratings_omdb' as const, startedAt: BASE, finishedAt: new Date(BASE.getTime() + 5_000) }

  it('300 de 500 e PARCIAL, nunca concluido', () => {
    const outcome = classifyRun({
      ...janela,
      planned: 500,
      processed: 300,
      failed: 0,
      skipped: 0,
      reasons: [{ code: 'quota_exhausted', detail: 'cota da OMDb esgotada', count: 200 }],
    })
    expect(outcome.status).toBe('partial')
    expect(describeRun(outcome)).toContain('INCOMPLETO 300/500')
    expect(describeRun(outcome)).toContain('quota_exhausted')
  })

  it('PARCIAL nao avanca o ultimo sucesso — senao a fila pareceria saudavel para sempre', () => {
    const parcial = classifyRun({ ...janela, planned: 500, processed: 300, failed: 0, skipped: 0 })
    const completo = classifyRun({ ...janela, planned: 500, processed: 500, failed: 0, skipped: 0 })
    expect(parcial.advancesLastSuccess).toBe(false)
    expect(completo.advancesLastSuccess).toBe(true)
  })

  it('zero processados com trabalho planejado e FALHA, nao parcial', () => {
    const outcome = classifyRun({ ...janela, planned: 500, processed: 0, failed: 0, skipped: 0 })
    expect(outcome.status).toBe('failure')
  })

  it('nada a fazer e SUCESSO, e distinguivel de "quebrou"', () => {
    const outcome = classifyRun({ ...janela, planned: 0, processed: 0, failed: 0, skipped: 0 })
    expect(outcome.status).toBe('success')
    expect(describeRun(outcome)).toContain('nada a fazer')
  })

  it('pulado por politica FECHA o lote: 200 processados + 300 pulados = concluido', () => {
    const outcome = classifyRun({
      ...janela,
      planned: 500,
      processed: 200,
      failed: 0,
      skipped: 300,
      reasons: [{ code: 'fresh_enough', detail: 'dentro da janela de frescor', count: 300 }],
    })
    expect(outcome.status).toBe('success')
  })

  it('UMA falha ja tira o lote de concluido, mesmo com a soma fechando', () => {
    const outcome = classifyRun({ ...janela, planned: 500, processed: 499, failed: 1, skipped: 0 })
    expect(outcome.status).toBe('partial')
  })

  it('desfecho ruim SEM motivo ganha um motivo sintetico — o vazio nao passa', () => {
    const outcome = classifyRun({ ...janela, planned: 500, processed: 300, failed: 0, skipped: 0 })
    expect(outcome.reasons).toHaveLength(1)
    expect(outcome.reasons[0]!.code).toBe('reason_not_reported')
  })

  it('CONTROLE NEGATIVO: um classificador que so olhasse excecao chamaria 300/500 de sucesso', () => {
    // Nenhuma excecao foi lancada em nenhum caso acima. Se `classifyRun` usasse
    // "nao lancou => sucesso", este seria `success` — e o assert abaixo cai.
    const outcome = classifyRun({ ...janela, planned: 500, processed: 300, failed: 0, skipped: 0 })
    expect(outcome.status).not.toBe('success')
  })
})
