/**
 * report.test.ts — Relatorio do worker de ratings.
 *
 * O relatorio e um DTO de primitivos (sem BigInt, sem segredo, sem payload cru):
 * serializavel por JSON sem replacer. Deixa explicito que toda linha nasce
 * display_allowed=false e que `screen_score` nao e tocado por este worker.
 */

import { describe, it, expect } from 'vitest'

import {
  groupRejections,
  buildRatingsReport,
  serializeRatingsReportJson,
  renderRatingsReport,
  runMode,
} from '../film-show-ratings/report.js'
import type { RatingRejection } from '../film-show-ratings/types.js'
import type { RatingsRunResult } from '../film-show-ratings/run.js'

/** Resultado de run com um BigInt embutido no rawPayload (que o DTO deve descartar). */
function makeResult(): RatingsRunResult {
  return {
    status: 'partial',
    endpoint: '/popular/',
    touchedNetwork: true,
    recognized: true,
    payloadHash: 'abc123',
    // BigInt de proposito: prova que o DTO nunca carrega o payload cru.
    rawPayload: { big: BigInt(10) },
    counters: {
      itemsSeen: 3,
      ratingsRecognized: 2,
      ratingsWritten: 1,
      ratingsCreated: 1,
      ratingsUpdated: 0,
      ratingsUnchanged: 1,
    },
    rejections: [
      { reason: 'no-entity-id', detail: 'item 0 sem id' },
      { reason: 'no-entity-id', detail: 'item 2 sem id' },
      { reason: 'missing-metric', detail: 'sem metric' },
    ],
    durationMs: 5,
    quotaCost: 1,
    errorCode: null,
  }
}

describe('groupRejections', () => {
  it('agrupa por motivo preservando a ordem de primeira aparicao e conta certo', () => {
    const rejections: RatingRejection[] = [
      { reason: 'no-entity-id', detail: 'a' },
      { reason: 'missing-metric', detail: 'b' },
      { reason: 'no-entity-id', detail: 'c' },
    ]
    const grouped = groupRejections(rejections)
    expect(grouped).toEqual([
      { reason: 'no-entity-id', count: 2, sample: 'a' },
      { reason: 'missing-metric', count: 1, sample: 'b' },
    ])
  })

  it('lista vazia -> agrupamento vazio', () => {
    expect(groupRejections([])).toEqual([])
  })
})

describe('buildRatingsReport / serializeRatingsReportJson', () => {
  it('produz apenas primitivos serializaveis: JSON.stringify nao lanca (sem BigInt)', () => {
    const result = makeResult()

    // O run result cru carrega BigInt no rawPayload -> stringify dele lanca.
    expect(() => JSON.stringify(result)).toThrow()

    const report = buildRatingsReport(result, {
      apply: false,
      sample: true,
      providerApi: 'rapidapi_film_show_ratings',
    })

    // O DTO nao inclui rawPayload -> serializa sem replacer.
    expect(() => JSON.stringify(report)).not.toThrow()
    const json = serializeRatingsReportJson(report)
    expect(() => JSON.parse(json)).not.toThrow()

    // Todos os campos numericos sao number (nunca BigInt).
    for (const value of Object.values(report.counters)) {
      expect(typeof value).toBe('number')
    }
    expect(report.mode).toBe('sample')
    expect(report.provider_api).toBe('rapidapi_film_show_ratings')
    expect(report.status).toBe('partial')
    // Recusas agrupadas com contagem correta.
    expect(report.rejections).toEqual([
      { reason: 'no-entity-id', count: 2, sample: 'item 0 sem id' },
      { reason: 'missing-metric', count: 1, sample: 'sem metric' },
    ])
  })
})

describe('renderRatingsReport', () => {
  it('menciona display_allowed=false e que screen_score NAO e tocado', () => {
    const report = buildRatingsReport(makeResult(), {
      apply: true,
      sample: false,
      providerApi: 'rapidapi_film_show_ratings',
    })
    const markdown = renderRatingsReport(report)
    expect(markdown).toContain('display_allowed=false')
    expect(markdown).toContain('screen_score')
    expect(markdown).toContain('NAO e tocado')
  })
})

describe('runMode', () => {
  it('retorna apply | sample | dry-run, com apply vencendo sample', () => {
    expect(runMode({ apply: true, sample: true })).toBe('apply')
    expect(runMode({ apply: true, sample: false })).toBe('apply')
    expect(runMode({ apply: false, sample: true })).toBe('sample')
    expect(runMode({ apply: false, sample: false })).toBe('dry-run')
  })
})
