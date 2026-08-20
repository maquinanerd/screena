/**
 * engine.test.ts — Testes do engine do Cinerie Score.
 *
 * A formula fake abaixo existe SO aqui. Ela nao e exportada, nao e registrada
 * em `PRODUCTION_FORMULA_REGISTRY` e nao representa nenhuma decisao de produto:
 * serve exclusivamente para provar que o caminho feliz FUNCIONA quando (e
 * somente quando) uma decisao humana o autoriza. A formula real e pendente em
 * docs/product/cinerie-score-decision.md.
 */

import { describe, expect, it } from 'vitest'

import { CINERIE_SCORE_BLOCKED_VERSION } from '@screena/config'

import {
  CINERIE_SCORE_USE_CASE,
  PRODUCTION_FORMULA_REGISTRY,
  computeCinerieScore,
  computeInputsHash,
  createFormulaRegistry,
} from '../engine.js'
import type {
  CinerieScoreDecisionInput,
  CinerieScoreFormula,
  CinerieScoreInput,
} from '../types.js'

const NOW = new Date('2026-07-17T12:00:00.000Z')
const FAKE_VERSION = 'cinerie-score/test-fake-v1'

/** Formula FAKE — so teste. Nao e proposta de formula. */
const fakeFormula: CinerieScoreFormula = {
  version: FAKE_VERSION,
  compute: (input, ctx) => ({
    value: 4,
    scale: 5,
    version: FAKE_VERSION,
    inputsHash: ctx.inputsHash,
    explanation: input.ratings.map((r) => ({ source: r.source, normalized: r.value / r.best, weight: 1 })),
    calculatedAt: ctx.now.toISOString(),
  }),
}

const input: CinerieScoreInput = {
  entityId: '1',
  ratings: [
    { source: 'imdb', type: 'audience', value: 8.4, best: 10, count: 1000, licenseDecisionId: '10' },
    { source: 'metacritic', type: 'critics', value: 78, best: 100, count: 40, licenseDecisionId: '11' },
  ],
}

function approvedDecision(overrides: Partial<CinerieScoreDecisionInput> = {}): CinerieScoreDecisionInput {
  return {
    useCase: CINERIE_SCORE_USE_CASE,
    stage: 'approved_for_display',
    displayAllowed: true,
    derivativeAllowed: true,
    isCurrent: true,
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: null,
    // Eixos SEPARADOS (achado A7): o id juridico nunca seleciona algoritmo.
    policyVersion: 'legal/2026-07',
    approvedFormulaVersion: FAKE_VERSION,
    ...overrides,
  }
}

describe('cinerie score — o estado de producao e BLOQUEADO', () => {
  /**
   * Ate 20/08/2026 esta asserçao era `toEqual([])` — o registro vazio ERA a
   * prova de que nenhuma formula tinha sido aprovada.
   *
   * O proprietario fechou a formula, e o registro deixou de estar vazio. A
   * asserçao NAO foi removida: virou uma igualdade de CONJUNTO. Registrar uma
   * segunda formula sem decisao humana continua reprovando aqui — e, mais
   * importante, o bloco inteiro abaixo continua provando que REGISTRAR NAO E
   * LIGAR: com a formula registrada, o estado de producao segue BLOQUEADO,
   * porque nao ha `DataUsageDecision` para `cinerie_score_display`.
   */
  it('o registro de PRODUCAO tem exatamente a formula aprovada — nem mais, nem menos', () => {
    expect(PRODUCTION_FORMULA_REGISTRY.versions).toEqual(['cinerie-score/2026-08-v1'])
  })

  it('registrar a formula NAO acendeu o score: sem decisao, continua bloqueado', () => {
    // A asserçao que substitui o registro vazio como guarda. A formula existe no
    // build e mesmo assim nada e calculado, porque o elo que falta e HUMANO.
    const outcome = computeCinerieScore(input, {
      registry: PRODUCTION_FORMULA_REGISTRY,
      decision: null,
      now: NOW,
    })
    expect(outcome.status).toBe('blocked_by_decision')
  })

  it('sem decisao, bloqueia com reason=no-decision e nao produz nota', () => {
    const outcome = computeCinerieScore(input, {
      registry: PRODUCTION_FORMULA_REGISTRY,
      decision: null,
      now: NOW,
    })
    expect(outcome.status).toBe('blocked_by_decision')
    if (outcome.status !== 'blocked_by_decision') throw new Error('esperado bloqueio')
    expect(outcome.reason).toBe('no-decision')
    expect(outcome.version).toBe(CINERIE_SCORE_BLOCKED_VERSION)
    expect(outcome).not.toHaveProperty('value')
  })

  it('mesmo com decisao aprovada, o registro de PRODUCAO nao tem a formula', () => {
    const outcome = computeCinerieScore(input, {
      registry: PRODUCTION_FORMULA_REGISTRY,
      decision: approvedDecision({ approvedFormulaVersion: 'qualquer/v1' }),
      now: NOW,
    })
    expect(outcome.status).toBe('blocked_by_decision')
    if (outcome.status !== 'blocked_by_decision') throw new Error('esperado bloqueio')
    expect(outcome.reason).toBe('formula-not-registered')
  })
})

describe('cinerie score — cada elo da autorizacao bloqueia sozinho', () => {
  const registry = createFormulaRegistry([fakeFormula])

  it.each([
    ['decisao de outro use case', { useCase: 'internal_analytics' }, 'no-decision'],
    ['decisao nao vigente', { isCurrent: false }, 'decision-not-current'],
    ['estagio anterior a aprovacao', { stage: 'license_pending' }, 'decision-stage-not-approved'],
    ['aprovada mas display_allowed=false', { displayAllowed: false }, 'decision-stage-not-approved'],
    ['sem derivative_allowed', { derivativeAllowed: false }, 'decision-derivative-not-allowed'],
    ['ainda nao vigente', { validFrom: new Date('2027-01-01T00:00:00.000Z') }, 'decision-out-of-validity'],
    ['ja expirada', { validUntil: new Date('2026-01-02T00:00:00.000Z') }, 'decision-out-of-validity'],
  ])('%s => %s', (_label, overrides, expectedReason) => {
    const outcome = computeCinerieScore(input, {
      registry,
      decision: approvedDecision(overrides as Partial<CinerieScoreDecisionInput>),
      now: NOW,
    })
    expect(outcome.status).toBe('blocked_by_decision')
    if (outcome.status !== 'blocked_by_decision') throw new Error('esperado bloqueio')
    expect(outcome.reason).toBe(expectedReason)
  })

  it('nota de entrada sem decisao de uso bloqueia o calculo inteiro', () => {
    const outcome = computeCinerieScore(
      {
        entityId: '1',
        ratings: [
          { source: 'imdb', type: 'audience', value: 8.4, best: 10, count: 1, licenseDecisionId: '10' },
          { source: 'metacritic', type: 'critics', value: 78, best: 100, count: 1, licenseDecisionId: '  ' },
        ],
      },
      { registry, decision: approvedDecision(), now: NOW },
    )
    expect(outcome.status).toBe('blocked_by_decision')
    if (outcome.status !== 'blocked_by_decision') throw new Error('esperado bloqueio')
    expect(outcome.reason).toBe('rating-without-license-decision')
  })

  it('a vigencia e exclusiva no fim: exatamente em validUntil ja expirou', () => {
    const outcome = computeCinerieScore(input, {
      registry,
      decision: approvedDecision({ validUntil: NOW }),
      now: NOW,
    })
    expect(outcome.status).toBe('blocked_by_decision')
  })
})

describe('cinerie score — caminho feliz so com decisao E formula (fake, so em teste)', () => {
  const registry = createFormulaRegistry([fakeFormula])

  it('calcula quando a decisao aprova a versao registrada', () => {
    const outcome = computeCinerieScore(input, { registry, decision: approvedDecision(), now: NOW })
    expect(outcome.status).toBe('calculated')
    if (outcome.status !== 'calculated') throw new Error('esperado calculo')
    expect(outcome.result.version).toBe(FAKE_VERSION)
    expect(outcome.result.scale).toBe(5)
    expect(outcome.result.explanation).toHaveLength(2)
    expect(outcome.result.calculatedAt).toBe(NOW.toISOString())
  })

  it('a decisao PRENDE a versao: outra versao aprovada nao usa a formula registrada', () => {
    const outcome = computeCinerieScore(input, {
      registry,
      decision: approvedDecision({ approvedFormulaVersion: 'cinerie-score/outra-v2' }),
      now: NOW,
    })
    expect(outcome.status).toBe('blocked_by_decision')
    if (outcome.status !== 'blocked_by_decision') throw new Error('esperado bloqueio')
    expect(outcome.reason).toBe('formula-not-registered')
    // A versao reportada e a que a decisao pediu — nao a bloqueada generica:
    // o operador precisa saber QUAL formula falta.
    expect(outcome.version).toBe('cinerie-score/outra-v2')
  })

  it('policyVersion (id JURIDICO) nao seleciona formula (achado A7 da revisao adversarial)', () => {
    // Cenario que motivou a separacao: renovacao legal registra um id de policy
    // que por azar COINCIDE com uma formula registrada. Se o campo juridico
    // selecionasse o algoritmo, isto calcularia em silencio. Com os eixos
    // separados, o que manda e approvedFormulaVersion — e um id juridico nunca
    // troca o algoritmo.
    const outcome = computeCinerieScore(input, {
      registry,
      decision: approvedDecision({ policyVersion: FAKE_VERSION, approvedFormulaVersion: 'nao-registrada/v9' }),
      now: NOW,
    })
    expect(outcome.status).toBe('blocked_by_decision')
    if (outcome.status !== 'blocked_by_decision') throw new Error('esperado bloqueio')
    expect(outcome.reason).toBe('formula-not-registered')
    expect(outcome.version).toBe('nao-registrada/v9')
  })
})

describe('cinerie score — inputsHash', () => {
  it('e estavel: a ordem das notas nao muda o hash', () => {
    const reversed: CinerieScoreInput = { entityId: '1', ratings: [...input.ratings].reverse() }
    expect(computeInputsHash(reversed)).toBe(computeInputsHash(input))
  })

  it('muda quando um valor muda (recalculo vira linha nova no historico)', () => {
    const changed: CinerieScoreInput = {
      entityId: '1',
      ratings: [{ ...input.ratings[0]!, value: 8.5 }, input.ratings[1]!],
    }
    expect(computeInputsHash(changed)).not.toBe(computeInputsHash(input))
  })

  it('muda quando a decisao de licenca da nota muda (mesma nota, outro consentimento)', () => {
    const changed: CinerieScoreInput = {
      entityId: '1',
      ratings: [{ ...input.ratings[0]!, licenseDecisionId: '99' }, input.ratings[1]!],
    }
    expect(computeInputsHash(changed)).not.toBe(computeInputsHash(input))
  })

  it('distingue entidades', () => {
    expect(computeInputsHash({ ...input, entityId: '2' })).not.toBe(computeInputsHash(input))
  })
})

describe('cinerie score — registro', () => {
  it('recusa duas formulas com a mesma versao (ambiguidade de versionamento)', () => {
    expect(() => createFormulaRegistry([fakeFormula, { ...fakeFormula }])).toThrow(/duplicada/)
  })
})
