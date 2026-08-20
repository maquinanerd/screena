/**
 * normalize-title-genres.test.ts — O `genres[]` do detalhe do TMDB, que chegava
 * e era jogado fora.
 *
 * TERCEIRO CASO DO MESMO PADRAO. Antes dele: `watch/providers` (PR #181, o
 * payload chegava e o normalizador o descartava) e a `biography` de pessoa (o
 * campo chegava e nao havia coluna). Aqui a tabela `genres` existia como
 * DICIONARIO desde a Fase 6 e nunca teve ligacao com titulo nenhum.
 *
 * O que este arquivo trava tem duas metades, e a segunda e a que custa caro:
 *   1. os generos sao lidos, na ORDEM certa;
 *   2. ausencia do campo NAO e lista vazia — porque replace-set sobre "vazio"
 *      apaga o que ja existe, e este repositorio ja perdeu creditos em massa
 *      exatamente assim.
 */

import { describe, expect, it } from 'vitest'

import { normalizeTitleGenres } from '../normalizers/genres.js'
import { normalizeMovie } from '../normalizers/movie.js'
import { normalizeTvShow } from '../normalizers/tv.js'

describe('normalizeTitleGenres', () => {
  it('preserva a ORDEM do TMDB — ela e editorial, nao arbitraria', () => {
    // O TMDB devolve o genero mais representativo primeiro, e o chip do hero
    // mostra os primeiros. Ordenar por id trocaria "Ficcao cientifica" (878)
    // por "Acao" (28) na vitrine sem ninguem ter decidido isso.
    const r = normalizeTitleGenres([
      { id: 878, name: 'Ficcao cientifica' },
      { id: 28, name: 'Acao' },
      { id: 12, name: 'Aventura' },
    ])
    expect(r.links).toEqual([
      { tmdbId: 878, position: 0 },
      { tmdbId: 28, position: 1 },
      { tmdbId: 12, position: 2 },
    ])
  })

  it('AUSENCIA e lista vazia sao estados DIFERENTES', () => {
    // A distincao inteira do arquivo. `present:false` faz o replace-set nao
    // rodar; `present:true` com zero itens e uma limpeza legitima.
    expect(normalizeTitleGenres(undefined)).toEqual({ links: [], present: false })
    expect(normalizeTitleGenres(null)).toEqual({ links: [], present: false })
    expect(normalizeTitleGenres('nao e array')).toEqual({ links: [], present: false })
    expect(normalizeTitleGenres([])).toEqual({ links: [], present: true })
  })

  it('descarta item invalido SEM deixar buraco na ordem', () => {
    // `position` conta os aceitos, nao o indice cru. Um buraco viraria
    // ordenacao errada na leitura.
    const r = normalizeTitleGenres([
      { id: 878 },
      null,
      { id: 'nao-numero' },
      { nome: 'sem id' },
      { id: 0 },
      { id: -3 },
      { id: 1.5 },
      { id: 28 },
    ])
    expect(r.links).toEqual([
      { tmdbId: 878, position: 0 },
      { tmdbId: 28, position: 1 },
    ])
  })

  it('id repetido entra UMA vez — a PK e (titulo, genero)', () => {
    // Duplicata abortaria a escrita inteira; o titulo nao seria gravado por
    // causa de um payload com repeticao.
    const r = normalizeTitleGenres([{ id: 28 }, { id: 28 }, { id: 12 }])
    expect(r.links).toEqual([
      { tmdbId: 28, position: 0 },
      { tmdbId: 12, position: 1 },
    ])
  })
})

describe('o detalhe de FILME para de descartar os generos', () => {
  const detalhe = (over: Record<string, unknown> = {}) => ({
    id: 603,
    original_title: 'The Matrix',
    ...over,
  })

  it('le os generos do payload', () => {
    const n = normalizeMovie(detalhe({ genres: [{ id: 28, name: 'Acao' }, { id: 878 }] }) as never)
    expect(n.genres).toEqual([
      { tmdbId: 28, position: 0 },
      { tmdbId: 878, position: 1 },
    ])
    expect(n.genresPresent).toBe(true)
  })

  it('NEGATIVO: payload SEM `genres` nao afirma lista vazia', () => {
    // Raw antigo (gravado antes de alguem olhar para genero) cai aqui. Se este
    // teste passasse a esperar `present:true`, uma repromocao apagaria os
    // generos do catalogo inteiro.
    const n = normalizeMovie(detalhe() as never)
    expect(n.genres).toEqual([])
    expect(n.genresPresent).toBe(false)
  })
})

describe('o detalhe de SERIE para de descartar os generos', () => {
  const detalhe = (over: Record<string, unknown> = {}) => ({
    id: 1399,
    original_name: 'Game of Thrones',
    ...over,
  })

  it('le os generos do payload', () => {
    const n = normalizeTvShow(detalhe({ genres: [{ id: 10765 }, { id: 18 }] }) as never)
    expect(n.genres).toEqual([
      { tmdbId: 10765, position: 0 },
      { tmdbId: 18, position: 1 },
    ])
    expect(n.genresPresent).toBe(true)
  })

  it('NEGATIVO: payload SEM `genres` nao afirma lista vazia', () => {
    const n = normalizeTvShow(detalhe() as never)
    expect(n.genresPresent).toBe(false)
  })
})
