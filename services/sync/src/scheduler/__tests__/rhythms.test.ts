/**
 * rhythms.test.ts — A tabela de ritmos e uma DECISAO, e a decisao tem forma.
 *
 * O teste que importa aqui nao e "o intervalo e 24h" (isso e transcricao). E:
 *  - nao existe um intervalo unico para tudo (o defeito que a tabela combate);
 *  - todo intervalo tem MOTIVO escrito;
 *  - a sazonalidade so encurta quem foi declarado sazonal.
 */

import { describe, expect, it } from 'vitest'

import {
  effectiveIntervalHours,
  findRhythm,
  RHYTHMS,
  SCHEDULER_QUEUES,
  type Rhythm,
} from '../rhythms.js'

describe('a tabela de ritmos', () => {
  it('cobre todas as filas declaradas, sem sobra e sem falta', () => {
    const declared = [...SCHEDULER_QUEUES].sort()
    const tabled = RHYTHMS.map((r) => r.queue).sort()
    expect(tabled).toEqual(declared)
  })

  it('nao repete fila', () => {
    expect(new Set(RHYTHMS.map((r) => r.queue)).size).toBe(RHYTHMS.length)
  })

  it('NAO usa um intervalo unico para tudo — este e o ponto da tabela', () => {
    const distintos = new Set(RHYTHMS.map((r) => r.intervalHours))
    // Quatro faixas reais: 6h, 24h, 7 dias, 30 dias.
    expect(distintos.size).toBeGreaterThanOrEqual(4)
  })

  it('todo intervalo carrega um motivo escrito, com substancia', () => {
    for (const rhythm of RHYTHMS) {
      expect(rhythm.rationale.trim().length, rhythm.queue).toBeGreaterThan(80)
      expect(rhythm.label.trim().length, rhythm.queue).toBeGreaterThan(5)
    }
  })

  it('so `seasonal` declara intervalo sazonal; os outros deixam null', () => {
    for (const rhythm of RHYTHMS) {
      if (rhythm.cadence === 'seasonal') {
        expect(rhythm.seasonalIntervalHours, rhythm.queue).not.toBeNull()
        expect(rhythm.seasonalIntervalHours!, rhythm.queue).toBeLessThan(rhythm.intervalHours)
      } else {
        expect(rhythm.seasonalIntervalHours, rhythm.queue).toBeNull()
      }
    }
  })

  it('a sazonalidade encurta SO quem e sazonal', () => {
    const awards = findRhythm('awards')!
    const offers = findRhythm('watch_offers')!

    expect(effectiveIntervalHours(awards, false)).toBe(awards.intervalHours)
    expect(effectiveIntervalHours(awards, true)).toBe(awards.seasonalIntervalHours)

    // Controle: fila fixa ignora o sinal de temporada nos DOIS sentidos.
    expect(effectiveIntervalHours(offers, true)).toBe(offers.intervalHours)
    expect(effectiveIntervalHours(offers, false)).toBe(offers.intervalHours)
  })

  it('fila desconhecida devolve null — nunca um ritmo default', () => {
    expect(findRhythm('fila_que_nao_existe')).toBeNull()
  })

  it('CONTROLE NEGATIVO: um ritmo sazonal sem intervalo sazonal nao encurta', () => {
    // Quebra a regra de propósito: `seasonal` com `seasonalIntervalHours: null`.
    // O fallback devolve o intervalo normal em vez de `null`/NaN — o pior
    // desfecho possivel seria uma fila com intervalo indefinido rodando em loop.
    const torto: Rhythm = {
      ...findRhythm('awards')!,
      seasonalIntervalHours: null,
    }
    expect(effectiveIntervalHours(torto, true)).toBe(torto.intervalHours)
  })
})
