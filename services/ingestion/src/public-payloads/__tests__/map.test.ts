/**
 * Contract tests dos payloads publicos (PURO: fixtures, sem banco, sem rede).
 *
 * O que se prova aqui e a GOVERNANCA do contrato, nao so o mapeamento:
 *  - midia bloqueada (displayAllowed=false) NUNCA chega ao payload — nem quando
 *    tem o maior voto (o caso que viraria poster se o fail-closed falhasse);
 *  - o file_path cru NUNCA vaza: toda URL de imagem e absoluta do CDN;
 *  - nenhum resquicio de tipo Prisma (BigInt/Decimal/Date) sobrevive a
 *    serializacao — o payload inteiro e JSON-safe;
 *  - nenhum campo de payload bruto do TMDB atravessa;
 *  - resultado de busca sem canonicalUrl e descartado (nunca link 404).
 */

import { describe, expect, it } from 'vitest'
import {
  mapCatalogStatus,
  mapDiscovery,
  mapEpisodeDetail,
  mapHome,
  mapMovieDetail,
  mapPersonDetail,
  mapSearch,
  mapSeasonDetail,
  mapTvDetail,
  toIsoDate,
  yearOf,
} from '../map.js'
import {
  CARDS_FIXTURE,
  DEAD_LETTER_FIXTURE,
  EPISODE_FIXTURE,
  FIXTURE_OPTIONS,
  MOVIE_FIXTURE,
  PERSON_FIXTURE,
  SEARCH_ROWS_FIXTURE,
  SEASON_FIXTURE,
  TV_FIXTURE,
} from './fixtures.js'

/** Percorre o payload inteiro e falha em qualquer valor nao-JSON-safe. */
function assertJsonSafe(value: unknown, path = '$'): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${path}: number nao finito`).toBe(true)
    return
  }
  expect(typeof value, `${path}: tipo nao serializavel (${typeof value})`).not.toBe('bigint')
  expect(typeof value, `${path}: funcao no payload`).not.toBe('function')
  expect(value instanceof Date, `${path}: Date cru no payload (serializar como string)`).toBe(false)
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertJsonSafe(item, `${path}[${i}]`))
    return
  }
  if (typeof value === 'object') {
    // Decimal do Prisma e objeto com toFixed; qualquer classe custom e suspeita.
    expect(Object.getPrototypeOf(value) === Object.prototype, `${path}: instancia de classe no payload`).toBe(true)
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertJsonSafe(child, `${path}.${key}`)
    }
  }
}

/** Nenhuma chave/valor de payload bruto do TMDB pode aparecer no contrato. */
function assertNoRawTmdb(payload: unknown): void {
  const text = JSON.stringify(payload)
  for (const marker of ['file_path', 'poster_path', 'backdrop_path', 'vote_average', 'tmdb_id', 'append_to_response']) {
    expect(text, `payload contem marcador de TMDB cru: ${marker}`).not.toContain(marker)
  }
}

describe('mapMovieDetail', () => {
  const payload = mapMovieDetail(MOVIE_FIXTURE, FIXTURE_OPTIONS)

  it('produz o contrato completo e validado', () => {
    expect(payload.kind).toBe('movie')
    expect(payload.title).toBe('Matrix')
    expect(payload.originalTitle).toBe('The Matrix')
    expect(payload.canonicalUrl).toBe('https://thescreen.media/pt/filmes/matrix/')
    expect(payload.releaseDate).toBe('1999-03-31')
    expect(payload.year).toBe(1999)
    expect(payload.collection?.kind).toBe('collection')
    expect(payload.collection?.canonicalUrl).toBeNull()
    expect(payload.seo.index).toBe(true)
  })

  it('midia bloqueada NUNCA entra — nem como poster de maior voto', () => {
    // A fixture tem um poster BLOQUEADO com voto 9.9 (maior que o liberado).
    expect(payload.media.poster?.url).toBe('https://image.tmdb.org/t/p/w500/poster-ok.jpg')
    const urls = payload.media.images.map((i) => i.url)
    expect(urls.some((u) => u.includes('bloqueado'))).toBe(false)
    expect(payload.media.videos.some((v) => v.key === 'blocked1')).toBe(false)
    // Todo asset que sobrou esta explicitamente liberado.
    for (const asset of payload.media.images) expect(asset.displayAllowed).toBe(true)
  })

  it('file_path invalido e descartado (nunca URL quebrada)', () => {
    const urls = payload.media.images.map((i) => i.url)
    expect(urls.some((u) => u.includes('..'))).toBe(false)
    // Toda URL e absoluta do CDN: o file_path cru nao vaza.
    for (const url of urls) expect(url).toMatch(/^https:\/\/image\.tmdb\.org\/t\/p\//)
  })

  it('video fora de YouTube/Vimeo entra SEM embed (invariante 8)', () => {
    const other = payload.media.videos.find((v) => v.site === 'DesconhecidoTube')
    expect(other).toBeDefined()
    expect(other?.embedUrl).toBeNull()
  })

  it('elenco ordenado por billing; pessoa sem slug vira link null (nunca 404)', () => {
    expect(payload.cast[0]?.person.title).toBe('Alice Primeira')
    expect(payload.cast[1]?.person.title).toBe('Beatriz Segunda')
    const semSlug = payload.cast.find((c) => c.person.title === 'Sem Slug Ainda')
    expect(semSlug?.person.canonicalUrl).toBeNull()
  })

  it('rating liberado atravessa com fonte/escala/atribuicao intactas', () => {
    expect(payload.ratings).toHaveLength(1)
    const rating = payload.ratings[0]
    expect(rating?.source).toBe('imdb')
    expect(rating?.scale).toBe(10)
    expect(rating?.attributionText).toContain('IMDb')
  })

  it('payload e JSON-safe e sem TMDB cru', () => {
    assertJsonSafe(payload)
    assertNoRawTmdb(payload)
  })
})

describe('mapTvDetail', () => {
  const payload = mapTvDetail(TV_FIXTURE, FIXTURE_OPTIONS)

  it('temporadas ordenadas (0=especiais primeiro) com rota composta', () => {
    expect(payload.seasons.map((s) => s.seasonNumber)).toEqual([0, 1, 2])
    expect(payload.seasons[1]?.canonicalUrl).toBe(
      'https://thescreen.media/pt/series/game-of-thrones/temporadas/1/',
    )
  })

  it('datas serializadas e contrato validado', () => {
    expect(payload.firstAirDate).toBe('2011-04-17')
    expect(payload.year).toBe(2011)
    assertJsonSafe(payload)
    assertNoRawTmdb(payload)
  })
})

describe('mapSeasonDetail', () => {
  const payload = mapSeasonDetail(SEASON_FIXTURE, FIXTURE_OPTIONS)

  it('episodios ordenados com URL composta serie+temporada+numero', () => {
    expect(payload.episodes.map((e) => e.episodeNumber)).toEqual([1, 2])
    expect(payload.episodes[0]?.canonicalUrl).toBe(
      'https://thescreen.media/pt/series/game-of-thrones/temporadas/1/episodios/1/',
    )
    expect(payload.series.kind).toBe('tv')
    assertJsonSafe(payload)
  })
})

describe('mapEpisodeDetail', () => {
  const payload = mapEpisodeDetail(EPISODE_FIXTURE, FIXTURE_OPTIONS)

  it('produz contrato completo com midia fail-closed', () => {
    expect(payload.canonicalUrl).toBe(
      'https://thescreen.media/pt/series/game-of-thrones/temporadas/1/episodios/1/',
    )
    expect(payload.media.videos.some((v) => v.key === 'blocked1')).toBe(false)
    assertJsonSafe(payload)
    assertNoRawTmdb(payload)
  })
})

describe('mapPersonDetail', () => {
  const payload = mapPersonDetail(PERSON_FIXTURE, FIXTURE_OPTIONS)

  it('biografia bloqueada e null; datas de vida serializadas', () => {
    expect(payload.biography).toBeNull()
    expect(payload.birthday).toBe('1964-09-02')
    expect(payload.deathday).toBeNull()
    assertJsonSafe(payload)
    assertNoRawTmdb(payload)
  })
})

describe('mapHome / mapDiscovery', () => {
  it('cards com poster do CDN e screen_score so quando liberado', () => {
    const home = mapHome(
      { hero: CARDS_FIXTURE.slice(0, 1), trending: CARDS_FIXTURE, upcoming: [] },
      FIXTURE_OPTIONS,
    )
    expect(home.trending[0]?.image?.url).toBe('https://image.tmdb.org/t/p/w500/poster-ok.jpg')
    expect(home.trending[0]?.screenScore).toBe(4.5)
    expect(home.trending[1]?.image).toBeNull()
    expect(home.trending[1]?.screenScore).toBeNull()
    assertJsonSafe(home)
    assertNoRawTmdb(home)
  })

  it('discovery serializa capturedAt como instante ISO', () => {
    const discovery = mapDiscovery(
      {
        listType: 'trending',
        entityType: 'movie',
        country: 'BR',
        capturedAt: new Date('2026-07-16T12:00:00.000Z'),
        items: CARDS_FIXTURE,
      },
      FIXTURE_OPTIONS,
    )
    expect(discovery.capturedAt).toBe('2026-07-16T12:00:00.000Z')
    expect(discovery.items).toHaveLength(2)
    assertJsonSafe(discovery)
  })
})

describe('mapSearch', () => {
  const payload = mapSearch(
    { query: 'matrix', rows: SEARCH_ROWS_FIXTURE, limit: 20, offset: 0 },
    FIXTURE_OPTIONS,
  )

  it('descarta resultado sem canonicalUrl (nunca link 404)', () => {
    expect(payload.results).toHaveLength(1)
    expect(payload.results[0]?.canonicalUrl).toBe('https://thescreen.media/pt/filmes/matrix/')
  })

  it('a superficie de busca NUNCA indexa', () => {
    expect(payload.index).toBe(false)
  })

  it('JSON-safe, sem TMDB cru', () => {
    assertJsonSafe(payload)
    assertNoRawTmdb(payload)
  })
})

describe('mapCatalogStatus', () => {
  const payload = mapCatalogStatus({
    counts: { pending: 3, dead_letter: 1 },
    deadLetter: DEAD_LETTER_FIXTURE,
  })

  it('contagens completas (estados ausentes viram 0) e amostra serializada', () => {
    expect(payload.counts.pending).toBe(3)
    expect(payload.counts.succeeded).toBe(0)
    expect(payload.deadLetter[0]?.lastErrorCode).toBe('upstream_5xx')
    assertJsonSafe(payload)
  })
})

describe('serializacao de datas', () => {
  it('toIsoDate/yearOf usam UTC (data de obra nunca desloca por fuso)', () => {
    const date = new Date('1999-12-31T23:00:00.000Z')
    expect(toIsoDate(date)).toBe('1999-12-31')
    expect(yearOf(date)).toBe(1999)
    expect(toIsoDate(null)).toBeNull()
    expect(yearOf(null)).toBeNull()
  })
})
