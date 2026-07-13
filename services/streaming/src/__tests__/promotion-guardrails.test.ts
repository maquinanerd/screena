/**
 * promotion-guardrails.test.ts — Guardrails da promocao de `watch_availability`.
 *
 * Trava: so `streaming_availability`+BR promove; oferta ja exibivel, modalidade
 * invalida (ads/cinema/addon), provider incompleto, sem link, link inseguro e
 * oferta vencida NUNCA promovem; a reversao so mexe no proprio provider.
 */

import { describe, expect, it } from 'vitest'

import {
  deepLinkHost,
  evaluatePromotionEligibility,
  evaluateRevocationEligibility,
  PROMOTION_COUNTRY,
  PROMOTION_PROVIDER_API,
} from '../promotion/guardrails.js'
import type { PromotionCandidate } from '../promotion/types.js'

const NOW = new Date('2024-01-01T00:00:00.000Z')

/** Uma candidata VALIDA de referencia (subscription Netflix, link https, BR). */
function validCandidate(overrides: Partial<PromotionCandidate> = {}): PromotionCandidate {
  return {
    id: '1',
    entityType: 'movie',
    entityId: '10',
    title: 'A Origem',
    countryCode: 'BR',
    providerApi: PROMOTION_PROVIDER_API,
    providerKey: 'netflix',
    providerName: 'Netflix',
    offerType: 'subscription',
    deepLink: 'https://www.netflix.com/title/1',
    price: null,
    currency: null,
    quality: 'hd',
    availableUntil: null,
    fetchedAt: NOW,
    displayAllowed: false,
    ...overrides,
  }
}

function reasonOf(overrides: Partial<PromotionCandidate>): string | null {
  return evaluatePromotionEligibility(validCandidate(overrides), { now: NOW }).reason
}

describe('evaluatePromotionEligibility — caso valido', () => {
  it('a candidata de referencia e elegivel', () => {
    const result = evaluatePromotionEligibility(validCandidate(), { now: NOW })
    expect(result.eligible).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('PROMOTION_PROVIDER_API e streaming_availability e o pais e BR', () => {
    expect(PROMOTION_PROVIDER_API).toBe('streaming_availability')
    expect(PROMOTION_COUNTRY).toBe('BR')
  })
})

describe('evaluatePromotionEligibility — recusas', () => {
  it('provider diferente -> wrong-provider (nunca tocamos outro fornecedor)', () => {
    expect(reasonOf({ providerApi: 'tmdb' })).toBe('wrong-provider')
    expect(reasonOf({ providerApi: null })).toBe('wrong-provider')
    expect(reasonOf({ providerApi: 'justwatch_demo' })).toBe('wrong-provider')
  })

  it('pais diferente de BR -> wrong-country', () => {
    expect(reasonOf({ countryCode: 'US' })).toBe('wrong-country')
    expect(reasonOf({ countryCode: 'PT' })).toBe('wrong-country')
  })

  it('ja exibivel -> already-display-allowed', () => {
    expect(reasonOf({ displayAllowed: true })).toBe('already-display-allowed')
  })

  it('modalidade fora de {subscription,free,rent,buy} -> invalid-offer-type', () => {
    expect(reasonOf({ offerType: 'ads' })).toBe('invalid-offer-type')
    expect(reasonOf({ offerType: 'cinema' })).toBe('invalid-offer-type')
    expect(reasonOf({ offerType: 'addon' })).toBe('invalid-offer-type')
    expect(reasonOf({ offerType: null })).toBe('invalid-offer-type')
    expect(reasonOf({ offerType: 'qualquer' })).toBe('invalid-offer-type')
  })

  it('as quatro modalidades legais sao aceitas', () => {
    for (const offerType of ['subscription', 'free', 'rent', 'buy'] as const) {
      expect(evaluatePromotionEligibility(validCandidate({ offerType }), { now: NOW }).eligible).toBe(true)
    }
  })

  it('sem provider_key OU sem provider_name -> missing-provider', () => {
    expect(reasonOf({ providerKey: null })).toBe('missing-provider')
    expect(reasonOf({ providerKey: '   ' })).toBe('missing-provider')
    expect(reasonOf({ providerName: '' })).toBe('missing-provider')
  })

  it('sem deep_link -> missing-link', () => {
    expect(reasonOf({ deepLink: null })).toBe('missing-link')
    expect(reasonOf({ deepLink: '   ' })).toBe('missing-link')
  })

  it('deep_link inseguro (nao-http / pirataria) -> unsafe-link', () => {
    expect(reasonOf({ deepLink: 'magnet:?xt=urn:btih:abcdef' })).toBe('unsafe-link')
    expect(reasonOf({ deepLink: 'ftp://host/x' })).toBe('unsafe-link')
    expect(reasonOf({ deepLink: 'https://host/movie.torrent' })).toBe('unsafe-link')
  })

  it('oferta vencida -> expired (available_until no passado ou igual a now)', () => {
    expect(reasonOf({ availableUntil: new Date('2023-12-31T23:59:59.000Z') })).toBe('expired')
    expect(reasonOf({ availableUntil: NOW })).toBe('expired')
  })

  it('available_until no futuro NAO vence', () => {
    expect(
      evaluatePromotionEligibility(validCandidate({ availableUntil: new Date('2024-06-01T00:00:00.000Z') }), {
        now: NOW,
      }).eligible,
    ).toBe(true)
  })
})

describe('evaluatePromotionEligibility — precedencia', () => {
  it('wrong-provider vence os demais motivos (mais fundamental)', () => {
    expect(
      reasonOf({ providerApi: 'tmdb', countryCode: 'US', offerType: 'ads', deepLink: null }),
    ).toBe('wrong-provider')
  })

  it('wrong-country vence estado/modalidade quando o provider e valido', () => {
    expect(reasonOf({ countryCode: 'US', offerType: 'ads', displayAllowed: true })).toBe('wrong-country')
  })
})

describe('evaluateRevocationEligibility', () => {
  it('revoga uma oferta do proprio provider que esta exibivel', () => {
    const result = evaluateRevocationEligibility(validCandidate({ displayAllowed: true }))
    expect(result.eligible).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('outro provider -> wrong-provider (nunca reverte fora do escopo)', () => {
    const result = evaluateRevocationEligibility(validCandidate({ providerApi: 'tmdb', displayAllowed: true }))
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('wrong-provider')
  })

  it('ja nao-exibivel -> already-disallowed (nada a reverter)', () => {
    const result = evaluateRevocationEligibility(validCandidate({ displayAllowed: false }))
    expect(result.reason).toBe('already-disallowed')
  })
})

describe('deepLinkHost — nunca despeja a URL inteira', () => {
  it('extrai so o host', () => {
    expect(deepLinkHost('https://www.netflix.com/title/1?x=1')).toBe('www.netflix.com')
  })

  it('rotula ausencia e link invalido', () => {
    expect(deepLinkHost(null)).toBe('(sem link)')
    expect(deepLinkHost('   ')).toBe('(sem link)')
    expect(deepLinkHost('nao e url')).toBe('(link invalido)')
  })
})
