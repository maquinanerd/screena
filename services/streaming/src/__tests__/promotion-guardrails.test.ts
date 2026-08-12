/**
 * promotion-guardrails.test.ts — Guardrails da promocao de `watch_availability`.
 *
 * Trava: so fornecedor GOVERNADO (`streaming_availability` ou `tmdb`) + BR
 * promove; oferta ja exibivel, modalidade invalida (ads/cinema/addon), provider
 * incompleto, sem destino, destino inseguro, SEM CREDITO e oferta vencida NUNCA
 * promovem; a reversao so mexe em fornecedor governado.
 */

import { describe, expect, it } from 'vitest'

import {
  deepLinkHost,
  evaluatePromotionEligibility,
  evaluateRevocationEligibility,
  PROMOTION_COUNTRY,
  PROMOTION_PROVIDER_API,
  PROMOTION_PROVIDER_APIS,
  promotionDestination,
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
    webUrl: null,
    price: null,
    currency: null,
    quality: 'hd',
    availableUntil: null,
    fetchedAt: NOW,
    displayAllowed: false,
    // Credito JA hidratado: e requisito de exibicao, nao enfeite. Uma fixture
    // sem isto descreveria um estado que a licenca nao autoriza — e faria os
    // testes negativos passarem pelo motivo errado.
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: 'Disponibilidade fornecida por Movie of the Night',
    attributionUrl: 'https://www.movieofthenight.com/about/api',
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

  it('o conjunto GOVERNADO tem exatamente as duas origens conhecidas', () => {
    // Ampliar o conjunto e uma decisao; ampliar por acidente e um vazamento.
    expect([...PROMOTION_PROVIDER_APIS].sort()).toEqual(['streaming_availability', 'tmdb'])
  })
})

describe('evaluatePromotionEligibility — recusas', () => {
  it('provider NAO GOVERNADO -> wrong-provider', () => {
    expect(reasonOf({ providerApi: null })).toBe('wrong-provider')
    expect(reasonOf({ providerApi: 'justwatch_demo' })).toBe('wrong-provider')
    expect(reasonOf({ providerApi: 'omdb' })).toBe('wrong-provider')
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
    // `omdb` e fornecedor de RATINGS, nunca de streaming — segue fora do escopo.
    // (`tmdb` deixou de servir de exemplo aqui: virou origem governada.)
    expect(
      reasonOf({ providerApi: 'omdb', countryCode: 'US', offerType: 'ads', deepLink: null }),
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

  it('provider NAO GOVERNADO -> wrong-provider (nunca reverte fora do escopo)', () => {
    const result = evaluateRevocationEligibility(validCandidate({ providerApi: 'omdb', displayAllowed: true }))
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

/**
 * A ORIGEM TMDB/JUSTWATCH NA CLI DE PROMOCAO.
 *
 * Ampliar o conjunto autorizado nao pode virar afrouxamento: a oferta TMDB passa
 * pelos MESMOS oito guardrails. O que muda e so o formato do destino — o TMDB
 * publica um link por PAIS (`web_url`), nunca um deep link por oferta.
 */
describe('origem tmdb: mesmas garantias, destino diferente', () => {
  /** Oferta TMDB de referencia: provider_key numerico, sem deep link. */
  function tmdbCandidate(overrides: Partial<PromotionCandidate> = {}): PromotionCandidate {
    return validCandidate({
      providerApi: 'tmdb',
      providerKey: '8',
      deepLink: null,
      webUrl: 'https://www.themoviedb.org/movie/550/watch?locale=BR',
      attributionText: 'Disponibilidade fornecida por JustWatch',
      attributionUrl: 'https://www.justwatch.com/',
      ...overrides,
    })
  }

  it('CONTROLE POSITIVO: a candidata TMDB de referencia e ELEGIVEL', () => {
    const result = evaluatePromotionEligibility(tmdbCandidate(), { now: NOW })
    expect(result.reason).toBeNull()
    expect(result.eligible).toBe(true)
  })

  it('sem deep_link mas COM web_url o destino existe (nao e missing-link)', () => {
    expect(promotionDestination(tmdbCandidate())).toBe(
      'https://www.themoviedb.org/movie/550/watch?locale=BR',
    )
  })

  it('sem NENHUM destino -> missing-link', () => {
    const result = evaluatePromotionEligibility(
      tmdbCandidate({ webUrl: null }),
      { now: NOW },
    )
    expect(result.reason).toBe('missing-link')
  })

  it('web_url inseguro -> unsafe-link (pirataria nunca passa por ser de outra origem)', () => {
    expect(
      evaluatePromotionEligibility(tmdbCandidate({ webUrl: 'magnet:?xt=urn:btih:abc' }), { now: NOW })
        .reason,
    ).toBe('unsafe-link')
    expect(
      evaluatePromotionEligibility(tmdbCandidate({ webUrl: 'https://h/x.torrent' }), { now: NOW })
        .reason,
    ).toBe('unsafe-link')
  })

  it('TERCEIRO NEGATIVO: oferta TMDB SEM credito de JustWatch NAO promove', () => {
    expect(
      evaluatePromotionEligibility(tmdbCandidate({ attributionText: null }), { now: NOW }).reason,
    ).toBe('missing-attribution')
    expect(
      evaluatePromotionEligibility(tmdbCandidate({ attributionText: '  ' }), { now: NOW }).reason,
    ).toBe('missing-attribution')
    expect(
      evaluatePromotionEligibility(tmdbCandidate({ attributionUrl: null }), { now: NOW }).reason,
    ).toBe('missing-attribution')
  })

  it('modalidade e pais continuam valendo igual para a origem TMDB', () => {
    expect(evaluatePromotionEligibility(tmdbCandidate({ offerType: 'ads' }), { now: NOW }).reason).toBe(
      'invalid-offer-type',
    )
    expect(evaluatePromotionEligibility(tmdbCandidate({ countryCode: 'US' }), { now: NOW }).reason).toBe(
      'wrong-country',
    )
  })

  it('reversao aceita a origem TMDB (nao ha oferta que so entra e nunca sai)', () => {
    const result = evaluateRevocationEligibility(tmdbCandidate({ displayAllowed: true }))
    expect(result.eligible).toBe(true)
  })
})

describe('credito e requisito para TODA origem (nao so a nova)', () => {
  it('oferta do agregador sem atribuicao tambem e recusada', () => {
    expect(reasonOf({ attributionText: null })).toBe('missing-attribution')
    expect(reasonOf({ attributionUrl: null })).toBe('missing-attribution')
  })

  it('licenca que DISPENSA o requisito nao e barrada por ele', () => {
    // `requires_*` = false significa "a licenca nao exige", nao "ignore o gate".
    const result = evaluatePromotionEligibility(
      validCandidate({
        requiresAttribution: false,
        requiresLinkback: false,
        attributionText: null,
        attributionUrl: null,
      }),
      { now: NOW },
    )
    expect(result.eligible).toBe(true)
  })
})
