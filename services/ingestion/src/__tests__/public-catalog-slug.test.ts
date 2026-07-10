/**
 * Testes puros dos helpers de slug/rota do backfill de catalogo publico.
 * Travam: slugify sem acento/hifenizado, sufixo `-tmdb-{id}` deterministico e o
 * path de rota canonico por tipo (chave de `redirects` na troca de slug).
 */

import { describe, expect, it } from 'vitest'

import {
  desiredCatalogSlug,
  entityRoutePath,
  slugify,
  withTmdbSuffix,
} from '../public-catalog-slug.js'

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
    expect(entityRoutePath('movie', 'inception')).toBe('/pt/filmes/inception/')
    expect(entityRoutePath('tv', 'lost')).toBe('/pt/series/lost/')
    expect(entityRoutePath('person', 'john-smith')).toBe('/pt/pessoas/john-smith/')
  })
})

describe('desiredCatalogSlug', () => {
  it('e o titulo limpo, SEM ano de lancamento na URL', () => {
    expect(desiredCatalogSlug('A Origem', 27205)).toBe('a-origem')
    expect(desiredCatalogSlug('Game of Thrones', 1399)).toBe('game-of-thrones')
    expect(desiredCatalogSlug('Amélie', 194)).toBe('amelie')
  })

  it('preserva numero que faz parte do TITULO (nao e data pendurada)', () => {
    expect(desiredCatalogSlug('Blade Runner 2049', 335984)).toBe('blade-runner-2049')
    expect(desiredCatalogSlug('Space: 1999', 134)).toBe('space-1999')
    expect(desiredCatalogSlug('Espaço: 1999', 134)).toBe('espaco-1999')
  })

  it('titulo vazio/nao-slugificavel => fallback tmdb-{id} (nunca o ano)', () => {
    expect(desiredCatalogSlug('!!!', 500)).toBe('tmdb-500')
    expect(desiredCatalogSlug('', 123)).toBe('tmdb-123')
  })

  it('deterministico: mesmas entradas => mesmo slug (re-sync nao cria variante)', () => {
    expect(desiredCatalogSlug('Duna', 438631)).toBe(desiredCatalogSlug('Duna', 438631))
  })

  /**
   * Guarda de regressao do bug de origem: o ano nao pode voltar a desambiguar.
   * Dois titulos iguais de anos diferentes produzem o MESMO slug desejado — a
   * desambiguacao de colisao real e responsabilidade de `withTmdbSuffix` /
   * `upsertCanonicalSlug` (banco), nunca do ano.
   */
  it('titulos iguais de anos diferentes colidem de proposito (ano nao desambigua)', () => {
    const remake = desiredCatalogSlug('A Origem', 27205)
    const original = desiredCatalogSlug('A Origem', 999999)
    expect(remake).toBe(original)
    expect(withTmdbSuffix(original, 999999)).toBe('a-origem-tmdb-999999')
  })
})
