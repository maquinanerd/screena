/**
 * promotion-guardrails.test.ts — Cada motivo de recusa da promocao de ratings.
 *
 * A candidata `valid` abaixo e o caso de referencia: ela SOBE. Todo teste muda
 * exatamente UM campo e prova que aquele campo sozinho a derruba — assim um
 * guardrail que pare de funcionar nao fica escondido atras de outro.
 */

import { describe, expect, it } from 'vitest'

import { evaluateRatingPromotionEligibility, evaluateRatingRevocationEligibility } from '../promotion/guardrails.js'
import type { RatingPromotionCandidate } from '../promotion/types.js'

const NOW = new Date('2026-07-17T12:00:00.000Z')
/** 2 dias antes de NOW: dentro da janela de refresh do imdb (168h). */
const FRESH = new Date('2026-07-15T12:00:00.000Z')

const valid: RatingPromotionCandidate = {
  id: '1',
  entityType: 'movie',
  entityId: '10',
  title: 'Filme',
  ratingSource: 'imdb',
  ratingLabel: 'IMDb Rating',
  metric: 'user_rating',
  scoreType: 'audience',
  ratingValue: 8.4,
  ratingScale: 10,
  ratingCount: 12000,
  ratingUrl: 'https://www.imdb.com/title/tt1/',
  providerApi: 'imdb236',
  licenseStatus: 'licensed',
  requiresAttribution: true,
  requiresLinkback: true,
  attributionText: 'Nota fornecida por IMDb',
  attributionUrl: 'https://www.imdb.com/title/tt1/',
  fetchedAt: FRESH,
  displayAllowed: false,
  usageDecisionId: '77',
}

const evaluate = (overrides: Partial<RatingPromotionCandidate> = {}) =>
  evaluateRatingPromotionEligibility({ ...valid, ...overrides }, { now: NOW })

describe('promocao de rating — o caso de referencia sobe', () => {
  it('nota integra + licenciada + com decisao + fresca => elegivel', () => {
    const result = evaluate()
    expect(result.eligible).toBe(true)
    expect(result.reason).toBeNull()
  })
})

describe('promocao de rating — integridade (invariantes 1 e 2) vem antes de governanca', () => {
  it('provider_api igual a rating_source => provider-is-source', () => {
    expect(evaluate({ providerApi: 'imdb' }).reason).toBe('provider-is-source')
  })

  it('provider_api que E o id de OUTRA fonte editorial => provider-is-source', () => {
    // RapidAPI transportando Metacritic nao vira "metacritic". O fornecedor
    // tecnico nunca usa identificador de fonte editorial.
    expect(evaluate({ providerApi: 'metacritic' }).reason).toBe('provider-is-source')
  })

  it('provider_api ausente => provider-is-source', () => {
    expect(evaluate({ providerApi: null }).reason).toBe('provider-is-source')
  })

  it('escala != escala canonica da fonte => scale-mismatch', () => {
    expect(evaluate({ ratingScale: 100 }).reason).toBe('scale-mismatch')
  })

  it('Tomatometer atribuido ao IMDb => cross-label', () => {
    expect(evaluate({ ratingLabel: 'Tomatometer' }).reason).toBe('cross-label')
  })

  it('rotulo IMDb numa nota do Metacritic => cross-label', () => {
    const result = evaluateRatingPromotionEligibility(
      { ...valid, ratingSource: 'metacritic', ratingScale: 100, ratingValue: 78, ratingLabel: 'IMDb Rating' },
      { now: NOW },
    )
    expect(result.reason).toBe('cross-label')
  })

  it('valor fora da escala => invalid-value', () => {
    expect(evaluate({ ratingValue: 11 }).reason).toBe('invalid-value')
    expect(evaluate({ ratingValue: -1 }).reason).toBe('invalid-value')
    expect(evaluate({ ratingValue: null }).reason).toBe('invalid-value')
  })

  it('score_type nao classificado => unclassified-score-type', () => {
    expect(evaluate({ scoreType: null }).reason).toBe('unclassified-score-type')
  })

  it('integridade tem PRECEDENCIA sobre licenca: nota errada nao vira caca a licenca', () => {
    // Escala errada E licenca desconhecida ao mesmo tempo. Reportar
    // "license-not-displayable" mandaria o operador atras da licenca de um dado
    // que nunca deveria existir.
    expect(evaluate({ ratingScale: 100, licenseStatus: 'unknown' }).reason).toBe('scale-mismatch')
  })
})

describe('promocao de rating — governanca (invariante 6)', () => {
  it.each(['unknown', 'blocked'])('license_status "%s" => license-not-displayable', (licenseStatus) => {
    expect(evaluate({ licenseStatus }).reason).toBe('license-not-displayable')
  })

  it.each(['official', 'licensed', 'third_party'])('license_status "%s" permite exibir', (licenseStatus) => {
    expect(evaluate({ licenseStatus }).eligible).toBe(true)
  })

  it('atribuicao exigida e ausente => missing-attribution', () => {
    expect(evaluate({ attributionText: null }).reason).toBe('missing-attribution')
    expect(evaluate({ attributionText: '   ' }).reason).toBe('missing-attribution')
  })

  it('linkback exigido e ausente => missing-linkback', () => {
    expect(evaluate({ attributionUrl: null }).reason).toBe('missing-linkback')
  })

  it('atribuicao NAO exigida dispensa o texto', () => {
    expect(
      evaluate({ requiresAttribution: false, requiresLinkback: false, attributionText: null, attributionUrl: null })
        .eligible,
    ).toBe(true)
  })

  it('attribution_url nao-HTTPS => unsafe-attribution-url', () => {
    expect(evaluate({ attributionUrl: 'http://imdb.com/x' }).reason).toBe('unsafe-attribution-url')
  })

  it('sem DataUsageDecision vigente => no-usage-decision', () => {
    expect(evaluate({ usageDecisionId: null }).reason).toBe('no-usage-decision')
  })
})

describe('promocao de rating — frescor', () => {
  it('sem fetched_at => unknown-fetch', () => {
    expect(evaluate({ fetchedAt: null }).reason).toBe('unknown-fetch')
  })

  it('fonte sem politica de frescor => unknown-stale-policy', () => {
    const result = evaluateRatingPromotionEligibility(
      { ...valid, ratingSource: 'letterboxd', ratingScale: 5, ratingValue: 4.2, ratingLabel: 'Letterboxd' },
      { now: NOW },
    )
    expect(result.reason).toBe('unknown-stale-policy')
  })

  it('nota alem da janela de expiracao => expired', () => {
    // imdb expira em 720h; 800h atras esta fora.
    const old = new Date(NOW.getTime() - 800 * 60 * 60 * 1000)
    expect(evaluate({ fetchedAt: old }).reason).toBe('expired')
  })

  it('nota em needs_refresh AINDA sobe (vale reconferir != invalida)', () => {
    const stale = new Date(NOW.getTime() - 300 * 60 * 60 * 1000)
    expect(evaluate({ fetchedAt: stale }).eligible).toBe(true)
  })
})

describe('promocao de rating — estado', () => {
  it('nota ja exibivel => already-display-allowed', () => {
    expect(evaluate({ displayAllowed: true }).reason).toBe('already-display-allowed')
  })
})

describe('revogacao de rating', () => {
  it('nota exibivel pode ser revogada', () => {
    expect(evaluateRatingRevocationEligibility({ ...valid, displayAllowed: true }).eligible).toBe(true)
  })

  it('nota ja oculta => already-disallowed', () => {
    const result = evaluateRatingRevocationEligibility(valid)
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('already-disallowed')
  })
})
