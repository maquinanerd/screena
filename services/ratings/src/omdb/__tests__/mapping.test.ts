/**
 * mapping.test.ts — Reconhecedor do payload da OMDb.
 *
 * O que este arquivo prova, em ordem de importancia:
 *  1. TRES fontes, nao uma — o payload rende tres linhas com tres
 *     `rating_source` distintos, e nenhuma e creditada a "omdb";
 *  2. `Response: "False"` com HTTP 200 NAO vira sucesso nem "0 notas";
 *  3. `Source` desconhecido nao vira nota e o valor BRUTO vai para o log;
 *  4. linkback so existe para o IMDb, e nenhuma URL e inventada para RT/MC.
 */

import { RATING_SCALES } from '@screena/config'
import { OMDB_PROVIDER_API } from '@screena/omdb-client'
import { describe, expect, it } from 'vitest'

import { mapOmdbPayload } from '../mapping.js'
import { assertFixtureIntact, OMDB_ERROR_PAYLOAD, OMDB_GUARDIANS_PAYLOAD } from './fixture.js'

/** Guarda: toda suite que usa a fixture confere que ela ainda e valida. */
function payload(): Record<string, unknown> {
  assertFixtureIntact(OMDB_GUARDIANS_PAYLOAD)
  return structuredClone(OMDB_GUARDIANS_PAYLOAD) as unknown as Record<string, unknown>
}

const PROVIDER = OMDB_PROVIDER_API

describe('mapOmdbPayload — tres fontes editoriais, nunca uma', () => {
  it('um payload rende TRES notas, uma por fonte', () => {
    const mapping = mapOmdbPayload(payload(), PROVIDER)
    expect(mapping.recognized).toBe(true)
    expect(mapping.ratings).toHaveLength(3)
    expect(mapping.ratings.map((r) => r.ratingSource).sort()).toEqual([
      'imdb',
      'metacritic',
      'rotten_tomatoes',
    ])
  })

  it('NENHUMA nota e creditada ao fornecedor tecnico "omdb"', () => {
    const mapping = mapOmdbPayload(payload(), PROVIDER)
    for (const rating of mapping.ratings) {
      expect(rating.ratingSource).not.toBe('omdb')
      expect(rating.ratingLabel.toLowerCase()).not.toContain('omdb')
    }
  })

  it('cada fonte fica na SUA escala canonica — nada e reescalado', () => {
    const mapping = mapOmdbPayload(payload(), PROVIDER)
    const bySource = new Map(mapping.ratings.map((r) => [r.ratingSource, r]))

    expect(bySource.get('imdb')).toMatchObject({
      ratingValue: 7.6,
      ratingScale: RATING_SCALES.imdb,
    })
    expect(bySource.get('rotten_tomatoes')).toMatchObject({
      ratingValue: 85,
      ratingScale: RATING_SCALES.rotten_tomatoes,
    })
    expect(bySource.get('metacritic')).toMatchObject({
      ratingValue: 67,
      ratingScale: RATING_SCALES.metacritic,
    })
  })

  it('classifica a natureza: IMDb e publico; RT e Metacritic sao critica', () => {
    const mapping = mapOmdbPayload(payload(), PROVIDER)
    const bySource = new Map(mapping.ratings.map((r) => [r.ratingSource, r]))

    expect(bySource.get('imdb')?.scoreType).toBe('audience')
    expect(bySource.get('rotten_tomatoes')?.scoreType).toBe('critics')
    expect(bySource.get('metacritic')?.scoreType).toBe('critics')
  })

  it('o rotulo vem da fonte canonica, nunca do payload (anti cross-label)', () => {
    const mapping = mapOmdbPayload(payload(), PROVIDER)
    const bySource = new Map(mapping.ratings.map((r) => [r.ratingSource, r]))

    expect(bySource.get('imdb')?.ratingLabel).toBe('IMDb')
    expect(bySource.get('rotten_tomatoes')?.ratingLabel).toBe('Rotten Tomatoes')
    expect(bySource.get('metacritic')?.ratingLabel).toBe('Metacritic')
    // Nenhum "Tomatometer" atribuido ao IMDb — impossivel por construcao.
    expect(bySource.get('imdb')?.ratingLabel.toLowerCase()).not.toContain('tomato')
  })

  it('a fixture intacta nao produz recusa nenhuma', () => {
    const mapping = mapOmdbPayload(payload(), PROVIDER)
    expect(mapping.rejections).toEqual([])
  })
})

describe('mapOmdbPayload — linkback: so o IMDb tem URL derivavel', () => {
  it('IMDb ganha a URL canonica montada a partir do imdbID do payload', () => {
    const mapping = mapOmdbPayload(payload(), PROVIDER)
    const imdb = mapping.ratings.find((r) => r.ratingSource === 'imdb')
    expect(imdb?.ratingUrl).toBe('https://www.imdb.com/title/tt3896198/')
  })

  it('Rotten Tomatoes e Metacritic ficam com ratingUrl NULL — nada e inventado', () => {
    const mapping = mapOmdbPayload(payload(), PROVIDER)
    const rt = mapping.ratings.find((r) => r.ratingSource === 'rotten_tomatoes')
    const mc = mapping.ratings.find((r) => r.ratingSource === 'metacritic')
    expect(rt?.ratingUrl).toBeNull()
    expect(mc?.ratingUrl).toBeNull()
  })

  it('sem imdbID valido, nem o IMDb ganha URL (e a entidade e recusada)', () => {
    const broken = payload()
    broken['imdbID'] = 'nao-e-um-id'
    const mapping = mapOmdbPayload(broken, PROVIDER)
    const imdb = mapping.ratings.find((r) => r.ratingSource === 'imdb')
    expect(imdb?.ratingUrl).toBeNull()
    expect(mapping.rejections.map((r) => r.reason)).toContain('no-entity-id')
  })
})

describe('mapOmdbPayload — Response: "False" chega com HTTP 200', () => {
  it('NAO e sucesso: recusa explicita com o motivo', () => {
    const mapping = mapOmdbPayload(OMDB_ERROR_PAYLOAD, PROVIDER)
    expect(mapping.recognized).toBe(false)
    expect(mapping.ratings).toEqual([])
    expect(mapping.rejections).toHaveLength(1)
    expect(mapping.rejections[0]?.reason).toBe('omdb-error-response')
  })

  it('o campo Error da OMDb entra no detalhe (o operador precisa dele)', () => {
    const mapping = mapOmdbPayload(OMDB_ERROR_PAYLOAD, PROVIDER)
    expect(mapping.rejections[0]?.detail).toContain('Incorrect IMDb ID.')
  })

  it('Response=False sem campo Error ainda assim recusa, e diz que faltou', () => {
    const mapping = mapOmdbPayload({ Response: 'False' }, PROVIDER)
    expect(mapping.rejections[0]?.reason).toBe('omdb-error-response')
    expect(mapping.rejections[0]?.detail).toContain('sem campo Error')
  })

  it('FAIL-CLOSED: Response de tipo inesperado e tratado como erro', () => {
    for (const bogus of [0, 1, {}, [], 'maybe']) {
      const mapping = mapOmdbPayload({ Response: bogus, Ratings: [] }, PROVIDER)
      expect(mapping.rejections[0]?.reason, `Response=${JSON.stringify(bogus)}`).toBe(
        'omdb-error-response',
      )
    }
  })

  it('um payload de erro NUNCA grava nota, mesmo trazendo um array Ratings', () => {
    // Caso adversarial: erro no envelope, dado no corpo. O envelope vence.
    const mapping = mapOmdbPayload(
      {
        Response: 'False',
        Error: 'Request limit reached!',
        Ratings: [{ Source: 'Internet Movie Database', Value: '9.9/10' }],
        imdbID: 'tt3896198',
      },
      PROVIDER,
    )
    expect(mapping.ratings).toEqual([])
  })
})

describe('mapOmdbPayload — Source desconhecido nunca vira nota', () => {
  it('recusa a fonte e carrega o valor BRUTO no detalhe', () => {
    const extended = payload()
    ;(extended['Ratings'] as unknown[]).push({ Source: 'Letterboxd', Value: '4.2/5' })

    const mapping = mapOmdbPayload(extended, PROVIDER)
    expect(mapping.ratings).toHaveLength(3) // continua so as tres conhecidas
    const rejection = mapping.rejections.find((r) => r.reason === 'unrecognized-source')
    expect(rejection).toBeDefined()
    expect(rejection?.detail).toContain('Letterboxd')
  })

  it('aponta onde estender o reconhecedor (o detalhe e acionavel)', () => {
    const mapping = mapOmdbPayload(
      { Response: 'True', imdbID: 'tt3896198', Ratings: [{ Source: 'TMDB', Value: '7/10' }] },
      PROVIDER,
    )
    const rejection = mapping.rejections.find((r) => r.reason === 'unrecognized-source')
    expect(rejection?.detail).toContain('sources.ts')
  })

  it('nao chuta por semelhanca: "Rotten Tomatoes Audience" nao e Rotten Tomatoes', () => {
    const mapping = mapOmdbPayload(
      {
        Response: 'True',
        imdbID: 'tt3896198',
        Ratings: [{ Source: 'Rotten Tomatoes Audience', Value: '90%' }],
      },
      PROVIDER,
    )
    expect(mapping.ratings).toEqual([])
    expect(mapping.rejections.map((r) => r.reason)).toContain('unrecognized-source')
  })

  it('reconhece variacao inocente de caixa/espaco da MESMA fonte', () => {
    const mapping = mapOmdbPayload(
      {
        Response: 'True',
        imdbID: 'tt3896198',
        Ratings: [{ Source: '  internet   movie database ', Value: '7.6/10' }],
      },
      PROVIDER,
    )
    expect(mapping.ratings).toHaveLength(1)
    expect(mapping.ratings[0]?.ratingSource).toBe('imdb')
  })
})

describe('mapOmdbPayload — escala divergente e recusa, nunca conversao', () => {
  it('IMDb entregue como percentual e recusado por scale-mismatch', () => {
    const bogus = payload()
    ;(bogus['Ratings'] as Record<string, unknown>[])[0]!['Value'] = '76%'

    const mapping = mapOmdbPayload(bogus, PROVIDER)
    expect(mapping.ratings.map((r) => r.ratingSource)).not.toContain('imdb')
    const rejection = mapping.rejections.find((r) => r.reason === 'scale-mismatch')
    expect(rejection?.detail).toContain('imdb')
    expect(rejection?.detail).toContain('nunca reescalamos')
  })

  it('as outras duas fontes do mesmo payload continuam entrando', () => {
    const bogus = payload()
    ;(bogus['Ratings'] as Record<string, unknown>[])[0]!['Value'] = '76%'

    const mapping = mapOmdbPayload(bogus, PROVIDER)
    expect(mapping.ratings.map((r) => r.ratingSource).sort()).toEqual([
      'metacritic',
      'rotten_tomatoes',
    ])
  })
})

describe('mapOmdbPayload — outras recusas', () => {
  it('Value "N/A" recusa aquela fonte e preserva as demais', () => {
    const partial = payload()
    ;(partial['Ratings'] as Record<string, unknown>[])[1]!['Value'] = 'N/A'

    const mapping = mapOmdbPayload(partial, PROVIDER)
    expect(mapping.ratings).toHaveLength(2)
    expect(mapping.ratings.map((r) => r.ratingSource)).not.toContain('rotten_tomatoes')
    const rejection = mapping.rejections.find((r) => r.reason === 'invalid-value')
    expect(rejection?.detail).toContain('rotten_tomatoes')
    expect(rejection?.detail).toContain('not-available')
  })

  it('fonte repetida e recusada (colidiria no unique da tabela)', () => {
    const duplicated = payload()
    ;(duplicated['Ratings'] as unknown[]).push({
      Source: 'Internet Movie Database',
      Value: '9.9/10',
    })

    const mapping = mapOmdbPayload(duplicated, PROVIDER)
    expect(mapping.ratings.filter((r) => r.ratingSource === 'imdb')).toHaveLength(1)
    // A PRIMEIRA ocorrencia prevalece — nunca a ultima em silencio.
    expect(mapping.ratings.find((r) => r.ratingSource === 'imdb')?.ratingValue).toBe(7.6)
    expect(mapping.rejections.map((r) => r.reason)).toContain('duplicate-source')
  })

  it('elemento nao-objeto em Ratings[] e recusado sem derrubar o resto', () => {
    const dirty = payload()
    ;(dirty['Ratings'] as unknown[]).push('lixo')

    const mapping = mapOmdbPayload(dirty, PROVIDER)
    expect(mapping.ratings).toHaveLength(3)
    expect(mapping.rejections.map((r) => r.reason)).toContain('descriptor-not-object')
  })

  it('Ratings ausente recusa com no-rating-descriptors, sem lancar', () => {
    const mapping = mapOmdbPayload({ Response: 'True', imdbID: 'tt3896198' }, PROVIDER)
    expect(mapping.ratings).toEqual([])
    expect(mapping.rejections.map((r) => r.reason)).toContain('no-rating-descriptors')
  })

  it('payload que nem e objeto recusa com payload-shape-unrecognized', () => {
    for (const bogus of ['texto', 42, null, []]) {
      const mapping = mapOmdbPayload(bogus, PROVIDER)
      expect(mapping.recognized).toBe(false)
      expect(mapping.rejections[0]?.reason).toBe('payload-shape-unrecognized')
    }
  })

  it('nunca lanca, para qualquer entrada', () => {
    const inputs: readonly unknown[] = [
      undefined,
      null,
      0,
      '',
      [],
      {},
      { Ratings: null },
      { Response: 'True', Ratings: [null, undefined, 0] },
    ]
    for (const input of inputs) {
      expect(() => mapOmdbPayload(input, PROVIDER)).not.toThrow()
    }
  })
})

describe('mapOmdbPayload — verificacao cruzada dos campos redundantes', () => {
  it('concordancia (a fixture real) nao gera recusa', () => {
    const mapping = mapOmdbPayload(payload(), PROVIDER)
    expect(mapping.rejections.map((r) => r.reason)).not.toContain('redundant-field-divergence')
  })

  it('imdbRating divergente do array e REGISTRADO, nunca escolhido em silencio', () => {
    const divergent = payload()
    divergent['imdbRating'] = '9.1'

    const mapping = mapOmdbPayload(divergent, PROVIDER)
    const rejection = mapping.rejections.find((r) => r.reason === 'redundant-field-divergence')
    expect(rejection).toBeDefined()
    expect(rejection?.detail).toContain('imdbRating')
    // O ARRAY e a fonte unica e prevalece.
    expect(mapping.ratings.find((r) => r.ratingSource === 'imdb')?.ratingValue).toBe(7.6)
  })

  it('Metascore divergente do array tambem e registrado', () => {
    const divergent = payload()
    divergent['Metascore'] = '42'

    const mapping = mapOmdbPayload(divergent, PROVIDER)
    const rejection = mapping.rejections.find((r) => r.reason === 'redundant-field-divergence')
    expect(rejection?.detail).toContain('Metascore')
    expect(mapping.ratings.find((r) => r.ratingSource === 'metacritic')?.ratingValue).toBe(67)
  })

  it('campo redundante "N/A" nao e divergencia (nao ha o que comparar)', () => {
    const partial = payload()
    partial['Metascore'] = 'N/A'

    const mapping = mapOmdbPayload(partial, PROVIDER)
    expect(mapping.rejections.map((r) => r.reason)).not.toContain('redundant-field-divergence')
  })
})
