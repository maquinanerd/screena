/**
 * Testes puros do presenter da busca publica tecnica (/pt/busca).
 *
 * Garantem que a busca nao inventa destino (linha sem canonical utilizavel ou
 * com entity_type desconhecido fica de fora), que o href e sempre interno, que
 * a imagem sai do helper governado do TMDB e que os sinais de estado da view
 * (isEmptyQuery / hasMore) refletem a realidade da consulta.
 *
 * NOTA DE LOCALIZACAO: mora em `tests/web/` (e nao co-locado em
 * `apps/web/src/lib/__tests__/`) porque o `include` do vitest.config.ts raiz
 * cobre tests, packages, api-clients e services — nunca apps. Um teste sob
 * apps/web jamais seria coletado por `pnpm test`.
 */

import { describe, expect, it } from 'vitest'

import {
  buildSearchPageView,
  buildSearchResult,
  toInternalHref,
  type SearchRowInput,
} from '../../apps/web/src/lib/search-presenter'

function row(overrides: Partial<SearchRowInput> = {}): SearchRowInput {
  return {
    entityType: 'movie',
    entityId: '1',
    title: 'Matrix',
    subtitle: 'Filme · 1999',
    year: 1999,
    imagePath: null,
    canonicalUrl: '/pt/filmes/matrix/',
    matchReason: 'exact',
    score: 1,
    ...overrides,
  }
}

describe('buildSearchPageView', () => {
  it('descarta linha sem canonicalUrl (nunca linka pagina inexistente)', () => {
    const view = buildSearchPageView({
      query: 'matrix',
      rows: [
        row({ entityId: '1' }),
        row({ entityId: '2', canonicalUrl: null }),
        row({ entityId: '3', canonicalUrl: '   ' }),
      ],
      limit: 20,
      offset: 0,
    })

    expect(view.results.map((r) => r.entityId)).toEqual(['1'])
    expect(view.total).toBe(1)
  })

  it('descarta entity_type desconhecido', () => {
    const view = buildSearchPageView({
      query: 'matrix',
      rows: [
        row({ entityId: '1', entityType: 'season' }),
        row({ entityId: '2', entityType: 'tv' }),
      ],
      limit: 20,
      offset: 0,
    })

    expect(view.results.map((r) => r.entityId)).toEqual(['2'])
    expect(view.results[0]?.kind).toBe('tv')
  })

  it('marca isEmptyQuery quando o termo e vazio ou so espacos', () => {
    for (const query of ['', '   ', '\n\t']) {
      const view = buildSearchPageView({ query, rows: [], limit: 20, offset: 0 })
      expect(view.isEmptyQuery).toBe(true)
      expect(view.query).toBe('')
      expect(view.results).toEqual([])
    }

    const filled = buildSearchPageView({ query: '  matrix  ', rows: [], limit: 20, offset: 0 })
    expect(filled.isEmptyQuery).toBe(false)
    expect(filled.query).toBe('matrix')
  })

  it('hasMore quando o banco devolveu uma pagina cheia', () => {
    const rows = [row({ entityId: '1' }), row({ entityId: '2' })]

    expect(buildSearchPageView({ query: 'm', rows, limit: 2, offset: 0 }).hasMore).toBe(true)
    expect(buildSearchPageView({ query: 'm', rows, limit: 3, offset: 0 }).hasMore).toBe(false)
  })

  it('hasMore olha as linhas recebidas, nao as exibidas (descarte nao encerra pagina)', () => {
    const view = buildSearchPageView({
      query: 'm',
      rows: [row({ entityId: '1' }), row({ entityId: '2', canonicalUrl: null })],
      limit: 2,
      offset: 0,
    })

    expect(view.results).toHaveLength(1)
    expect(view.hasMore).toBe(true)
  })

  it('propaga limit/offset na view', () => {
    const view = buildSearchPageView({ query: 'm', rows: [], limit: 10, offset: 40 })
    expect(view.limit).toBe(10)
    expect(view.offset).toBe(40)
  })
})

describe('buildSearchResult', () => {
  it('monta imageUrl remota do TMDB a partir do file_path cru', () => {
    const result = buildSearchResult(row({ imagePath: '/abc123.jpg' }))
    expect(result?.imageUrl).toBe('https://image.tmdb.org/t/p/w300/abc123.jpg')
  })

  it('imageUrl null quando nao ha file_path ou o path e invalido', () => {
    expect(buildSearchResult(row({ imagePath: null }))?.imageUrl).toBeNull()
    expect(buildSearchResult(row({ imagePath: '/media/local.jpg' }))?.imageUrl).toBeNull()
    expect(buildSearchResult(row({ imagePath: '../secret.jpg' }))?.imageUrl).toBeNull()
  })

  it('normaliza campos e preserva match/score', () => {
    const result = buildSearchResult(
      row({ title: '  Matrix  ', subtitle: '   ', year: 0, matchReason: 'fuzzy', score: 0.62 }),
    )

    expect(result?.title).toBe('Matrix')
    expect(result?.subtitle).toBeNull()
    expect(result?.year).toBeNull()
    expect(result?.matchReason).toBe('fuzzy')
    expect(result?.score).toBe(0.62)
  })

  it('descarta linha sem titulo utilizavel', () => {
    expect(buildSearchResult(row({ title: '   ' }))).toBeNull()
  })

  it('score nao finito vira 0', () => {
    expect(buildSearchResult(row({ score: Number.NaN }))?.score).toBe(0)
  })
})

describe('toInternalHref', () => {
  it('aceita path root-relative', () => {
    expect(toInternalHref('/pt/filmes/matrix/')).toBe('/pt/filmes/matrix/')
  })

  it('reduz URL absoluta ao pathname (link sempre same-origin)', () => {
    expect(toInternalHref('https://cinerie.com/pt/filmes/matrix/')).toBe('/pt/filmes/matrix/')
  })

  it('recusa destino invalido ou perigoso', () => {
    expect(toInternalHref(null)).toBeNull()
    expect(toInternalHref('')).toBeNull()
    expect(toInternalHref('//evil.example/x')).toBeNull()
    expect(toInternalHref('javascript:alert(1)')).toBeNull()
    expect(toInternalHref('pt/filmes/matrix/')).toBeNull()
  })
})
