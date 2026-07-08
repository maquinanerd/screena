/**
 * Testes puros dos helpers de slug/rota do backfill de catalogo publico.
 * Travam: slugify sem acento/hifenizado, sufixo `-tmdb-{id}` deterministico e o
 * path de rota canonico por tipo (chave de `redirects` na troca de slug).
 */

import { describe, expect, it } from 'vitest'

import { entityRoutePath, slugify, withTmdbSuffix } from '../public-catalog-slug.js'

describe('slugify', () => {
  it('remove acento, minusculiza e hifeniza', () => {
    expect(slugify('O Senhor dos Anéis')).toBe('o-senhor-dos-aneis')
    expect(slugify('  Amélie  ')).toBe('amelie')
    expect(slugify('Star Wars: Episódio IV')).toBe('star-wars-episodio-iv')
  })

  it('colapsa separadores e apara hifens das pontas', () => {
    expect(slugify('---a & b---')).toBe('a-b')
    expect(slugify('!!!')).toBe('')
  })
})

describe('withTmdbSuffix', () => {
  it('desambigua com o tmdb id (deterministico)', () => {
    expect(withTmdbSuffix('john-smith', 42)).toBe('john-smith-tmdb-42')
    expect(withTmdbSuffix('john-smith', 42)).toBe(withTmdbSuffix('john-smith', 42))
  })
})

describe('entityRoutePath', () => {
  it('mapeia tipo -> segmento pt-BR com barra final', () => {
    expect(entityRoutePath('movie', 'inception-2010')).toBe('/pt/filmes/inception-2010/')
    expect(entityRoutePath('tv', 'lost-2004')).toBe('/pt/series/lost-2004/')
    expect(entityRoutePath('person', 'john-smith')).toBe('/pt/pessoas/john-smith/')
  })
})
