/**
 * mapping.test.ts — Reconhecedor de `GET /shows/{id}` -> `watch_availability`.
 *
 * O arquivo mais critico: materializa as regras de governanca da traducao de
 * oferta. `addon` e DESCARTADO (nunca coagido a assinatura); sem provider nao ha
 * linha; deep link so http(s) (magnet/ftp recusados, mas a oferta segue sem
 * link); preco so com currency ISO valida; identidade obrigatoria.
 */

import { describe, expect, it } from 'vitest'

import {
  findCountryOffers,
  isSafeDeepLink,
  mapShowPayload,
  matchesEntity,
  readPrice,
  readTimestamp,
} from '../streaming-availability/mapping.js'
import type { SelectedEntity } from '../streaming-availability/types.js'

const MOVIE: SelectedEntity = {
  entityType: 'movie',
  entityId: '1',
  tmdbId: 278,
  imdbId: 'tt0111161',
}

/** Payload realista de um filme (bate por imdbId com a entidade acima). */
function show(offers: readonly unknown[], extra: Record<string, unknown> = {}): unknown {
  return {
    showType: 'movie',
    imdbId: 'tt0111161',
    tmdbId: 'movie/278',
    streamingOptions: { br: offers },
    ...extra,
  }
}

/** Uma oferta valida minima (assinatura Netflix com link https). */
function validOffer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'subscription',
    service: { id: 'netflix', name: 'Netflix' },
    link: 'https://netflix.com/title',
    ...overrides,
  }
}

describe('mapShowPayload — addon e DESCARTADO, nunca coagido a subscription', () => {
  it('addon produz zero ofertas e exatamente uma recusa unmapped-offer-type mencionando addon', () => {
    const addon = { type: 'addon', service: { id: 'starz', name: 'Starz' }, link: 'https://x' }
    const result = mapShowPayload(show([addon]), MOVIE, 'BR')

    expect(result.recognized).toBe(true)
    expect(result.offers).toHaveLength(0)
    expect(result.rejections).toHaveLength(1)
    expect(result.rejections[0]?.reason).toBe('unmapped-offer-type')
    expect(result.rejections[0]?.detail).toContain('addon')
    // Regra dura: NENHUMA oferta subscription nasce de um addon.
    expect(result.offers.some((offer) => offer.offerType === 'subscription')).toBe(false)
  })
})

describe('mapShowPayload — mapeamento de offerType', () => {
  it('subscription/rent/buy/free mapeiam para o mesmo OfferType', () => {
    for (const type of ['subscription', 'rent', 'buy', 'free'] as const) {
      const result = mapShowPayload(show([validOffer({ type })]), MOVIE, 'BR')
      expect(result.offers).toHaveLength(1)
      expect(result.offers[0]?.offerType).toBe(type)
    }
  })

  it('um type desconhecido e recusado como unmapped-offer-type', () => {
    const result = mapShowPayload(show([validOffer({ type: 'wibble' })]), MOVIE, 'BR')
    expect(result.offers).toHaveLength(0)
    expect(result.rejections[0]?.reason).toBe('unmapped-offer-type')
  })
})

describe('mapShowPayload — provider obrigatorio', () => {
  it('oferta sem service.name -> missing-provider-name e nenhuma linha', () => {
    const result = mapShowPayload(
      show([{ type: 'subscription', service: { id: 'x' }, link: 'https://y' }]),
      MOVIE,
      'BR',
    )
    expect(result.offers).toHaveLength(0)
    expect(result.rejections[0]?.reason).toBe('missing-provider-name')
  })
})

describe('mapShowPayload — deep link so http(s)', () => {
  it('links https e http sao aceitos', () => {
    const https = mapShowPayload(show([validOffer({ link: 'https://netflix.com/x' })]), MOVIE, 'BR')
    expect(https.offers[0]?.deepLink).toBe('https://netflix.com/x')

    const http = mapShowPayload(show([validOffer({ link: 'http://exemplo.com/x' })]), MOVIE, 'BR')
    expect(http.offers[0]?.deepLink).toBe('http://exemplo.com/x')
  })

  it('magnet e recusado (unsafe-deep-link) mas a oferta SEGUE emitida com deepLink null', () => {
    const result = mapShowPayload(
      show([{ type: 'subscription', service: { name: 'Pirata' }, link: 'magnet:?xt=urn:btih:abc123' }]),
      MOVIE,
      'BR',
    )
    // Comportamento real do codigo: a oferta ainda entra, so o link cai.
    expect(result.offers).toHaveLength(1)
    expect(result.offers[0]?.deepLink).toBeNull()
    expect(result.rejections.some((rej) => rej.reason === 'unsafe-deep-link')).toBe(true)
  })

  it('ftp e recusado (unsafe-deep-link), oferta emitida com deepLink null', () => {
    const result = mapShowPayload(
      show([{ type: 'rent', service: { name: 'Host' }, link: 'ftp://host/arquivo' }]),
      MOVIE,
      'BR',
    )
    expect(result.offers).toHaveLength(1)
    expect(result.offers[0]?.deepLink).toBeNull()
    expect(result.rejections.some((rej) => rej.reason === 'unsafe-deep-link')).toBe(true)
  })

  it('nenhum link magnet/torrent jamais aterrissa em deepLink', () => {
    const dirtyLinks = [
      'magnet:?xt=urn:btih:deadbeef',
      'ftp://tracker/x',
      'udp://tracker:6969/announce',
    ]
    for (const link of dirtyLinks) {
      const result = mapShowPayload(
        show([{ type: 'subscription', service: { name: 'X' }, link }]),
        MOVIE,
        'BR',
      )
      for (const offer of result.offers) {
        expect(offer.deepLink === null || /^https?:\/\//i.test(offer.deepLink)).toBe(true)
        if (offer.deepLink !== null) {
          expect(offer.deepLink).not.toMatch(/magnet|torrent/i)
        }
      }
    }
  })

  it('isSafeDeepLink so aprova http(s)', () => {
    expect(isSafeDeepLink('https://a.com')).toBe(true)
    expect(isSafeDeepLink('http://a.com')).toBe(true)
    expect(isSafeDeepLink('magnet:?xt=x')).toBe(false)
    expect(isSafeDeepLink('ftp://a')).toBe(false)
    expect(isSafeDeepLink(42)).toBe(false)
  })

  // Invariante 8: o esquema sozinho nao basta. Um `.torrent` servido por https
  // passaria num filtro que so olha `http(s)`.
  it('isSafeDeepLink recusa pirataria mesmo sob https', () => {
    expect(isSafeDeepLink('https://cdn.exemplo.com/filme.torrent')).toBe(false)
    expect(isSafeDeepLink('https://exemplo.com/x.torrent?token=1')).toBe(false)
    expect(isSafeDeepLink('https://exemplo.com/x.torrent#frag')).toBe(false)
    expect(isSafeDeepLink('https://tracker.exemplo/anuncio?xt=urn:btih:deadbeef')).toBe(false)
    // Falso positivo improvavel, mas o filtro nao pode comer link legitimo:
    expect(isSafeDeepLink('https://netflix.com/title/70264888')).toBe(true)
    expect(isSafeDeepLink('https://exemplo.com/torrentes-do-mar')).toBe(true)
  })

  it('um .torrent sob https e recusado e nao vira deepLink', () => {
    const result = mapShowPayload(
      show([
        {
          type: 'subscription',
          service: { name: 'Suspeito' },
          link: 'https://cdn.exemplo.com/filme.torrent',
        },
      ]),
      MOVIE,
      'BR',
    )
    expect(result.offers).toHaveLength(1)
    expect(result.offers[0]?.deepLink).toBeNull()
    expect(result.rejections.some((rej) => rej.reason === 'unsafe-deep-link')).toBe(true)
  })
})

describe('mapShowPayload — preco anda junto de currency valida (CHECK do schema)', () => {
  it('amount string + currency minuscula -> price 12.9 e currency BRL', () => {
    const result = mapShowPayload(
      show([validOffer({ price: { amount: '12.90', currency: 'brl' } })]),
      MOVIE,
      'BR',
    )
    expect(result.offers[0]?.price).toBe(12.9)
    expect(result.offers[0]?.currency).toBe('BRL')
  })

  it('sem currency, currency invalida ou amount negativo -> price E currency ambos null', () => {
    const bad: readonly Record<string, unknown>[] = [
      { amount: '12.90' }, // currency ausente
      { amount: 5, currency: 'BR' }, // 2 letras
      { amount: 5, currency: 'BRLL' }, // 4 letras
      { amount: -3, currency: 'BRL' }, // negativo
    ]
    for (const price of bad) {
      const result = mapShowPayload(show([validOffer({ price })]), MOVIE, 'BR')
      const offer = result.offers[0]
      expect(offer?.price).toBeNull()
      expect(offer?.currency).toBeNull()
    }
  })

  it('price e currency nunca sao inconsistentes (ambos ou nenhum)', () => {
    const samples: readonly Record<string, unknown>[] = [
      { amount: '12.90', currency: 'brl' },
      { amount: '9.99', currency: 'USD' },
      { amount: '0', currency: 'eur' },
      { amount: '12.90' },
      { amount: 5, currency: 'X' },
    ]
    for (const price of samples) {
      const offer = mapShowPayload(show([validOffer({ price })]), MOVIE, 'BR').offers[0]
      expect(offer !== undefined).toBe(true)
      expect(offer?.price === null).toBe(offer?.currency === null)
    }
  })

  it('readPrice (unidade) — casos diretos', () => {
    expect(readPrice({ amount: '12.90', currency: 'brl' })).toEqual({ price: 12.9, currency: 'BRL' })
    expect(readPrice({ amount: '12.90' })).toBeNull()
    expect(readPrice({ amount: -1, currency: 'BRL' })).toBeNull()
    expect(readPrice({ amount: 5, currency: 'reais' })).toBeNull()
    expect(readPrice('not-object')).toBeNull()
  })
})

describe('mapShowPayload — quality', () => {
  it('hd/uhd sao mantidos em minusculo; desconhecido vira null', () => {
    expect(mapShowPayload(show([validOffer({ quality: 'hd' })]), MOVIE, 'BR').offers[0]?.quality).toBe(
      'hd',
    )
    expect(
      mapShowPayload(show([validOffer({ quality: 'uhd' })]), MOVIE, 'BR').offers[0]?.quality,
    ).toBe('uhd')
    expect(
      mapShowPayload(show([validOffer({ quality: 'potato' })]), MOVIE, 'BR').offers[0]?.quality,
    ).toBeNull()
  })
})

describe('mapShowPayload — timestamps (segundos ou ms)', () => {
  it('availableSince/expiresOn em segundos ou ms viram a mesma Date; 0/negativo/ausente -> null', () => {
    const seconds = mapShowPayload(
      show([validOffer({ availableSince: 1_700_000_000, expiresOn: 1_700_000_000 })]),
      MOVIE,
      'BR',
    ).offers[0]
    expect(seconds?.availableFrom?.getTime()).toBe(1_700_000_000_000)
    expect(seconds?.availableUntil?.getTime()).toBe(1_700_000_000_000)

    const millis = mapShowPayload(
      show([validOffer({ availableSince: 1_700_000_000_000 })]),
      MOVIE,
      'BR',
    ).offers[0]
    expect(millis?.availableFrom?.getTime()).toBe(1_700_000_000_000)

    const invalid = mapShowPayload(
      show([validOffer({ availableSince: 0, expiresOn: -5 })]),
      MOVIE,
      'BR',
    ).offers[0]
    expect(invalid?.availableFrom).toBeNull()
    expect(invalid?.availableUntil).toBeNull()

    const absent = mapShowPayload(show([validOffer()]), MOVIE, 'BR').offers[0]
    expect(absent?.availableFrom).toBeNull()
    expect(absent?.availableUntil).toBeNull()
  })

  it('readTimestamp (unidade) — segundos e ms convergem, invalidos -> null', () => {
    expect(readTimestamp(1_700_000_000)?.getTime()).toBe(1_700_000_000_000)
    expect(readTimestamp(1_700_000_000_000)?.getTime()).toBe(1_700_000_000_000)
    expect(readTimestamp(0)).toBeNull()
    expect(readTimestamp(-1)).toBeNull()
    expect(readTimestamp('nope')).toBeNull()
    expect(readTimestamp(undefined)).toBeNull()
  })
})

describe('mapShowPayload — lookup de pais case-insensitive', () => {
  it("streamingOptions com chave 'br' resolve para countryCode 'BR'", () => {
    const result = mapShowPayload(show([validOffer()]), MOVIE, 'BR')
    expect(result.offers).toHaveLength(1)
  })

  it("streamingOptions com chave 'BR' tambem resolve para 'BR'", () => {
    const payload = {
      showType: 'movie',
      imdbId: 'tt0111161',
      tmdbId: 'movie/278',
      streamingOptions: { BR: [validOffer()] },
    }
    expect(mapShowPayload(payload, MOVIE, 'BR').offers).toHaveLength(1)
  })

  it('findCountryOffers (unidade) ignora caixa nos dois lados', () => {
    const options = { br: [validOffer()] }
    expect(findCountryOffers(options, 'BR')).toHaveLength(1)
    expect(findCountryOffers(options, 'br')).toHaveLength(1)
    expect(findCountryOffers({ us: [validOffer()] }, 'BR')).toBeNull()
  })

  it('pais ausente -> recognized true, zero ofertas, recusa country-absent', () => {
    const payload = {
      showType: 'movie',
      imdbId: 'tt0111161',
      tmdbId: 'movie/278',
      streamingOptions: { us: [validOffer()] },
    }
    const result = mapShowPayload(payload, MOVIE, 'BR')
    expect(result.recognized).toBe(true)
    expect(result.offers).toHaveLength(0)
    expect(result.rejections[0]?.reason).toBe('country-absent')
  })
})

describe('mapShowPayload — GUARDA DE IDENTIDADE', () => {
  it("showType 'series' contra entidade movie -> recognized false, identity-mismatch, zero ofertas", () => {
    const payload = {
      showType: 'series',
      imdbId: 'tt0111161',
      tmdbId: 'tv/278',
      streamingOptions: { br: [validOffer()] },
    }
    const result = mapShowPayload(payload, MOVIE, 'BR')
    expect(result.recognized).toBe(false)
    expect(result.offers).toHaveLength(0)
    // Codigo: 'series' e tipo conhecido -> passa show-type e cai em matchesEntity.
    expect(result.rejections[0]?.reason).toBe('identity-mismatch')
  })

  it("tmdbId 'movie/999' contra entidade tmdb 278 -> identity-mismatch, zero ofertas", () => {
    const payload = {
      showType: 'movie',
      tmdbId: 'movie/999',
      streamingOptions: { br: [validOffer()] },
    }
    const result = mapShowPayload(payload, MOVIE, 'BR')
    expect(result.recognized).toBe(false)
    expect(result.offers).toHaveLength(0)
    expect(result.rejections[0]?.reason).toBe('identity-mismatch')
  })

  it("tmdbId 'nu' (bare) '278' bate com a entidade", () => {
    const payload = {
      showType: 'movie',
      tmdbId: '278',
      streamingOptions: { br: [validOffer()] },
    }
    const result = mapShowPayload(payload, MOVIE, 'BR')
    expect(result.recognized).toBe(true)
    expect(result.offers).toHaveLength(1)
  })

  it('matchesEntity (unidade) — tipo, imdb e tmdb', () => {
    expect(matchesEntity({ showType: 'movie', tmdbId: '278' }, MOVIE)).toBe(true)
    expect(matchesEntity({ showType: 'movie', imdbId: 'tt0111161' }, MOVIE)).toBe(true)
    expect(matchesEntity({ showType: 'series', tmdbId: 'tv/278' }, MOVIE)).toBe(false)
    expect(matchesEntity({ showType: 'movie', tmdbId: 'movie/999' }, MOVIE)).toBe(false)
  })
})

describe('mapShowPayload — countryCode das linhas sempre MAIUSCULO', () => {
  it("mapear com countryCode 'br' minusculo ainda grava 'BR' nas ofertas", () => {
    const result = mapShowPayload(show([validOffer()]), MOVIE, 'br')
    expect(result.offers).toHaveLength(1)
    expect(result.offers[0]?.countryCode).toBe('BR')
  })
})
