/**
 * normalize-recommendations.test.ts — O terceiro caso do mesmo padrao.
 *
 * `recommendations` e `similar` estao em MOVIE_APPEND e TV_APPEND desde sempre.
 * Chegavam em toda requisicao de detalhe, ja pagos em cota, e eram descartados —
 * como `watch/providers` (PR #181) e como a `biography` de pessoa.
 *
 * A consequencia foi visivel: "Mais como este" nasceu apoiado so em COLECAO (que
 * so filme tem), a serie ficou sem trilho nenhum, e a refutacao daquela decisao
 * — "o TMDB recommendations passar a ser persistido" — ja estava escrita na PR.
 */

import { describe, expect, it } from 'vitest'

import {
  collectRecommendations,
  normalizeRecommendations,
} from '../normalizers/recommendations.js'
import { normalizeMovie } from '../normalizers/movie.js'
import { normalizeTvShow } from '../normalizers/tv.js'

describe('normalizeRecommendations', () => {
  it('preserva a ORDEM do TMDB — ela E o sinal de forca', () => {
    const r = normalizeRecommendations(
      { results: [{ id: 11 }, { id: 22 }, { id: 33 }] },
      'recommendation',
      'movie',
      603,
    )
    expect(r.links.map((l) => [l.targetTmdbId, l.position])).toEqual([
      [11, 0],
      [22, 1],
      [33, 2],
    ])
  })

  it('AUSENCIA e results vazio sao estados DIFERENTES', () => {
    // `present:false` faz o replace-set nao rodar. Raw antigo cai aqui, e
    // le-lo como "lista vazia" apagaria o que ja foi coletado.
    expect(normalizeRecommendations(undefined, 'similar', 'movie', 1).present).toBe(false)
    expect(normalizeRecommendations(null, 'similar', 'movie', 1).present).toBe(false)
    expect(normalizeRecommendations({}, 'similar', 'movie', 1).present).toBe(false)
    expect(normalizeRecommendations({ results: [] }, 'similar', 'movie', 1).present).toBe(true)
  })

  it('NEGATIVO: um titulo nao se recomenda', () => {
    // O CHECK do banco tambem barra, mas barrar aqui evita que UMA linha
    // invalida aborte a transacao inteira do upsert do titulo.
    const r = normalizeRecommendations(
      { results: [{ id: 603 }, { id: 604 }] },
      'recommendation',
      'movie',
      603,
    )
    expect(r.links.map((l) => l.targetTmdbId)).toEqual([604])
  })

  it('NEGATIVO: `media_type` que nao e titulo NAO vira titulo por default', () => {
    // Presumir o fallback aqui transformaria uma pessoa num filme.
    const r = normalizeRecommendations(
      { results: [{ id: 1, media_type: 'person' }, { id: 2, media_type: 'collection' }, { id: 3, media_type: 'tv' }] },
      'recommendation',
      'movie',
      99,
    )
    expect(r.links.map((l) => [l.targetTmdbId, l.targetMediaType])).toEqual([[3, 'tv']])
  })

  it('`media_type` ausente herda o tipo da ORIGEM (endpoint de tipo unico)', () => {
    const r = normalizeRecommendations({ results: [{ id: 7 }] }, 'similar', 'tv', 1)
    expect(r.links[0]!.targetMediaType).toBe('tv')
  })

  it('duplicata entra UMA vez, e sem buraco na ordem', () => {
    const r = normalizeRecommendations(
      { results: [{ id: 5 }, { id: 5 }, { id: 'x' }, { id: 6 }] },
      'recommendation',
      'movie',
      1,
    )
    expect(r.links.map((l) => [l.targetTmdbId, l.position])).toEqual([
      [5, 0],
      [6, 1],
    ])
  })
})

describe('collectRecommendations junta os dois blocos', () => {
  it('`recommendation` vem ANTES de `similar` — qualidades diferentes de parentesco', () => {
    const r = collectRecommendations(
      { id: 1, recommendations: { results: [{ id: 10 }] }, similar: { results: [{ id: 20 }] } },
      'movie',
    )
    expect(r.links.map((l) => [l.kind, l.targetTmdbId])).toEqual([
      ['recommendation', 10],
      ['similar', 20],
    ])
  })

  it('UM bloco basta para `present`; NENHUM deixa false', () => {
    expect(collectRecommendations({ id: 1, similar: { results: [] } }, 'movie').present).toBe(true)
    expect(collectRecommendations({ id: 1 }, 'movie').present).toBe(false)
  })
})

describe('os detalhes param de descartar o bloco', () => {
  it('FILME: le recommendations e similar', () => {
    const n = normalizeMovie({
      id: 603,
      original_title: 'The Matrix',
      recommendations: { results: [{ id: 604 }] },
      similar: { results: [{ id: 605 }] },
    } as never)
    expect(n.recommendationsPresent).toBe(true)
    expect(n.recommendations.map((l) => l.targetTmdbId)).toEqual([604, 605])
  })

  it('SERIE: le recommendations e similar — o sinal que faltava a vertical', () => {
    const n = normalizeTvShow({
      id: 1399,
      original_name: 'Game of Thrones',
      recommendations: { results: [{ id: 1400 }] },
    } as never)
    expect(n.recommendationsPresent).toBe(true)
    expect(n.recommendations.map((l) => l.targetTmdbId)).toEqual([1400])
  })

  it('NEGATIVO: payload sem os blocos nao afirma lista vazia (raw antigo)', () => {
    expect(normalizeMovie({ id: 1, original_title: 'x' } as never).recommendationsPresent).toBe(false)
    expect(normalizeTvShow({ id: 1, original_name: 'x' } as never).recommendationsPresent).toBe(false)
  })
})
