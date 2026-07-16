/**
 * normalize.test.ts — Cobertura dos normalizadores puros de episodio (Backend A §7).
 *
 * Foco: nada entra sem id de pessoa valido; guest star sai marcada e deduplicada;
 * imdb_id fora da forma 'ttNNNN' e descartado; still sem file_path some; payload
 * invalido nunca explode (retorna []).
 */

import { describe, expect, it } from 'vitest'
import {
  extractEpisodeCast,
  extractEpisodeCrew,
  extractEpisodeExternalIds,
  extractEpisodeGuestStars,
  extractEpisodeStills,
} from '../normalize.js'

/** Payloads que nunca podem derrubar um extrator. */
const INVALID_PAYLOADS: readonly unknown[] = [null, undefined, 42, 'texto', [], {}]

describe('extractEpisodeCast', () => {
  it('normaliza credits.cast com isGuest=false', () => {
    const rows = extractEpisodeCast({
      credits: {
        cast: [
          { id: 11, name: 'Bryan Cranston', character: 'Walter White', order: 0, credit_id: 'c1' },
          { id: 22, name: 'Aaron Paul', character: 'Jesse Pinkman', order: 1, credit_id: 'c2' },
        ],
      },
    })

    expect(rows).toEqual([
      {
        personTmdbId: 11,
        name: 'Bryan Cranston',
        character: 'Walter White',
        billingOrder: 0,
        creditId: 'c1',
        isGuest: false,
      },
      {
        personTmdbId: 22,
        name: 'Aaron Paul',
        character: 'Jesse Pinkman',
        billingOrder: 1,
        creditId: 'c2',
        isGuest: false,
      },
    ])
  })

  it('descarta entradas sem id de pessoa inteiro positivo ou sem nome', () => {
    const rows = extractEpisodeCast({
      credits: {
        cast: [
          { id: 0, name: 'Id zero' },
          { id: -5, name: 'Id negativo' },
          { id: 1.5, name: 'Id fracionario' },
          { id: '7', name: 'Id string' },
          { name: 'Sem id' },
          { id: 9, name: '   ' },
          { id: 10 },
          'nao e objeto',
          null,
          { id: 12, name: 'Valido' },
        ],
      },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.personTmdbId).toBe(12)
  })

  it('deduplica por creditId quando presente e por pessoa quando ausente', () => {
    const byCreditId = extractEpisodeCast({
      credits: {
        cast: [
          { id: 11, name: 'Repetido', credit_id: 'c1' },
          { id: 99, name: 'Mesmo credito, outra pessoa', credit_id: 'c1' },
        ],
      },
    })
    expect(byCreditId).toHaveLength(1)

    const byPerson = extractEpisodeCast({
      credits: {
        cast: [
          { id: 11, name: 'Sem credito' },
          { id: 11, name: 'Sem credito de novo' },
        ],
      },
    })
    expect(byPerson).toHaveLength(1)
  })

  it('normaliza campos opcionais ausentes/vazios para null', () => {
    const rows = extractEpisodeCast({ credits: { cast: [{ id: 11, name: 'Sem extras' }] } })

    expect(rows[0]).toEqual({
      personTmdbId: 11,
      name: 'Sem extras',
      character: null,
      billingOrder: null,
      creditId: null,
      isGuest: false,
    })
  })

  it('retorna [] para payload invalido ou sem credits', () => {
    for (const payload of INVALID_PAYLOADS) {
      expect(extractEpisodeCast(payload)).toEqual([])
    }
    expect(extractEpisodeCast({ credits: { cast: 'nao e array' } })).toEqual([])
  })
})

describe('extractEpisodeGuestStars', () => {
  it('marca isGuest=true a partir de guest_stars no topo', () => {
    const rows = extractEpisodeGuestStars({
      guest_stars: [
        { id: 33, name: 'Danny Trejo', character: 'Tortuga', order: 3, credit_id: 'g1' },
      ],
    })

    expect(rows).toEqual([
      {
        personTmdbId: 33,
        name: 'Danny Trejo',
        character: 'Tortuga',
        billingOrder: 3,
        creditId: 'g1',
        isGuest: true,
      },
    ])
  })

  it('le tambem credits.guest_stars (detalhe do episodio)', () => {
    const rows = extractEpisodeGuestStars({
      credits: { guest_stars: [{ id: 44, name: 'Jonathan Banks' }] },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.personTmdbId).toBe(44)
    expect(rows[0]?.isGuest).toBe(true)
  })

  it('deduplica por pessoa quando guest_stars e credits.guest_stars se sobrepoem', () => {
    const rows = extractEpisodeGuestStars({
      guest_stars: [{ id: 33, name: 'Danny Trejo', credit_id: 'g1' }],
      credits: {
        guest_stars: [
          { id: 33, name: 'Danny Trejo', credit_id: 'g2' },
          { id: 44, name: 'Jonathan Banks', credit_id: 'g3' },
        ],
      },
    })

    expect(rows.map((row) => row.personTmdbId)).toEqual([33, 44])
    expect(rows.every((row) => row.isGuest)).toBe(true)
  })

  it('nunca colide com o elenco regular: cast e guest sao listas separadas', () => {
    const payload = {
      credits: { cast: [{ id: 11, name: 'Regular' }] },
      guest_stars: [{ id: 33, name: 'Convidado' }],
    }

    expect(extractEpisodeCast(payload).map((row) => row.isGuest)).toEqual([false])
    expect(extractEpisodeGuestStars(payload).map((row) => row.isGuest)).toEqual([true])
  })

  it('retorna [] para payload invalido', () => {
    for (const payload of INVALID_PAYLOADS) {
      expect(extractEpisodeGuestStars(payload)).toEqual([])
    }
  })
})

describe('extractEpisodeCrew', () => {
  it('normaliza credits.crew', () => {
    const rows = extractEpisodeCrew({
      credits: {
        crew: [
          {
            id: 55,
            name: 'Vince Gilligan',
            department: 'Directing',
            job: 'Director',
            credit_id: 'k1',
          },
        ],
      },
    })

    expect(rows).toEqual([
      {
        personTmdbId: 55,
        name: 'Vince Gilligan',
        department: 'Directing',
        job: 'Director',
        creditId: 'k1',
      },
    ])
  })

  it('preserva a mesma pessoa em funcoes diferentes', () => {
    const rows = extractEpisodeCrew({
      credits: {
        crew: [
          { id: 55, name: 'Vince Gilligan', department: 'Directing', job: 'Director' },
          { id: 55, name: 'Vince Gilligan', department: 'Writing', job: 'Writer' },
        ],
      },
    })

    expect(rows).toHaveLength(2)
  })

  it('deduplica linhas identicas', () => {
    const rows = extractEpisodeCrew({
      credits: {
        crew: [
          { id: 55, name: 'Gilligan', department: 'Directing', job: 'Director', credit_id: 'k1' },
          { id: 55, name: 'Gilligan', department: 'Directing', job: 'Director', credit_id: 'k1' },
        ],
      },
    })

    expect(rows).toHaveLength(1)
  })

  it('descarta entradas sem id de pessoa ou sem nome', () => {
    const rows = extractEpisodeCrew({
      credits: { crew: [{ id: 0, name: 'Invalido' }, { name: 'Sem id' }, { id: 55, name: '' }] },
    })

    expect(rows).toEqual([])
  })

  it('retorna [] para payload invalido', () => {
    for (const payload of INVALID_PAYLOADS) {
      expect(extractEpisodeCrew(payload)).toEqual([])
    }
  })
})

describe('extractEpisodeExternalIds', () => {
  it('aceita imdb_id na forma ttNNNN', () => {
    const rows = extractEpisodeExternalIds({ external_ids: { imdb_id: 'tt0959621' } })

    expect(rows).toEqual([{ source: 'imdb', externalId: 'tt0959621' }])
  })

  it('descarta imdb_id fora da forma ttNNNN', () => {
    const invalidImdbIds = ['123', 'tt', 'nm0000123', 'TT0959621', 'tt12a34', '', '   ', 42, null]
    for (const imdbId of invalidImdbIds) {
      expect(extractEpisodeExternalIds({ external_ids: { imdb_id: imdbId } })).toEqual([])
    }
  })

  it('grava tvdb_id como string quando e inteiro positivo', () => {
    const rows = extractEpisodeExternalIds({ external_ids: { tvdb_id: 349232 } })

    expect(rows).toEqual([{ source: 'tvdb', externalId: '349232' }])
  })

  it('descarta tvdb_id nao inteiro positivo', () => {
    for (const tvdbId of [0, -1, 1.5, '349232', null]) {
      expect(extractEpisodeExternalIds({ external_ids: { tvdb_id: tvdbId } })).toEqual([])
    }
  })

  it('retorna imdb e tvdb juntos quando ambos sao validos', () => {
    const rows = extractEpisodeExternalIds({
      external_ids: { imdb_id: 'tt0959621', tvdb_id: 349232 },
    })

    expect(rows).toEqual([
      { source: 'imdb', externalId: 'tt0959621' },
      { source: 'tvdb', externalId: '349232' },
    ])
  })

  it('retorna [] para payload invalido ou sem external_ids', () => {
    for (const payload of INVALID_PAYLOADS) {
      expect(extractEpisodeExternalIds(payload)).toEqual([])
    }
    expect(extractEpisodeExternalIds({ external_ids: {} })).toEqual([])
  })
})

describe('extractEpisodeStills', () => {
  it('normaliza images.stills', () => {
    const rows = extractEpisodeStills({
      images: {
        stills: [
          {
            file_path: '/still1.jpg',
            iso_639_1: 'en',
            width: 1920,
            height: 1080,
            aspect_ratio: 1.778,
            vote_average: 5.3,
            vote_count: 2,
          },
        ],
      },
    })

    expect(rows).toEqual([
      {
        filePath: '/still1.jpg',
        languageCode: 'en',
        width: 1920,
        height: 1080,
        aspectRatio: 1.778,
        voteAverage: 5.3,
        voteCount: 2,
      },
    ])
  })

  it('descarta stills sem file_path', () => {
    const rows = extractEpisodeStills({
      images: {
        stills: [
          { iso_639_1: 'en', width: 1920 },
          { file_path: '', width: 1920 },
          { file_path: '   ' },
          { file_path: 42 },
          null,
          { file_path: '/valido.jpg' },
        ],
      },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.filePath).toBe('/valido.jpg')
  })

  it('deduplica pelo file_path', () => {
    const rows = extractEpisodeStills({
      images: { stills: [{ file_path: '/a.jpg' }, { file_path: '/a.jpg' }] },
    })

    expect(rows).toHaveLength(1)
  })

  it('normaliza metadados ausentes/invalidos para null', () => {
    const rows = extractEpisodeStills({
      images: { stills: [{ file_path: '/a.jpg', iso_639_1: null, width: '1920' }] },
    })

    expect(rows[0]).toEqual({
      filePath: '/a.jpg',
      languageCode: null,
      width: null,
      height: null,
      aspectRatio: null,
      voteAverage: null,
      voteCount: null,
    })
  })

  it('retorna [] para payload invalido ou sem images', () => {
    for (const payload of INVALID_PAYLOADS) {
      expect(extractEpisodeStills(payload)).toEqual([])
    }
    expect(extractEpisodeStills({ images: { stills: 'nao e array' } })).toEqual([])
  })
})
