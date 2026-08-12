/**
 * watch-providers-normalizer.test.ts — Contrato do reconhecedor de
 * `watch/providers` (B-A).
 *
 * O eixo destes testes NAO e "o caminho feliz funciona": e que NENHUM caminho
 * de falha devolve lista vazia em silencio. Este projeto ja foi mordido cinco
 * vezes pelo mesmo padrao (entityCard sumindo, capa recusada com `return`,
 * secao se escondendo, gate emudecendo, `promote` devolvendo `updated: 0`).
 * Por isso ha um teste POR motivo de recusa, cada um provando que o motivo
 * aparece em `rejections` — e a distincao entre "nao ha oferta" (`recognized:
 * true`, lista vazia) e "nao da para saber" (`recognized: false`), que tem
 * consequencias opostas no replace.
 */

import { describe, expect, it } from 'vitest'

import {
  isSafeWatchLink,
  normalizeWatchProviders,
  WATCH_OFFER_TYPE_BY_TMDB_BUCKET,
} from '../normalizers/watch-providers.js'
import { WATCH_PROVIDERS_MOVIE_PAYLOAD } from './fixtures/watch-providers-payload.js'

/** Todos os motivos presentes no resultado, para assercao legivel. */
function reasons(result: { rejections: readonly { reason: string }[] }): string[] {
  return result.rejections.map((r) => r.reason)
}

describe('normalizeWatchProviders — payload reconhecido', () => {
  const result = normalizeWatchProviders('movie', 550, WATCH_PROVIDERS_MOVIE_PAYLOAD)

  it('reconhece o payload e extrai os paises em ordem, deduplicados', () => {
    expect(result.recognized).toBe(true)
    expect(result.countries).toEqual(['BR', 'US'])
  })

  it('mapeia flatrate para subscription (nunca o rotulo cru do TMDB)', () => {
    const subscription = result.offers.filter((o) => o.offerType === 'subscription')
    expect(subscription).toHaveLength(2)
    expect(subscription.map((o) => o.providerName).sort()).toEqual(['Max', 'Netflix'])
    // O rotulo do upstream nunca vaza para o nosso enum.
    expect(result.offers.some((o) => (o.offerType as string) === 'flatrate')).toBe(false)
  })

  it('mapeia rent, buy, free e ads 1:1', () => {
    const byType = new Map(result.offers.map((o) => [`${o.countryCode}:${o.offerType}`, o]))
    expect(byType.get('BR:rent')?.providerName).toBe('Apple TV')
    expect(byType.get('BR:buy')?.providerName).toBe('Apple TV')
    expect(byType.get('BR:free')?.providerName).toBe('Pluto TV')
    expect(byType.get('BR:ads')?.providerName).toBe('Pluto TV')
  })

  it('usa provider_id como chave TECNICA e o nome apenas para exibicao', () => {
    const netflix = result.offers.find((o) => o.providerName === 'Netflix')
    expect(netflix?.providerKey).toBe('8')
    // Nome nunca e identidade: a chave nao deriva do texto exibido.
    expect(netflix?.providerKey).not.toContain('Netflix')
  })

  it('propaga o link do PAIS como webUrl e nunca fabrica deep link por oferta', () => {
    const brOffers = result.offers.filter((o) => o.countryCode === 'BR')
    expect(brOffers.length).toBeGreaterThan(0)
    for (const offer of brOffers) {
      expect(offer.webUrl).toBe('https://www.themoviedb.org/movie/550-fight-club/watch?locale=BR')
      // `deepLink` nao existe neste contrato: o TMDB nao o publica por oferta.
      expect(offer).not.toHaveProperty('deepLink')
    }
  })

  it('preserva display_priority e logo_path sem os transformar em identidade', () => {
    const netflix = result.offers.find((o) => o.providerName === 'Netflix')
    expect(netflix?.displayPriority).toBe(0)
    expect(netflix?.logoPath).toBe('/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg')
  })

  it('normaliza o codigo de pais para MAIUSCULO', () => {
    // A fixture traz `us` minusculo, como o TMDB ja devolveu em respostas antigas.
    expect(result.offers.some((o) => o.countryCode === 'US')).toBe(true)
    expect(result.offers.some((o) => o.countryCode === 'us')).toBe(false)
  })

  it('nao produz nenhuma nota nem campo de rating (invariantes 1 e 2)', () => {
    for (const offer of result.offers) {
      const keys = Object.keys(offer)
      expect(keys).not.toContain('ratingValue')
      expect(keys).not.toContain('ratingSource')
      expect(keys).not.toContain('voteAverage')
    }
  })
})

describe('normalizeWatchProviders — "nao ha oferta" != "nao da para saber"', () => {
  it('results VAZIO e reconhecido com zero ofertas (o titulo nao tem oferta)', () => {
    const result = normalizeWatchProviders('movie', 1, {
      'watch/providers': { id: 1, results: {} },
    })
    expect(result.recognized).toBe(true)
    expect(result.offers).toEqual([])
    expect(result.rejections).toEqual([])
  })

  it('bloco AUSENTE NAO e reconhecido — o replace nao pode apagar snapshot bom', () => {
    const result = normalizeWatchProviders('movie', 1, { id: 1, title: 'Sem append' })
    expect(result.recognized).toBe(false)
    expect(reasons(result)).toEqual(['missing-watch-providers'])
  })

  it('bloco null NAO e reconhecido', () => {
    const result = normalizeWatchProviders('movie', 1, { 'watch/providers': null })
    expect(result.recognized).toBe(false)
    expect(reasons(result)).toEqual(['missing-watch-providers'])
  })

  it('results ausente/anomalo NAO e reconhecido', () => {
    const missing = normalizeWatchProviders('movie', 1, { 'watch/providers': { id: 1 } })
    expect(missing.recognized).toBe(false)
    expect(reasons(missing)).toEqual(['results-not-object'])

    const array = normalizeWatchProviders('movie', 1, { 'watch/providers': { results: [] } })
    expect(array.recognized).toBe(false)
    expect(reasons(array)).toEqual(['results-not-object'])
  })

  it('payload que nem e objeto NAO e reconhecido', () => {
    for (const bad of [null, undefined, 42, 'x', [] as unknown]) {
      const result = normalizeWatchProviders('movie', 1, bad)
      expect(result.recognized).toBe(false)
      expect(reasons(result)).toEqual(['payload-not-object'])
    }
  })

  it('aceita a chave alternativa watch_providers sem inventar o bloco', () => {
    const result = normalizeWatchProviders('tv', 1399, {
      watch_providers: { results: { BR: { flatrate: [{ provider_id: 384, provider_name: 'Max' }] } } },
    })
    expect(result.recognized).toBe(true)
    expect(result.offers).toHaveLength(1)
  })
})

describe('normalizeWatchProviders — todo descarte grita (B-H)', () => {
  it('bucket desconhecido e descartado COM motivo, nunca aproximado', () => {
    const result = normalizeWatchProviders('movie', 1, {
      'watch/providers': {
        results: { BR: { subscription_with_ads: [{ provider_id: 8, provider_name: 'Netflix' }] } },
      },
    })
    expect(result.offers).toEqual([])
    expect(reasons(result)).toEqual(['unmapped-offer-bucket'])
    expect(result.rejections[0]?.detail).toContain('subscription_with_ads')
  })

  it('bucket que nao e lista e descartado COM motivo', () => {
    const result = normalizeWatchProviders('movie', 1, {
      'watch/providers': { results: { BR: { flatrate: { provider_id: 8 } } } },
    })
    expect(result.offers).toEqual([])
    expect(reasons(result)).toEqual(['bucket-not-array'])
  })

  it('item que nao e objeto e descartado COM motivo', () => {
    const result = normalizeWatchProviders('movie', 1, {
      'watch/providers': { results: { BR: { flatrate: ['Netflix', null] } } },
    })
    expect(result.offers).toEqual([])
    expect(reasons(result)).toEqual(['offer-not-object', 'offer-not-object'])
  })

  it('sem provider_id inteiro positivo: nunca inventa identidade tecnica', () => {
    const result = normalizeWatchProviders('movie', 1, {
      'watch/providers': {
        results: {
          BR: {
            flatrate: [
              { provider_name: 'Sem id' },
              { provider_id: '8', provider_name: 'Id string' },
              { provider_id: 0, provider_name: 'Id zero' },
              { provider_id: 1.5, provider_name: 'Id fracionario' },
            ],
          },
        },
      },
    })
    expect(result.offers).toEqual([])
    expect(reasons(result)).toEqual([
      'missing-provider-id',
      'missing-provider-id',
      'missing-provider-id',
      'missing-provider-id',
    ])
  })

  it('sem provider_name: nunca inventa plataforma', () => {
    const result = normalizeWatchProviders('movie', 1, {
      'watch/providers': { results: { BR: { flatrate: [{ provider_id: 8, provider_name: '   ' }] } } },
    })
    expect(result.offers).toEqual([])
    expect(reasons(result)).toEqual(['missing-provider-name'])
  })

  it('pais fora de ISO 3166-1 alpha-2 e descartado COM motivo', () => {
    const result = normalizeWatchProviders('movie', 1, {
      'watch/providers': { results: { BRA: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } },
    })
    expect(result.offers).toEqual([])
    expect(reasons(result)).toEqual(['invalid-country-code'])
  })

  it('valor de pais que nao e objeto e descartado COM motivo', () => {
    const result = normalizeWatchProviders('movie', 1, {
      'watch/providers': { results: { BR: 'nada' } },
    })
    expect(result.offers).toEqual([])
    expect(reasons(result)).toEqual(['country-not-object'])
  })

  it('oferta repetida na mesma (pais, provedor, modalidade) e descartada COM motivo', () => {
    const result = normalizeWatchProviders('movie', 1, {
      'watch/providers': {
        results: {
          BR: {
            flatrate: [
              { provider_id: 8, provider_name: 'Netflix' },
              { provider_id: 8, provider_name: 'Netflix' },
            ],
          },
        },
      },
    })
    expect(result.offers).toHaveLength(1)
    expect(reasons(result)).toEqual(['duplicate-offer'])
  })

  it('o MESMO provedor em rent E buy nao e duplicata: sao ofertas distintas', () => {
    const result = normalizeWatchProviders('movie', 1, {
      'watch/providers': {
        results: {
          BR: {
            rent: [{ provider_id: 2, provider_name: 'Apple TV' }],
            buy: [{ provider_id: 2, provider_name: 'Apple TV' }],
          },
        },
      },
    })
    expect(result.offers).toHaveLength(2)
    expect(result.rejections).toEqual([])
  })
})

describe('normalizeWatchProviders — anti-pirataria (invariante 8)', () => {
  it.each([
    ['magnet:?xt=urn:btih:abcdef', 'esquema magnet'],
    ['https://host.example/file.torrent', 'arquivo .torrent sob https'],
    ['https://host.example/x?xt=urn:btih:abc', 'infohash em query sob https'],
    ['ftp://host.example/x', 'esquema ftp'],
    ['javascript:alert(1)', 'esquema javascript'],
    ['nao-e-url', 'texto que nem e URL'],
  ])('recusa o link de pais %s (%s) e REGISTRA a recusa', (link) => {
    const result = normalizeWatchProviders('movie', 1, {
      'watch/providers': {
        results: { BR: { link, flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } },
      },
    })
    // A oferta sobrevive sem URL; o link ruim nunca e gravado nem some calado.
    expect(result.offers).toHaveLength(1)
    expect(result.offers[0]?.webUrl).toBeNull()
    expect(reasons(result)).toContain('unsafe-country-link')
  })

  it('aceita http e https limpos', () => {
    expect(isSafeWatchLink('https://www.themoviedb.org/movie/550/watch?locale=BR')).toBe(true)
    expect(isSafeWatchLink('http://example.com/a')).toBe(true)
  })
})

describe('WATCH_OFFER_TYPE_BY_TMDB_BUCKET — contrato do mapa', () => {
  it('nao mapeia nenhum bucket para uma modalidade fora do enum do schema', () => {
    const allowed = new Set(['subscription', 'rent', 'buy', 'free', 'ads', 'cinema'])
    for (const value of Object.values(WATCH_OFFER_TYPE_BY_TMDB_BUCKET)) {
      expect(allowed.has(value)).toBe(true)
    }
  })

  it('nao mapeia `link` (e a pagina do pais, nao uma oferta)', () => {
    expect(WATCH_OFFER_TYPE_BY_TMDB_BUCKET.link).toBeUndefined()
  })
})
