/**
 * external-intelligence.test.ts — O que os contratos publicos IMPEDEM.
 *
 * Cada caso aqui e uma forma concreta de mentir ao usuario que o contrato
 * recusa na fronteira: nota reescalada, Tomatometer atribuido ao IMDb via
 * escala, preco sem moeda, link pirata, Cinerie Score "indisponivel" carregando
 * numero.
 */

import { describe, expect, it } from 'vitest'

import {
  unavailableCinerieScore,
  validateCinerieScorePayload,
  validatePublicExternalRating,
  validatePublicWatchOffer,
  validateRatingsPayload,
  validateStreamingPayload,
} from '../external-intelligence.js'
import type { EntityRef } from '../primitives.js'

const entity: EntityRef = {
  kind: 'movie',
  id: '1',
  title: 'Filme de Teste',
  canonicalUrl: '/pt/filmes/filme-de-teste/',
}

const imdbRating = {
  sourceKey: 'imdb',
  sourceLabel: 'IMDb',
  scoreType: 'audience',
  value: 8.4,
  best: 10,
  count: 12000,
  label: 'IMDb Rating',
  updatedAt: '2026-07-15T10:00:00.000Z',
  attribution: { text: 'Nota fornecida por IMDb', url: 'https://www.imdb.com/title/tt1/' },
}

describe('PublicExternalRating — escala pertence a fonte (invariante 1)', () => {
  it('aceita a nota valida de referencia', () => {
    expect(validatePublicExternalRating(imdbRating).ok).toBe(true)
  })

  it('RECUSA imdb declarado na escala 100 (nota reescalada disfarcada)', () => {
    const result = validatePublicExternalRating({ ...imdbRating, best: 100, value: 84 })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/escala 10.*recebido 100/)
  })

  it('RECUSA rotten_tomatoes na escala 10', () => {
    const result = validatePublicExternalRating({
      ...imdbRating,
      sourceKey: 'rotten_tomatoes',
      sourceLabel: 'Rotten Tomatoes',
      label: 'Tomatometer',
      scoreType: 'critics',
      best: 10,
      value: 9.2,
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/escala 100/)
  })

  it('RECUSA fonte que nao e editorial reconhecida (ex.: um provider tecnico)', () => {
    const result = validatePublicExternalRating({ ...imdbRating, sourceKey: 'imdb236' })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/nao e fonte editorial reconhecida/)
  })

  it('RECUSA valor fora da escala', () => {
    expect(validatePublicExternalRating({ ...imdbRating, value: 11 }).ok).toBe(false)
  })

  it('RECUSA votos negativos', () => {
    expect(validatePublicExternalRating({ ...imdbRating, count: -1 }).ok).toBe(false)
  })

  it('ACEITA count=null (desconhecido != zero fabricado)', () => {
    expect(validatePublicExternalRating({ ...imdbRating, count: null }).ok).toBe(true)
  })

  it('RECUSA scoreType fora de critics/audience/editorial', () => {
    expect(validatePublicExternalRating({ ...imdbRating, scoreType: 'geral' }).ok).toBe(false)
  })
})

describe('RatingsPayload', () => {
  it('aceita payload com uma nota por fonte+tipo', () => {
    expect(validateRatingsPayload({ entity, ratings: [imdbRating] }).ok).toBe(true)
  })

  it('ACEITA critics e audience da MESMA fonte (sao metricas distintas)', () => {
    const result = validateRatingsPayload({
      entity,
      ratings: [
        {
          ...imdbRating,
          sourceKey: 'rotten_tomatoes',
          sourceLabel: 'Rotten Tomatoes',
          label: 'Tomatometer',
          scoreType: 'critics',
          value: 92,
          best: 100,
        },
        {
          ...imdbRating,
          sourceKey: 'rotten_tomatoes',
          sourceLabel: 'Rotten Tomatoes',
          label: 'Popcornmeter',
          scoreType: 'audience',
          value: 88,
          best: 100,
        },
      ],
    })
    expect(result.ok).toBe(true)
  })

  it('RECUSA fonte+tipo duplicados (a UI nao teria como escolher qual e a nota)', () => {
    const result = validateRatingsPayload({ entity, ratings: [imdbRating, { ...imdbRating, value: 7.1 }] })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/duplicados/)
  })

  it('aceita lista vazia (ausencia de nota e um estado legitimo)', () => {
    expect(validateRatingsPayload({ entity, ratings: [] }).ok).toBe(true)
  })
})

describe('PublicWatchOffer — legalidade e coerencia de preco', () => {
  const offer = {
    provider: { slug: 'netflix', name: 'Netflix', logoAssetId: null, homepageUrl: 'https://www.netflix.com/' },
    offerType: 'subscription',
    price: null,
    currency: null,
    quality: 'hd',
    package: null,
    url: 'https://www.netflix.com/title/1',
    availableUntil: null,
    attribution: { text: 'Movie of the Night', url: 'https://motn.test/' },
  }

  it('aceita a oferta valida de referencia', () => {
    expect(validatePublicWatchOffer(offer).ok).toBe(true)
  })

  it('RECUSA link nao-HTTPS (invariante 8 na fronteira do contrato)', () => {
    for (const url of ['http://pirata.test/x', 'magnet:?xt=urn:btih:abc', 'ftp://x/y']) {
      const result = validatePublicWatchOffer({ ...offer, url })
      expect(result.ok, url).toBe(false)
      expect(result.errors.join(' ')).toMatch(/HTTPS/)
    }
  })

  it('RECUSA preco sem moeda (numero sem significado)', () => {
    const result = validatePublicWatchOffer({ ...offer, offerType: 'rent', price: 14.9, currency: null })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/currency/)
  })

  it('RECUSA preco em modalidade nao-transacional', () => {
    const result = validatePublicWatchOffer({ ...offer, offerType: 'subscription', price: 39.9, currency: 'BRL' })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/subscription nao tem preco/)
  })

  it('ACEITA preco com moeda em rent/buy', () => {
    expect(validatePublicWatchOffer({ ...offer, offerType: 'buy', price: 29.9, currency: 'BRL' }).ok).toBe(true)
  })

  it('RECUSA moeda que nao e ISO-4217 de 3 letras', () => {
    expect(
      validatePublicWatchOffer({ ...offer, offerType: 'buy', price: 29.9, currency: 'REAIS' }).ok,
    ).toBe(false)
  })

  it('RECUSA oferta sem provedor canonico', () => {
    const { provider: _drop, ...withoutProvider } = offer
    expect(validatePublicWatchOffer(withoutProvider).ok).toBe(false)
  })

  it('RECUSA modalidade desconhecida (nada fora das legais)', () => {
    expect(validatePublicWatchOffer({ ...offer, offerType: 'torrent' }).ok).toBe(false)
  })
})

describe('StreamingPayload', () => {
  it('exige pais ISO alpha-2', () => {
    expect(validateStreamingPayload({ entity, country: 'BRA', updatedAt: null, offers: [] }).ok).toBe(false)
    expect(validateStreamingPayload({ entity, country: 'BR', updatedAt: null, offers: [] }).ok).toBe(true)
  })
})

describe('CinerieScorePayload — a ausencia tem forma explicita', () => {
  it('unavailableCinerieScore produz o payload indisponivel valido', () => {
    const payload = unavailableCinerieScore(entity)
    expect(payload.available).toBe(false)
    expect(payload.value).toBeNull()
    expect(validateCinerieScorePayload(payload).ok).toBe(true)
  })

  it('RECUSA available=false carregando numero (a porta por onde uma nota nao aprovada chega a tela)', () => {
    const result = validateCinerieScorePayload({
      entity,
      available: false,
      value: 4.2,
      scale: 5,
      version: null,
      calculatedAt: null,
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/value: deve ser null/)
  })

  it('RECUSA available=true sem valor/escala/versao/data', () => {
    const result = validateCinerieScorePayload({
      entity,
      available: true,
      value: null,
      scale: null,
      version: null,
      calculatedAt: null,
    })
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(4)
  })

  it('RECUSA valor fora da escala', () => {
    const result = validateCinerieScorePayload({
      entity,
      available: true,
      value: 7,
      scale: 5,
      version: 'x/v1',
      calculatedAt: '2026-07-17T00:00:00.000Z',
    })
    expect(result.ok).toBe(false)
  })

  it('ACEITA nota completa (a forma que a decisao aprovada produzira)', () => {
    const result = validateCinerieScorePayload({
      entity,
      available: true,
      value: 4.2,
      scale: 5,
      version: 'cinerie-score/v1',
      calculatedAt: '2026-07-17T00:00:00.000Z',
    })
    expect(result.ok).toBe(true)
  })
})
