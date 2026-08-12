/**
 * changes-freshness.test.ts — Sentinela do `/changes` (B-F).
 *
 * O modo de falha alvo: um `/changes` que para de rodar em silencio congela o
 * catalogo sem que nada pareca errado. Os testes travam as tres distincoes que
 * tornam isso visivel: "nunca rodou" != "sem mudancas"; "atrasado" dispara
 * alarme; "delta zero" e suspeito, nao sucesso.
 */

import { describe, expect, it } from 'vitest'

import {
  assessAllFreshness,
  assessFreshness,
  DEFAULT_FRESHNESS_POLICY,
  FRESHNESS_KINDS,
  renderFreshnessVerdict,
  type FreshnessCheckpoint,
} from '../changes/freshness.js'

const NOW = new Date('2026-08-11T12:00:00.000Z')
const HOUR = 60 * 60 * 1000

function checkpoint(over: Partial<FreshnessCheckpoint> = {}): FreshnessCheckpoint {
  return {
    kind: 'movie',
    lastSuccessAt: new Date(NOW.getTime() - 2 * HOUR),
    lastDeltaCount: 1_200,
    ...over,
  }
}

describe('assessFreshness', () => {
  it('recente e com delta plausivel e fresh', () => {
    expect(assessFreshness(checkpoint(), NOW).state).toBe('fresh')
  })

  it('NUNCA RODOU nao e o mesmo que "sem mudancas"', () => {
    const assessment = assessFreshness(checkpoint({ lastSuccessAt: null }), NOW)
    expect(assessment.state).toBe('never_ran')
    expect(assessment.ageMs).toBeNull()
    expect(assessment.detail).toContain('NAO')
  })

  it('acima do intervalo + folga vira stale', () => {
    // Politica default: 24 h + 6 h de folga = 30 h.
    const assessment = assessFreshness(
      checkpoint({ lastSuccessAt: new Date(NOW.getTime() - 31 * HOUR) }),
      NOW,
    )
    expect(assessment.state).toBe('stale')
    expect(assessment.detail).toContain('congelando')
  })

  it('dentro da folga AINDA e fresh: alarme que toca a toa deixa de ser lido', () => {
    const assessment = assessFreshness(
      checkpoint({ lastSuccessAt: new Date(NOW.getTime() - 29 * HOUR) }),
      NOW,
    )
    expect(assessment.state).toBe('fresh')
  })

  it('delta ZERO e SUSPEITO, nunca sucesso', () => {
    const assessment = assessFreshness(checkpoint({ lastDeltaCount: 0 }), NOW)
    expect(assessment.state).toBe('suspicious_zero_delta')
    expect(assessment.detail).toContain('suspeito')
  })

  it('atraso PREVALECE sobre delta zero: o problema maior aparece primeiro', () => {
    const assessment = assessFreshness(
      checkpoint({ lastSuccessAt: new Date(NOW.getTime() - 48 * HOUR), lastDeltaCount: 0 }),
      NOW,
    )
    expect(assessment.state).toBe('stale')
  })

  it('a politica e configuravel sem tocar a logica', () => {
    const hourly = { expectedIntervalMs: HOUR, graceMs: 0, minPlausibleDelta: 1 }
    const assessment = assessFreshness(
      checkpoint({ lastSuccessAt: new Date(NOW.getTime() - 2 * HOUR) }),
      NOW,
      hourly,
    )
    expect(assessment.state).toBe('stale')
  })

  it('a politica default e diaria com 6 h de folga', () => {
    expect(DEFAULT_FRESHNESS_POLICY.expectedIntervalMs).toBe(24 * HOUR)
    expect(DEFAULT_FRESHNESS_POLICY.graceMs).toBe(6 * HOUR)
    expect(DEFAULT_FRESHNESS_POLICY.minPlausibleDelta).toBe(1)
  })
})

describe('assessAllFreshness', () => {
  it('tipo AUSENTE da entrada entra como never_ran, nunca some do relatorio', () => {
    // Este e o ponto: omitir o tipo o faria parecer saudavel por ausencia.
    const verdict = assessAllFreshness([checkpoint({ kind: 'movie' })], NOW)
    expect(verdict.assessments.map((a) => a.kind)).toEqual([...FRESHNESS_KINDS])
    expect(verdict.assessments.find((a) => a.kind === 'tv')?.state).toBe('never_ran')
    expect(verdict.assessments.find((a) => a.kind === 'person')?.state).toBe('never_ran')
    expect(verdict.alarm).toBe(true)
  })

  it('todos frescos: sem alarme e sem suspeita', () => {
    const verdict = assessAllFreshness(
      FRESHNESS_KINDS.map((kind) => checkpoint({ kind })),
      NOW,
    )
    expect(verdict.alarm).toBe(false)
    expect(verdict.suspicious).toBe(false)
  })

  it('delta zero levanta SUSPEITA sem levantar alarme', () => {
    const verdict = assessAllFreshness(
      FRESHNESS_KINDS.map((kind) => checkpoint({ kind, lastDeltaCount: kind === 'tv' ? 0 : 900 })),
      NOW,
    )
    expect(verdict.suspicious).toBe(true)
    expect(verdict.alarm).toBe(false)
  })

  it('entrada VAZIA e alarme, nunca silencio', () => {
    const verdict = assessAllFreshness([], NOW)
    expect(verdict.alarm).toBe(true)
    expect(verdict.assessments).toHaveLength(FRESHNESS_KINDS.length)
  })

  it('o relatorio lista TODOS os tipos, inclusive os frescos', () => {
    const rendered = renderFreshnessVerdict(
      assessAllFreshness(
        FRESHNESS_KINDS.map((kind) => checkpoint({ kind })),
        NOW,
      ),
    )
    for (const kind of FRESHNESS_KINDS) expect(rendered).toContain(kind)
  })
})
