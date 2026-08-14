/**
 * omdb-budget.test.ts — Quem cede quando a cota acaba.
 *
 * Os dois testes que o dono pediu: com a cota estourada o titulo VOLTA para a
 * fila, e o motivo aparece no log — nao vira pagina muda.
 */

import { describe, expect, it } from 'vitest'

import {
  budgetLogFields,
  checkOmdbBudget,
  OMDB_CONSUMERS,
  OMDB_DAILY_LIMIT,
  ON_DEMAND_RESERVE,
  shouldRequeue,
} from '../on-demand/omdb-budget.js'

describe('quem cede', () => {
  it('com cota folgada, os dois passam', () => {
    for (const c of OMDB_CONSUMERS) {
      expect(checkOmdbBudget(c, { spentToday: 0 }).granted).toBe(true)
    }
  })

  it('no fim do dia a SEMENTE cede e o LEITOR passa', () => {
    // Restam menos requisicoes que a reserva: so o leitor alcanca.
    const spentToday = OMDB_DAILY_LIMIT - Math.floor(ON_DEMAND_RESERVE / 2)

    const semente = checkOmdbBudget('seed', { spentToday })
    expect(semente.granted).toBe(false)
    if (!semente.granted) expect(semente.reason).toBe('reserved_for_reader')

    const leitor = checkOmdbBudget('on_demand', { spentToday })
    expect(leitor.granted, 'quem espera na tela vence a fila de fundo').toBe(true)
  })

  it('com o teto INTEIRO esgotado, ninguem passa — nem o leitor', () => {
    for (const c of OMDB_CONSUMERS) {
      const v = checkOmdbBudget(c, { spentToday: OMDB_DAILY_LIMIT })
      expect(v.granted).toBe(false)
      if (!v.granted) expect(v.reason).toBe('quota_exhausted')
    }
  })

  it('os dois motivos de negacao sao distintos — a acao difere', () => {
    const cedeu = checkOmdbBudget('seed', { spentToday: OMDB_DAILY_LIMIT - 1 })
    const acabou = checkOmdbBudget('seed', { spentToday: OMDB_DAILY_LIMIT })
    expect(cedeu.granted).toBe(false)
    expect(acabou.granted).toBe(false)
    if (cedeu.granted || acabou.granted) return
    expect(cedeu.reason).not.toBe(acabou.reason)
  })

  it('o teto e a reserva sao injetaveis (plano pago muda o numero)', () => {
    const v = checkOmdbBudget('seed', { spentToday: 900, dailyLimit: 100_000, reserve: 150 })
    expect(v.granted).toBe(true)
  })
})

describe('estouro NAO vira pagina muda', () => {
  it('toda negacao volta para a fila', () => {
    const negados = [
      checkOmdbBudget('seed', { spentToday: OMDB_DAILY_LIMIT }),
      checkOmdbBudget('on_demand', { spentToday: OMDB_DAILY_LIMIT }),
      checkOmdbBudget('seed', { spentToday: OMDB_DAILY_LIMIT - 1 }),
    ]
    for (const v of negados) {
      expect(v.granted).toBe(false)
      // Negacao por cota e fato sobre o DIA, nunca sobre o TITULO. Tratar como
      // terminal gravaria "sem nota" num titulo que tem nota.
      expect(shouldRequeue(v)).toBe(true)
    }
  })

  it('concessao nao re-enfileira', () => {
    expect(shouldRequeue(checkOmdbBudget('on_demand', { spentToday: 0 }))).toBe(false)
  })

  it('o motivo aparece no log, com o id e o saldo', () => {
    const v = checkOmdbBudget('seed', { spentToday: OMDB_DAILY_LIMIT })
    const log = budgetLogFields('seed', 1061474, v)
    expect(log.tmdbId).toBe(1061474)
    expect(log.granted).toBe(false)
    expect(log.reason).toBe('quota_exhausted')
    expect(log.requeued).toBe(true)
    expect(String(log.detail).length).toBeGreaterThan(0)
  })

  it('todo desfecho tem detalhe legivel — nenhum e mudo', () => {
    const todos = [
      checkOmdbBudget('on_demand', { spentToday: 0 }),
      checkOmdbBudget('seed', { spentToday: OMDB_DAILY_LIMIT - 1 }),
      checkOmdbBudget('seed', { spentToday: OMDB_DAILY_LIMIT }),
    ]
    for (const v of todos) expect(v.detail.length).toBeGreaterThan(0)
  })
})
