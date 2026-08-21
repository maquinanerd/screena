/**
 * seed-cut.test.ts — A conta da semente: quantos passam, e quanto custa.
 */

import { describe, expect, it } from 'vitest'

import {
  ELIGIBILITY_KNEE_RANK,
  evaluationNeededFor,
  MEASURED_ELIGIBILITY_BANDS,
  projectSeedCut,
} from '../discovery/seed-cut.js'

describe('as faixas medidas', () => {
  it('cobrem o ranking inteiro sem buraco e sem sobreposicao', () => {
    for (let i = 1; i < MEASURED_ELIGIBILITY_BANDS.length; i += 1) {
      const anterior = MEASURED_ELIGIBILITY_BANDS[i - 1]!
      const atual = MEASURED_ELIGIBILITY_BANDS[i]!
      expect(atual.from).toBe(anterior.to + 1)
    }
    expect(MEASURED_ELIGIBILITY_BANDS[0]!.from).toBe(1)
    expect(MEASURED_ELIGIBILITY_BANDS.at(-1)!.to).toBe(Number.POSITIVE_INFINITY)
  })

  it('o rendimento so cai — nunca sobe conforme desce o ranking', () => {
    for (let i = 1; i < MEASURED_ELIGIBILITY_BANDS.length; i += 1) {
      expect(MEASURED_ELIGIBILITY_BANDS[i]!.passRate).toBeLessThanOrEqual(
        MEASURED_ELIGIBILITY_BANDS[i - 1]!.passRate,
      )
    }
  })

  it('o joelho declarado e a fronteira onde o rendimento mais cai', () => {
    const quedas = MEASURED_ELIGIBILITY_BANDS.slice(1).map((band, index) => ({
      fronteira: MEASURED_ELIGIBILITY_BANDS[index]!.to,
      queda: MEASURED_ELIGIBILITY_BANDS[index]!.passRate - band.passRate,
    }))
    const maior = quedas.reduce((a, b) => (b.queda > a.queda ? b : a))
    expect(maior.fronteira).toBe(ELIGIBILITY_KNEE_RANK)
  })
})

describe('a projecao', () => {
  it('o top 1.000 rende 880 paginas — a taxa medida, nao uma media', () => {
    const p = projectSeedCut(1_000)
    expect(p.expectedEligible).toBe(880)
    expect(p.requests).toBe(1_000)
  })

  it('ate o joelho (10k) rende 7.720, e custa ~1,3 requisicao por pagina', () => {
    const p = projectSeedCut(ELIGIBILITY_KNEE_RANK)
    // 880 (faixa 1) + 6.840 (76% de 9.000) = 7.720.
    expect(p.expectedEligible).toBe(7_720)
    expect(p.requestsPerEligible).toBeCloseTo(1.295, 2)
  })

  it('descer para 50k mais que DOBRA o custo por pagina — o dado que fecha a decisao', () => {
    const ateOJoelho = projectSeedCut(ELIGIBILITY_KNEE_RANK)
    const ate50k = projectSeedCut(50_000)
    expect(ate50k.expectedEligible).toBeGreaterThan(ateOJoelho.expectedEligible)
    expect(ate50k.requestsPerEligible).toBeGreaterThan(ateOJoelho.requestsPerEligible * 1.8)
  })

  it('quebra a conta por faixa — nunca uma caixa-preta', () => {
    const p = projectSeedCut(50_000)
    expect(p.byBand.map((b) => b.evaluated)).toEqual([1_000, 9_000, 40_000])
    expect(p.byBand.reduce((sum, b) => sum + b.eligible, 0)).toBe(p.expectedEligible)
  })

  it('teto zero devolve zeros e Infinity explicito, nunca NaN', () => {
    const p = projectSeedCut(0)
    expect(p.expectedEligible).toBe(0)
    expect(p.requestsPerEligible).toBe(Number.POSITIVE_INFINITY)
    expect(Number.isNaN(p.requestsPerEligible)).toBe(false)
  })
})

describe('a conta inversa: quanto avaliar para colher N', () => {
  it('10 mil elegiveis exigem avaliar bem mais que 10 mil titulos', () => {
    const necessario = evaluationNeededFor(10_000)
    expect(necessario).not.toBeNull()
    expect(necessario!).toBeGreaterThan(10_000)
    // Confere o resultado pela projecao direta — as duas contas tem que fechar.
    expect(projectSeedCut(necessario!).expectedEligible).toBeGreaterThanOrEqual(10_000)
  })

  it('um alvo que cabe na primeira faixa nao desce o ranking', () => {
    expect(evaluationNeededFor(880)).toBe(1_000)
  })

  it('alvo zero nao avalia nada', () => {
    expect(evaluationNeededFor(0)).toBe(0)
  })

  it('alvo inalcancavel dentro do teto devolve null, nao um numero grande', () => {
    expect(evaluationNeededFor(500_000, 10_000)).toBeNull()
  })

  it('CONTROLE NEGATIVO: uma taxa media unica erraria — por isso a conta e por faixa', () => {
    const mediaIngenua = Math.ceil(10_000 / 0.88)
    const real = evaluationNeededFor(10_000)!
    // A conta ingenua (taxa do topo aplicada a tudo) subestima em milhares.
    expect(real).toBeGreaterThan(mediaIngenua * 1.1)
  })
})
