/**
 * mapping.test.ts — Reconhecedor ESTRITO do payload de `/popular/`.
 *
 * O reconhecedor NAO adivinha: reconhece um contrato explicito e recusa (com
 * motivo) todo o resto. Sob o payload real de hoje (schema nao publicado) o
 * resultado esperado e "0 mapeados, N recusados" — e isso e SUCESSO.
 *
 * Invariantes cobertas: 1 (fonte/escala/label sao da FONTE, nunca cross-source),
 * 2 (a chave do provider tecnico NUNCA e aceita como rating_source).
 */

import { describe, it, expect } from 'vitest'

import { FILM_SHOW_RATINGS_PROVIDER_API } from '@screena/film-show-ratings-client'

import {
  mapPopularPayload,
  readRatingDraft,
  readImdbId,
  readTmdbId,
  readEntityRef,
  normalizeSourceKey,
  extractPopularItems,
  POPULAR_ARRAY_KEYS,
} from '../film-show-ratings/mapping.js'

const PROVIDER = FILM_SHOW_RATINGS_PROVIDER_API

/** Descritor imdb valido reutilizavel. */
function imdbDescriptor(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { source: 'imdb', metric: 'user_rating', value: 8.4, scale: 10, ...over }
}

describe('mapPopularPayload — forma do payload', () => {
  it.each([{ foo: 1 }, 'uma string', null, 42, true])(
    'payload de forma irreconhecivel (%s) -> recognized=false, 0 itens, 1 recusa payload-shape-unrecognized',
    (payload) => {
      const mapping = mapPopularPayload(payload, PROVIDER)
      expect(mapping.recognized).toBe(false)
      expect(mapping.items).toHaveLength(0)
      expect(mapping.rejections).toHaveLength(1)
      const rejection = mapping.rejections[0]
      expect(rejection?.reason).toBe('payload-shape-unrecognized')
    },
  )

  it.each(['results', 'data', 'items', 'popular', 'list'])(
    'envelope sob "%s" e reconhecido',
    (key) => {
      const mapping = mapPopularPayload({ [key]: [imdbDescriptorItem()] }, PROVIDER)
      expect(mapping.recognized).toBe(true)
      expect(mapping.items).toHaveLength(1)
    },
  )

  it('um array cru e reconhecido', () => {
    const mapping = mapPopularPayload([imdbDescriptorItem()], PROVIDER)
    expect(mapping.recognized).toBe(true)
    expect(mapping.items).toHaveLength(1)
  })
})

/** Item completo (id + rating imdb valido). */
function imdbDescriptorItem(): Record<string, unknown> {
  return { imdbId: 'tt0111161', ratings: [imdbDescriptor()] }
}

describe('mapPopularPayload — itens', () => {
  it('item SEM imdbId/tmdbId -> recusa no-entity-id', () => {
    const mapping = mapPopularPayload([{ ratings: [imdbDescriptor()] }], PROVIDER)
    expect(mapping.recognized).toBe(true)
    const item = mapping.items[0]
    expect(item).toBeDefined()
    expect(item?.rejections.map((r) => r.reason)).toContain('no-entity-id')
    // O id e que falta; o rating em si continua valido.
    expect(item?.ratings).toHaveLength(1)
  })

  it('item COM id porem SEM array ratings -> recusa no-rating-descriptors', () => {
    const mapping = mapPopularPayload([{ imdbId: 'tt0111161' }], PROVIDER)
    const item = mapping.items[0]
    expect(item?.rejections.map((r) => r.reason)).toContain('no-rating-descriptors')
    expect(item?.ratings).toHaveLength(0)
  })

  it('item que nao e objeto -> recusa item-not-object', () => {
    const mapping = mapPopularPayload(['x', 5], PROVIDER)
    expect(mapping.items[0]?.rejections.map((r) => r.reason)).toContain('item-not-object')
  })
})

describe('readRatingDraft — descritores', () => {
  it('imdb user_rating 8.4/10 -> ACEITO; label vem da seed canonica ("IMDb"), nunca do payload', () => {
    // O payload NAO carrega label; ele seria ignorado se carregasse.
    const result = readRatingDraft(imdbDescriptor({ label: 'Tomatometer' }), PROVIDER)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.rejection.reason)
    expect(result.draft.ratingSource).toBe('imdb')
    expect(result.draft.ratingLabel).toBe('IMDb')
    expect(result.draft.metric).toBe('user_rating')
    expect(result.draft.ratingValue).toBe(8.4)
    expect(result.draft.ratingScale).toBe(10)
  })

  it('CROSS-SOURCE: imdb declarado com escala 100 -> recusa rating-validation-failed (erro de escala do validateRating)', () => {
    // value <= 10 para nao disparar invalid-value antes; o que falha e a escala.
    const result = readRatingDraft(imdbDescriptor({ scale: 100 }), PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperava recusa')
    expect(result.rejection.reason).toBe('rating-validation-failed')
  })

  it('imdb com value 84 (excede a escala canonica 10) -> recusa invalid-value', () => {
    const result = readRatingDraft(imdbDescriptor({ value: 84, scale: 10 }), PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperava recusa')
    expect(result.rejection.reason).toBe('invalid-value')
  })

  it.each(['rapidapi_film_show_ratings', 'letterbox', ''])(
    'fonte desconhecida "%s" -> recusa unknown-rating-source',
    (source) => {
      const result = readRatingDraft(
        { source, metric: 'user_rating', value: 8.4, scale: 10 },
        PROVIDER,
      )
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('esperava recusa')
      expect(result.rejection.reason).toBe('unknown-rating-source')
    },
  )

  it('a CHAVE do provider tecnico nunca e aceita como rating_source (invariante 2)', () => {
    const result = readRatingDraft(
      { source: PROVIDER, metric: 'user_rating', value: 8.4, scale: 10 },
      PROVIDER,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('provider foi aceito como fonte — viola invariante 2')
    expect(result.rejection.reason).toBe('unknown-rating-source')
  })

  it('metric ausente -> recusa missing-metric', () => {
    const result = readRatingDraft({ source: 'imdb', value: 8.4, scale: 10 }, PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperava recusa')
    expect(result.rejection.reason).toBe('missing-metric')
  })

  it('scale ausente -> recusa missing-scale', () => {
    const result = readRatingDraft({ source: 'imdb', metric: 'user_rating', value: 8.4 }, PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperava recusa')
    expect(result.rejection.reason).toBe('missing-scale')
  })

  it('value nao numerico -> recusa invalid-value', () => {
    const result = readRatingDraft(
      { source: 'imdb', metric: 'user_rating', value: 'abc', scale: 10 },
      PROVIDER,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperava recusa')
    expect(result.rejection.reason).toBe('invalid-value')
  })

  it('rotten_tomatoes 92/100 metric tomatometer -> ACEITO com label "Rotten Tomatoes"', () => {
    const result = readRatingDraft(
      { source: 'rotten_tomatoes', metric: 'tomatometer', value: 92, scale: 100 },
      PROVIDER,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.rejection.reason)
    expect(result.draft.ratingSource).toBe('rotten_tomatoes')
    expect(result.draft.ratingLabel).toBe('Rotten Tomatoes')
    expect(result.draft.ratingScale).toBe(100)
  })

  it('descritor que nao e objeto -> recusa descriptor-not-object', () => {
    const result = readRatingDraft('nao-objeto', PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperava recusa')
    expect(result.rejection.reason).toBe('descriptor-not-object')
  })

  it('rating url so e aceita quando http(s); esquema arbitrario vira null', () => {
    const httpsOk = readRatingDraft(
      imdbDescriptor({ url: 'https://www.imdb.com/title/tt0111161/' }),
      PROVIDER,
    )
    expect(httpsOk.ok).toBe(true)
    if (!httpsOk.ok) throw new Error(httpsOk.rejection.reason)
    expect(httpsOk.draft.ratingUrl).toBe('https://www.imdb.com/title/tt0111161/')

    const httpOk = readRatingDraft(imdbDescriptor({ url: 'http://example.com/x' }), PROVIDER)
    expect(httpOk.ok).toBe(true)
    if (!httpOk.ok) throw new Error(httpOk.rejection.reason)
    expect(httpOk.draft.ratingUrl).toBe('http://example.com/x')

    for (const bad of ['ftp://example.com/x', 'javascript:alert(1)', 'www.imdb.com']) {
      const res = readRatingDraft(imdbDescriptor({ url: bad }), PROVIDER)
      expect(res.ok).toBe(true)
      if (!res.ok) throw new Error(res.rejection.reason)
      expect(res.draft.ratingUrl).toBeNull()
    }
  })
})

describe('helpers de id e normalizacao', () => {
  it('normalizeSourceKey("Rotten Tomatoes") === "rotten_tomatoes"', () => {
    expect(normalizeSourceKey('Rotten Tomatoes')).toBe('rotten_tomatoes')
    expect(normalizeSourceKey('  IMDb  ')).toBe('imdb')
  })

  it('readImdbId aceita tt<digitos> e rejeita o resto', () => {
    expect(readImdbId('tt0111161')).toBe('tt0111161')
    expect(readImdbId('tt')).toBeNull()
    expect(readImdbId('278')).toBeNull()
    expect(readImdbId(123)).toBeNull()
  })

  it('readTmdbId: "278"->278, 278->278, 0/-1/"abc"->null', () => {
    expect(readTmdbId('278')).toBe(278)
    expect(readTmdbId(278)).toBe(278)
    expect(readTmdbId(0)).toBeNull()
    expect(readTmdbId(-1)).toBeNull()
    expect(readTmdbId('abc')).toBeNull()
  })

  it('readEntityRef: null quando nenhum id inequivoco; le imdb/tmdb quando presentes', () => {
    expect(readEntityRef({})).toBeNull()
    expect(readEntityRef({ imdbId: 'tt5', tmdbId: '278' })).toEqual({ imdbId: 'tt5', tmdbId: 278 })
    expect(readEntityRef({ tmdbID: 278 })).toEqual({ imdbId: null, tmdbId: 278 })
  })

  it('extractPopularItems: array cru e envelope conhecido; null caso contrario', () => {
    expect(extractPopularItems([1, 2])).toEqual([1, 2])
    expect(extractPopularItems({ results: [1] })).toEqual([1])
    expect(extractPopularItems({ foo: 1 })).toBeNull()
    expect(extractPopularItems('x')).toBeNull()
    // Todas as chaves de envelope reconhecidas continuam cobertas.
    expect(POPULAR_ARRAY_KEYS).toContain('results')
  })
})
