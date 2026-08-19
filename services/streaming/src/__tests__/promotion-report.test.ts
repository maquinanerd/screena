/**
 * promotion-report.test.ts — Relatorio JSON (`--json`) da revisao e sanitizacao.
 *
 * Trava: `buildReviewJson` NUNCA emite a URL crua do deep link — so o host. Um
 * token/segredo escondido na query do deep link jamais vaza. O `id` da linha e
 * preservado (para promocao/reversao posterior) e a decisao/motivo acompanham
 * cada candidata.
 */

import { describe, expect, it } from 'vitest'

import { PROMOTION_PROVIDER_API } from '../promotion/guardrails.js'
import { buildReviewJson } from '../promotion/report.js'
import { summarize, type EvaluatedCandidate, type ReviewResult } from '../promotion/run.js'
import type { PromotionCandidate } from '../promotion/types.js'

const NOW = new Date('2024-01-01T00:00:00.000Z')

function candidate(overrides: Partial<PromotionCandidate> = {}): PromotionCandidate {
  return {
    id: '42',
    entityType: 'movie',
    entityId: '10',
    title: 'A Origem',
    countryCode: 'BR',
    providerApi: PROMOTION_PROVIDER_API,
    providerKey: 'netflix',
    providerName: 'Netflix',
    canonicalProviderSlug: 'netflix',
    offerType: 'subscription',
    deepLink: 'https://www.netflix.com/title/1?token=SUPER_SECRET_TOKEN_XYZ',
    webUrl: null,
    price: null,
    currency: null,
    quality: 'hd',
    availableUntil: null,
    fetchedAt: NOW,
    displayAllowed: false,
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: 'Disponibilidade fornecida por Movie of the Night',
    attributionUrl: 'https://www.movieofthenight.com/about/api',
    ...overrides,
  }
}

function reviewResult(evaluated: readonly EvaluatedCandidate[]): ReviewResult {
  return {
    kind: 'movie',
    country: 'BR',
    entityId: null,
    evaluated,
    summary: summarize(evaluated),
  }
}

describe('buildReviewJson — sanitizacao', () => {
  it('emite so o host do deep link; a URL crua e o token na query nunca vazam', () => {
    const json = buildReviewJson(
      reviewResult([{ candidate: candidate(), eligible: true, reason: null }]),
    )
    const serialized = JSON.stringify(json)

    expect(json.candidates[0]?.deepLinkHost).toBe('www.netflix.com')
    // Sanitizacao: nem a URL completa, nem o path, nem o segredo da query saem.
    expect(serialized).not.toContain('SUPER_SECRET_TOKEN_XYZ')
    expect(serialized).not.toContain('/title/1')
    expect(serialized).not.toContain('token=')
    // O objeto tampouco expoe um campo `deepLink` cru.
    expect(json.candidates[0]).not.toHaveProperty('deepLink')
  })

  it('preserva o id da linha e anexa a decisao/motivo por candidata', () => {
    const json = buildReviewJson(
      reviewResult([
        { candidate: candidate({ id: '7' }), eligible: true, reason: null },
        {
          candidate: candidate({ id: '8', displayAllowed: true }),
          eligible: false,
          reason: 'already-display-allowed',
        },
      ]),
    )

    expect(json.candidates.map((c) => c.id)).toEqual(['7', '8'])
    expect(json.candidates[0]?.eligible).toBe(true)
    expect(json.candidates[0]?.rejectionReason).toBeNull()
    expect(json.candidates[1]?.eligible).toBe(false)
    expect(json.candidates[1]?.rejectionReason).toBe('already-display-allowed')
    expect(json.summary.found).toBe(2)
    expect(json.summary.eligible).toBe(1)
  })

  it('datas saem em ISO e ausencia vira null (nunca objeto Date cru)', () => {
    const json = buildReviewJson(
      reviewResult([
        {
          candidate: candidate({
            availableUntil: new Date('2024-06-01T00:00:00.000Z'),
            fetchedAt: null,
          }),
          eligible: true,
          reason: null,
        },
      ]),
    )
    expect(json.candidates[0]?.availableUntil).toBe('2024-06-01T00:00:00.000Z')
    expect(json.candidates[0]?.fetchedAt).toBeNull()
  })
})
