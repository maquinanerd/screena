/**
 * cost-ceiling.test.ts — Teto de CUSTO (B-G).
 *
 * O que estes testes travam: (1) o teto e de dinheiro, medido em bytes no
 * object store e no catalogo — nunca em disco livre de uma particao alheia;
 * (2) estourar PARA e nao retoma sozinho; (3) o veredito e sempre explicito,
 * inclusive quando esta tudo bem.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_COST_BUDGET,
  evaluateCostBudget,
  FREE_TIER_BYTES,
  remainingEntityHeadroom,
  renderCostVerdict,
  type CostBudget,
} from '../budget/cost-ceiling.js'

const GB = 1_000_000_000

function measure(objectBytes: number, catalogBytes = 0, objectCount = 0) {
  return { objectBytes, catalogBytes, objectCount }
}

describe('evaluateCostBudget', () => {
  it('dentro do orcamento e ok e NAO para', () => {
    const verdict = evaluateCostBudget(measure(1 * GB))
    expect(verdict.mustStop).toBe(false)
    expect(verdict.shouldWarn).toBe(false)
    expect(verdict.dimensions.find((d) => d.name === 'object_store')?.state).toBe('ok')
  })

  it('avisa a partir de 80% do teto, sem parar', () => {
    const verdict = evaluateCostBudget(measure(8 * GB))
    expect(verdict.shouldWarn).toBe(true)
    expect(verdict.mustStop).toBe(false)
    expect(verdict.reasons.join(' ')).toContain('80%')
  })

  it('atingir EXATAMENTE o teto ja e estouro', () => {
    const verdict = evaluateCostBudget(measure(FREE_TIER_BYTES))
    expect(verdict.mustStop).toBe(true)
  })

  it('estourar PARA e diz que religar e decisao humana', () => {
    const verdict = evaluateCostBudget(measure(11 * GB))
    expect(verdict.mustStop).toBe(true)
    expect(renderCostVerdict(verdict)).toContain('nao retoma sozinho')
  })

  it('o catalogo e uma dimensao PROPRIA do teto', () => {
    const budget: CostBudget = { objectBytesLimit: null, catalogBytesLimit: 100, warnFraction: 0.8 }
    const verdict = evaluateCostBudget(measure(999 * GB, 150), budget)
    expect(verdict.mustStop).toBe(true)
    expect(verdict.dimensions.find((d) => d.name === 'object_store')?.state).toBe('unlimited')
    expect(verdict.dimensions.find((d) => d.name === 'catalog')?.state).toBe('exceeded')
  })

  it('sem teto NAO e o mesmo que dentro do teto', () => {
    const verdict = evaluateCostBudget(measure(999 * GB), {
      objectBytesLimit: null,
      catalogBytesLimit: null,
      warnFraction: 0.8,
    })
    expect(verdict.dimensions.every((d) => d.state === 'unlimited')).toBe(true)
    expect(verdict.mustStop).toBe(false)
    // `unlimited` e um estado nomeado; nunca se disfarca de `ok`.
    expect(verdict.dimensions.some((d) => d.state === 'ok')).toBe(false)
  })

  it('o default e o free tier de 10 GB no object store', () => {
    expect(DEFAULT_COST_BUDGET.objectBytesLimit).toBe(FREE_TIER_BYTES)
    expect(FREE_TIER_BYTES).toBe(10 * GB)
  })

  it('warnFraction invalida cai no default em vez de desligar o aviso', () => {
    for (const bad of [0, 1, -1, Number.NaN]) {
      const verdict = evaluateCostBudget(measure(8 * GB), {
        ...DEFAULT_COST_BUDGET,
        warnFraction: bad,
      })
      expect(verdict.shouldWarn).toBe(true)
    }
  })

  it('o relatorio SEMPRE imprime as duas dimensoes, mesmo tudo ok', () => {
    const rendered = renderCostVerdict(evaluateCostBudget(measure(1 * GB, 0, 10)))
    expect(rendered).toContain('object_store')
    expect(rendered).toContain('catalog')
    expect(rendered).toContain('media por objeto')
  })
})

describe('remainingEntityHeadroom', () => {
  it('estima quantas entidades ainda cabem, pela media OBSERVADA', () => {
    const verdict = evaluateCostBudget(measure(9 * GB, 0, 30_000))
    // 9 GB / 30000 = 300 kB por objeto; sobra 1 GB.
    expect(verdict.avgBytesPerObject).toBe(300_000)
    expect(remainingEntityHeadroom(verdict)).toBe(Math.floor(GB / 300_000))
  })

  it('sem teto devolve null, nunca Infinity nem um numero inventado', () => {
    const verdict = evaluateCostBudget(measure(1 * GB, 0, 10), {
      objectBytesLimit: null,
      catalogBytesLimit: null,
      warnFraction: 0.8,
    })
    expect(remainingEntityHeadroom(verdict)).toBeNull()
  })

  it('sem media observada devolve null', () => {
    const verdict = evaluateCostBudget(measure(1 * GB, 0, 0))
    expect(verdict.avgBytesPerObject).toBeNull()
    expect(remainingEntityHeadroom(verdict)).toBeNull()
  })

  it('estourado devolve zero, nunca negativo', () => {
    const verdict = evaluateCostBudget(measure(12 * GB, 0, 40_000))
    expect(remainingEntityHeadroom(verdict)).toBe(0)
  })

  it('aceita uma media externa quando a observada nao serve', () => {
    const verdict = evaluateCostBudget(measure(5 * GB, 0, 0))
    expect(remainingEntityHeadroom(verdict, 500_000)).toBe(Math.floor((5 * GB) / 500_000))
  })
})
