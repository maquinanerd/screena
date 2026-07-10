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
  buildItemRatingsReport,
  serializeRatingsReportJson,
  renderRatingsReport,
  runMode,
} from '../film-show-ratings/report.js'
import type { RatingRejection } from '../film-show-ratings/types.js'
import type { RatingsItemRunResult, RatingsRunResult } from '../film-show-ratings/run.js'

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

/** Resultado de item enrichment com 1 id, 1 sem entidade, 1 falha. */
function makeItemResult(): RatingsItemRunResult {
  return {
    status: 'partial',
    endpoint: '/item/',
    touchedNetwork: true,
    idsQueried: 2,
    idsFailed: 1,
    idsWithoutEntity: 1,
    items: [
      {
        id: 'tt9603208',
        entityType: 'movie',
        ok: true,
        recognized: true,
        payloadHash: 'abc123',
        rawPayload: { big: BigInt(10) },
        ratingsRecognized: 6,
        ratingsWritten: 0,
        ratingsCreated: 0,
        ratingsUpdated: 0,
        ratingsUnchanged: 0,
        entityResolved: false,
        rejections: [{ reason: 'entity-not-found', detail: 'id tt9603208: sem entidade' }],
        errorCode: null,
      },
      {
        id: 'tt1',
        entityType: 'movie',
        ok: false,
        recognized: false,
        payloadHash: null,
        rawPayload: null,
        ratingsRecognized: 0,
        ratingsWritten: 0,
        ratingsCreated: 0,
        ratingsUpdated: 0,
        ratingsUnchanged: 0,
        entityResolved: false,
        rejections: [{ reason: 'item-fetch-failed', detail: 'id tt1: falha' }],
        errorCode: 'Error',
      },
    ],
    counters: {
      itemsSeen: 2,
      ratingsRecognized: 6,
      ratingsWritten: 0,
      ratingsCreated: 0,
      ratingsUpdated: 0,
      ratingsUnchanged: 0,
    },
    rejections: [
      { reason: 'entity-not-found', detail: 'id tt9603208: sem entidade' },
      { reason: 'item-fetch-failed', detail: 'id tt1: falha' },
    ],
    durationMs: 12,
    quotaCost: 2,
    errorCode: null,
  }
}

describe('buildItemRatingsReport', () => {
  it('reporta endpoint /item/, ids consultados/falhos/sem-entidade e serializa sem BigInt', () => {
    const report = buildItemRatingsReport(makeItemResult(), {
      apply: true,
      sample: false,
      providerApi: 'rapidapi_film_show_ratings',
    })
    expect(report.endpoint).toBe('/item/')
    expect(report.ids_queried).toBe(2)
    expect(report.ids_failed).toBe(1)
    expect(report.ids_without_entity).toBe(1)
    // Nao serializa o rawPayload (que carrega BigInt): DTO puro.
    expect(() => JSON.stringify(report)).not.toThrow()

    // Multiplos ids -> payload_hash agregado e null; ha falha -> nao "reconhecido".
    expect(report.payload_hash).toBeNull()
    expect(report.payload_recognized).toBe(false)

    const markdown = renderRatingsReport(report)
    expect(markdown).toContain('ids consultados')
    expect(markdown).toContain('ids sem entidade local')
  })

  it('um unico id reconhecido -> payload_hash agregado do id e payload_recognized=true', () => {
    const single: RatingsItemRunResult = {
      ...makeItemResult(),
      idsQueried: 1,
      idsFailed: 0,
      idsWithoutEntity: 0,
      items: [
        {
          id: 'tt9603208',
          entityType: 'movie',
          ok: true,
          recognized: true,
          payloadHash: 'deadbeef',
          rawPayload: null,
          ratingsRecognized: 6,
          ratingsWritten: 6,
          ratingsCreated: 6,
          ratingsUpdated: 0,
          ratingsUnchanged: 0,
          entityResolved: true,
          rejections: [],
          errorCode: null,
        },
      ],
      rejections: [],
      status: 'success',
    }
    const report = buildItemRatingsReport(single, {
      apply: true,
      sample: false,
      providerApi: 'rapidapi_film_show_ratings',
    })
    expect(report.payload_hash).toBe('deadbeef')
    expect(report.payload_recognized).toBe(true)
  })
})
