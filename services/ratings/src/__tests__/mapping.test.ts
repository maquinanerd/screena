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
  mapItemPayload,
  mapSingleItem,
  extractItemObject,
  readRatingDraft,
  readImdbId,
  readTmdbId,
  readEntityRef,
  readFiniteNumber,
  normalizeSourceKey,
  extractPopularItems,
  flattenSourceKeyedRatings,
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

  it.each(['results', 'result', 'data', 'items', 'popular', 'list'])(
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

  it('value como STRING numerica finita ("7.6") e ACEITO (item 7); string nao numerica ainda recusa', () => {
    const ok = readRatingDraft(imdbDescriptor({ value: '7.6' }), PROVIDER)
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error(ok.rejection.reason)
    expect(ok.draft.ratingValue).toBe(7.6)

    for (const bad of ['N/A', '', 'Infinity']) {
      const res = readRatingDraft(imdbDescriptor({ value: bad }), PROVIDER)
      expect(res.ok).toBe(false)
      if (res.ok) throw new Error('esperava recusa')
      expect(res.rejection.reason).toBe('invalid-value')
    }
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

  it('readEntityRef: le ids ANINHADOS (ids.IMDb/ids.TMDB); top-level tem precedencia', () => {
    // Formato real da RapidAPI: ids sob `item.ids`.
    expect(readEntityRef({ ids: { IMDb: 'tt9603208', TMDB: '575265' } })).toEqual({
      imdbId: 'tt9603208',
      tmdbId: 575265,
    })
    // So TMDB aninhado.
    expect(readEntityRef({ ids: { TMDB: 575265 } })).toEqual({ imdbId: null, tmdbId: 575265 })
    // Top-level vence o aninhado quando ambos existem.
    expect(readEntityRef({ imdbId: 'tt1', ids: { IMDb: 'tt9603208' } })).toEqual({
      imdbId: 'tt1',
      tmdbId: null,
    })
    // ids aninhado malformado nao "escapa" da validacao de id.
    expect(readEntityRef({ ids: { IMDb: 'nope', TMDB: 'x' } })).toBeNull()
  })

  it('readFiniteNumber: numero e string numerica finita; null caso contrario', () => {
    expect(readFiniteNumber(7)).toBe(7)
    expect(readFiniteNumber(7.6)).toBe(7.6)
    expect(readFiniteNumber('7')).toBe(7)
    expect(readFiniteNumber('  7.6 ')).toBe(7.6)
    expect(readFiniteNumber('abc')).toBeNull()
    expect(readFiniteNumber('')).toBeNull()
    expect(readFiniteNumber('Infinity')).toBeNull()
    expect(readFiniteNumber(Number.NaN)).toBeNull()
    expect(readFiniteNumber(null)).toBeNull()
    expect(readFiniteNumber(undefined)).toBeNull()
  })

  it('flattenSourceKeyedRatings: um descritor por (fonte, metrica) com url de links[<fonte>]', () => {
    const descriptors = flattenSourceKeyedRatings(
      {
        IMDb: { audience: { rating: 7.6, count: 33133, bestValue: 10 } },
        'Rotten Tomatoes': {
          audience: { rating: 90, bestValue: 100 },
          critics: { rating: 80, bestValue: 100 },
        },
        // Celula que nao e objeto e ignorada (nada a achatar).
        Ignored: { audience: 5 },
      },
      { IMDb: 'https://www.imdb.com/title/tt9603208' },
    )
    expect(descriptors).toEqual([
      {
        source: 'IMDb',
        metric: 'audience',
        value: 7.6,
        scale: 10,
        count: 33133,
        url: 'https://www.imdb.com/title/tt9603208',
      },
      { source: 'Rotten Tomatoes', metric: 'audience', value: 90, scale: 100, count: undefined, url: undefined },
      { source: 'Rotten Tomatoes', metric: 'critics', value: 80, scale: 100, count: undefined, url: undefined },
    ])
  })

  it('extractPopularItems: array cru e envelope conhecido (inclui root.result); null caso contrario', () => {
    expect(extractPopularItems([1, 2])).toEqual([1, 2])
    expect(extractPopularItems({ results: [1] })).toEqual([1])
    // Formato real da RapidAPI: `{ status, date, result: [...] }`.
    expect(extractPopularItems({ status: 'success', date: '2025-05-27', result: [1] })).toEqual([1])
    expect(extractPopularItems({ foo: 1 })).toBeNull()
    expect(extractPopularItems('x')).toBeNull()
    // Todas as chaves de envelope reconhecidas continuam cobertas.
    expect(POPULAR_ARRAY_KEYS).toContain('results')
    expect(POPULAR_ARRAY_KEYS).toContain('result')
  })
})

/**
 * Um item no FORMATO REAL da RapidAPI: `ratings` como objeto POR FONTE (com
 * audience/critics), ids aninhados em `ids`, urls em `links`. Espelha o payload
 * documentado de `/popular/?type=film`.
 */
function realPayloadItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Mission: Impossible - The Final Reckoning',
    type: 'film',
    ratings: {
      IMDb: { audience: { rating: 7.6, count: 33133, bestValue: 10 } },
      'Rotten Tomatoes': {
        audience: { rating: 90, count: 2500, bestValue: 100 },
        critics: { rating: 80, count: 303, bestValue: 100 },
      },
      Metacritic: {
        // user score em base 10 (NAO e a escala canonica do Metacritic).
        audience: { rating: 7.3, count: 83, bestValue: 10 },
        // Metascore em base 100 (escala canonica).
        critics: { rating: 67, count: 56, bestValue: 100 },
      },
      Letterboxd: { audience: { rating: 3.64, count: 149981, bestValue: 5 } },
      FilmAffinity: { audience: { rating: 7.1, count: 1134, bestValue: 10 } },
      // Fonte tecnica nao governada por este worker.
      TMDB: { audience: { rating: '7', count: 252, bestValue: 10 } },
    },
    ids: { IMDb: 'tt9603208', TMDB: '575265' },
    links: {
      IMDb: 'https://www.imdb.com/title/tt9603208',
      'Rotten Tomatoes':
        'https://www.rottentomatoes.com/m/mission_impossible_the_final_reckoning',
      Metacritic: 'https://www.metacritic.com/movie/mission-impossible-the-final-reckoning',
      Letterboxd: 'https://letterboxd.com/film/mission-impossible-8',
      FilmAffinity: 'https://www.filmaffinity.com/us/film923082.html',
    },
    ...over,
  }
}

/** O envelope real completo: `{ status, date, result: [...] }`. */
function realPayload(items: readonly unknown[] = [realPayloadItem()]): Record<string, unknown> {
  return { status: 'success', date: '2025-05-27', result: items }
}

/** `${fonte}:${metrica}` de cada draft, para comparacao por conjunto. */
function draftKeys(
  item:
    | { readonly ratings: readonly { ratingSource: string; metric: string }[] }
    | null
    | undefined,
): string[] {
  return (item?.ratings ?? []).map((d) => `${d.ratingSource}:${d.metric}`)
}

describe('mapPopularPayload — FORMATO REAL da RapidAPI (objeto por fonte)', () => {
  it('root.result e reconhecido; 1 item mapeado', () => {
    const mapping = mapPopularPayload(realPayload(), PROVIDER)
    expect(mapping.recognized).toBe(true)
    expect(mapping.items).toHaveLength(1)
  })

  it('ids.IMDb/ids.TMDB aninhados resolvem o ref do item (sem no-entity-id)', () => {
    const item = mapPopularPayload(realPayload(), PROVIDER).items[0]
    expect(item?.ref).toEqual({ imdbId: 'tt9603208', tmdbId: 575265 })
    expect(item?.rejections.map((r) => r.reason)).not.toContain('no-entity-id')
  })

  it('objeto ratings gera drafts para IMDb, RT audience/critics, Metacritic critics, Letterboxd e FilmAffinity — sem reescalar', () => {
    const item = mapPopularPayload(realPayload(), PROVIDER).items[0]
    expect(new Set(draftKeys(item))).toEqual(
      new Set([
        'imdb:audience',
        'rotten_tomatoes:audience',
        'rotten_tomatoes:critics',
        'metacritic:critics',
        'letterboxd:audience',
        'filmaffinity:audience',
      ]),
    )

    // value/scale/count vem CRU do payload (bestValue = escala), sem conversao;
    // label vem da seed canonica, nunca do payload.
    const rtCritics = item?.ratings.find(
      (d) => d.ratingSource === 'rotten_tomatoes' && d.metric === 'critics',
    )
    expect(rtCritics).toMatchObject({
      ratingValue: 80,
      ratingScale: 100,
      ratingCount: 303,
      ratingLabel: 'Rotten Tomatoes',
    })
    const letterboxd = item?.ratings.find((d) => d.ratingSource === 'letterboxd')
    expect(letterboxd).toMatchObject({ ratingValue: 3.64, ratingScale: 5, ratingLabel: 'Letterboxd' })
    const filmaffinity = item?.ratings.find((d) => d.ratingSource === 'filmaffinity')
    expect(filmaffinity).toMatchObject({ ratingValue: 7.1, ratingScale: 10 })
  })

  it('Metacritic AUDIENCE (user score base 10) e RECUSADO por escala — nunca reescalado para 100 (invariante 1)', () => {
    // RATING_SCALES.metacritic = 100 (Metascore). O user score em base 10 nao
    // pertence a essa escala: validateRating recusa e o mapper NAO converte.
    const item = mapPopularPayload(realPayload(), PROVIDER).items[0]
    expect(draftKeys(item)).not.toContain('metacritic:audience')
    expect(item?.rejections.map((r) => r.reason)).toContain('rating-validation-failed')
  })

  it('ratings.TMDB NUNCA vira external rating (fonte nao governada) -> recusa unknown-rating-source', () => {
    const item = mapPopularPayload(realPayload(), PROVIDER).items[0]
    expect((item?.ratings ?? []).some((d) => (d.ratingSource as string) === 'tmdb')).toBe(false)
    expect(item?.rejections.map((r) => r.reason)).toContain('unknown-rating-source')
  })

  it('links[<fonte>] vira ratingUrl (http/https) do draft daquela fonte', () => {
    const item = mapPopularPayload(realPayload(), PROVIDER).items[0]
    const imdb = item?.ratings.find((d) => d.ratingSource === 'imdb')
    expect(imdb?.ratingUrl).toBe('https://www.imdb.com/title/tt9603208')
    const rtCritics = item?.ratings.find(
      (d) => d.ratingSource === 'rotten_tomatoes' && d.metric === 'critics',
    )
    expect(rtCritics?.ratingUrl).toBe(
      'https://www.rottentomatoes.com/m/mission_impossible_the_final_reckoning',
    )
  })

  it('rating como STRING numerica finita e aceito no formato objeto (ex.: value "7")', () => {
    // Fonte governada (filmaffinity, escala 10) com value string "7".
    const payload = realPayload([
      { ids: { IMDb: 'tt1' }, ratings: { FilmAffinity: { audience: { rating: '7', bestValue: 10 } } } },
    ])
    const fa = mapPopularPayload(payload, PROVIDER).items[0]?.ratings.find(
      (d) => d.ratingSource === 'filmaffinity',
    )
    expect(fa?.ratingValue).toBe(7)
    expect(fa?.ratingScale).toBe(10)
  })

  it('item real SEM nenhum id (nem top-level nem ids) -> recusa no-entity-id, mas os ratings continuam validos', () => {
    const payload = realPayload([realPayloadItem({ ids: undefined })])
    const item = mapPopularPayload(payload, PROVIDER).items[0]
    expect(item?.ref).toBeNull()
    expect(item?.rejections.map((r) => r.reason)).toContain('no-entity-id')
    // Mesmo sem id, os drafts governados sao reconhecidos.
    expect(draftKeys(item)).toContain('imdb:audience')
  })

  it('formato ANTIGO (ratings como array) continua reconhecido e valido (retrocompat)', () => {
    const legacy = [{ imdbId: 'tt0111161', ratings: [imdbDescriptor()] }]
    const mapping = mapPopularPayload(legacy, PROVIDER)
    expect(mapping.recognized).toBe(true)
    const item = mapping.items[0]
    expect(item?.ratings).toHaveLength(1)
    expect(item?.ratings[0]?.ratingSource).toBe('imdb')
    expect(item?.rejections).toHaveLength(0)
  })
})

/**
 * Payload REAL do `GET /item/?id=tt9603208` (envelope `{ status, result: {...} }`,
 * onde `result` e um OBJETO — um titulo). Espelha o exemplo validado no RapidAPI.
 */
function getItemEnvelope(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'success',
    result: {
      title: 'Mission: Impossible - The Final Reckoning',
      type: 'film',
      ratings: {
        FilmAffinity: { audience: { rating: 6.8, count: 4902, bestValue: 10 } },
        IMDb: { audience: { rating: 7.1, count: 234993, bestValue: 10 } },
        Letterboxd: { audience: { rating: 3.45, count: 761921, bestValue: 5 } },
        Metacritic: {
          // user score base 10 (NAO e a escala canonica do Metacritic).
          audience: { rating: 6.8, count: 475, bestValue: 10 },
          // Metascore base 100 (escala canonica).
          critics: { rating: 67, count: 57, bestValue: 100 },
        },
        'Rotten Tomatoes': {
          audience: { rating: 88, count: 10000, bestValue: 100 },
          critics: { rating: 80, count: 427, bestValue: 100 },
        },
        // Fornecedor tecnico nao governado por este worker.
        TMDB: { audience: { rating: 7.2, count: 2790, bestValue: 10 } },
      },
      ids: { IMDb: 'tt9603208', TMDB: '575265' },
      links: {
        IMDb: 'https://www.imdb.com/title/tt9603208',
        'Rotten Tomatoes':
          'https://www.rottentomatoes.com/m/mission_impossible_the_final_reckoning',
        Metacritic: 'https://www.metacritic.com/movie/mission-impossible-the-final-reckoning',
        Letterboxd: 'https://letterboxd.com/film/mission-impossible-the-final-reckoning',
        FilmAffinity: 'https://www.filmaffinity.com/us/film923082.html',
      },
      ...over,
    },
  }
}

describe('extractItemObject — isola o item unico', () => {
  it('envelope { result: {...} } (objeto) -> devolve o result', () => {
    const env = getItemEnvelope()
    expect(extractItemObject(env)).toBe(env['result'])
  })

  it('item cru { ratings/ids/links } passado direto e reconhecido', () => {
    const raw = { ids: { IMDb: 'tt1' }, ratings: { IMDb: { audience: { rating: 7, bestValue: 10 } } } }
    expect(extractItemObject(raw)).toBe(raw)
  })

  it('envelope de /popular/ (result ARRAY) NAO e aceito como item -> null', () => {
    // Protege a fronteira: o fluxo de item nunca aceita, por engano, a lista de
    // populares (onde `result` e um array).
    expect(extractItemObject({ status: 'success', date: '2025-05-27', result: [{ ids: { IMDb: 'tt1' } }] })).toBeNull()
  })

  it.each([{ foo: 1 }, 'x', null, 42, [1, 2]])('forma irreconhecivel (%s) -> null', (payload) => {
    expect(extractItemObject(payload)).toBeNull()
  })
})

describe('mapItemPayload — payload REAL do GET /item/', () => {
  it('envelope { status, result:{...} } e reconhecido; 1 item', () => {
    const mapping = mapItemPayload(getItemEnvelope(), PROVIDER)
    expect(mapping.recognized).toBe(true)
    expect(mapping.item).not.toBeNull()
  })

  it('forma irreconhecivel -> recognized=false, item=null, recusa payload-shape-unrecognized', () => {
    const mapping = mapItemPayload({ foo: 1 }, PROVIDER)
    expect(mapping.recognized).toBe(false)
    expect(mapping.item).toBeNull()
    expect(mapping.rejections.map((r) => r.reason)).toContain('payload-shape-unrecognized')
  })

  it('ids.IMDb/ids.TMDB aninhados resolvem o ref (sem no-entity-id)', () => {
    const item = mapItemPayload(getItemEnvelope(), PROVIDER).item
    expect(item?.ref).toEqual({ imdbId: 'tt9603208', tmdbId: 575265 })
    expect(item?.rejections.map((r) => r.reason)).not.toContain('no-entity-id')
  })

  it('gera os drafts governados do payload real (sem reescalar)', () => {
    const item = mapItemPayload(getItemEnvelope(), PROVIDER).item
    expect(new Set(draftKeys(item))).toEqual(
      new Set([
        'imdb:audience',
        'rotten_tomatoes:audience',
        'rotten_tomatoes:critics',
        'metacritic:critics',
        'letterboxd:audience',
        'filmaffinity:audience',
      ]),
    )
    const imdb = item?.ratings.find((d) => d.ratingSource === 'imdb')
    expect(imdb).toMatchObject({ ratingValue: 7.1, ratingScale: 10, ratingLabel: 'IMDb' })
    const rtCritics = item?.ratings.find(
      (d) => d.ratingSource === 'rotten_tomatoes' && d.metric === 'critics',
    )
    expect(rtCritics).toMatchObject({ ratingValue: 80, ratingScale: 100, ratingCount: 427 })
  })

  it('Metacritic AUDIENCE (base 10) e RECUSADO por escala — nunca reescalado (invariante 1)', () => {
    const item = mapItemPayload(getItemEnvelope(), PROVIDER).item
    expect(draftKeys(item)).not.toContain('metacritic:audience')
    expect(draftKeys(item)).toContain('metacritic:critics')
    expect(item?.rejections.map((r) => r.reason)).toContain('rating-validation-failed')
  })

  it('TMDB NUNCA vira external rating (fonte nao governada) -> unknown-rating-source', () => {
    const item = mapItemPayload(getItemEnvelope(), PROVIDER).item
    expect((item?.ratings ?? []).some((d) => (d.ratingSource as string) === 'tmdb')).toBe(false)
    expect(item?.rejections.map((r) => r.reason)).toContain('unknown-rating-source')
  })

  it('links[<fonte>] vira ratingUrl do draft daquela fonte', () => {
    const item = mapItemPayload(getItemEnvelope(), PROVIDER).item
    const imdb = item?.ratings.find((d) => d.ratingSource === 'imdb')
    expect(imdb?.ratingUrl).toBe('https://www.imdb.com/title/tt9603208')
    const rtCritics = item?.ratings.find(
      (d) => d.ratingSource === 'rotten_tomatoes' && d.metric === 'critics',
    )
    expect(rtCritics?.ratingUrl).toBe(
      'https://www.rottentomatoes.com/m/mission_impossible_the_final_reckoning',
    )
  })

  it('aceita o item cru { ratings/ids/links } passado direto (facilita teste)', () => {
    const raw = {
      ids: { IMDb: 'tt1' },
      ratings: { FilmAffinity: { audience: { rating: 7.6, bestValue: 10 } } },
      links: { FilmAffinity: 'https://www.filmaffinity.com/us/film1.html' },
    }
    const item = mapItemPayload(raw, PROVIDER).item
    expect(item?.ref).toEqual({ imdbId: 'tt1', tmdbId: null })
    const fa = item?.ratings.find((d) => d.ratingSource === 'filmaffinity')
    expect(fa).toMatchObject({ ratingValue: 7.6, ratingScale: 10 })
  })
})

describe('mapSingleItem — reusado por popular e por item', () => {
  it('objeto nao-item -> item-not-object; item valido -> drafts reconhecidos', () => {
    expect(mapSingleItem('x', 3, PROVIDER)).toMatchObject({
      index: 3,
      ref: null,
      ratings: [],
    })
    expect(mapSingleItem('x', 3, PROVIDER).rejections.map((r) => r.reason)).toContain(
      'item-not-object',
    )

    const ok = mapSingleItem(imdbDescriptorItem(), 0, PROVIDER)
    expect(ok.ratings[0]?.ratingSource).toBe('imdb')
    expect(ok.rejections).toHaveLength(0)
  })
})
