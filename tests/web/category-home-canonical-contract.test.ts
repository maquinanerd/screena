import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Contrato das categorias — ATUALIZADO DELIBERADAMENTE para a tela 04 do
 * canônico (EX-04-dual): "CATEGORY HOME sem layout próprio → home-like +
 * bandas showMoviesBand/showSeriesBand". /pt/filmes e /pt/series deixam de
 * ser listagens de grid e passam a reusar o template HomeLike com dataset,
 * banda e acento por contexto. /pt/pessoas continua índice (EntityIndex).
 * Os contratos de SEO (canonical, robots, CollectionPage, BreadcrumbList,
 * ItemList) continuam pinados.
 */

const ROOT = process.cwd()

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

describe('categorias (tela 04) e índice de pessoas', () => {
  const movies = read('apps/web/app/pt/filmes/page.tsx')
  const series = read('apps/web/app/pt/series/page.tsx')
  const people = read('apps/web/app/pt/pessoas/page.tsx')
  const entityIndex = read('apps/web/app/_components/entity-index.tsx')

  it('filmes/séries reusam o template home-like com a banda do contexto', () => {
    expect(movies).toContain('<HomeLike')
    expect(movies).toContain('adPrefix="filmes"')
    expect(movies).toContain('showMoviesBand')
    expect(movies).toContain('showSeriesBand={false}')
    expect(movies).toContain('data-vertical="movie"')
    expect(movies).toContain("slide.vertical === 'movie'")

    expect(series).toContain('<HomeLike')
    expect(series).toContain('adPrefix="series"')
    expect(series).toContain('showMoviesBand={false}')
    expect(series).toContain('showSeriesBand')
    expect(series).toContain('data-vertical="series"')
    expect(series).toContain("slide.vertical === 'series'")
    // Ticker de episódios (dataset de séries) só na categoria de séries.
    expect(series).toContain('getHomeTickerEpisodes()')
    expect(movies).not.toContain('getHomeTickerEpisodes()')
  })

  it('mantém metadata, robots, canonical e JSON-LD do índice real', () => {
    for (const page of [movies, series]) {
      expect(page).toMatch(/indexability\.decision === ['"]index['"]/)
      expect(page).toContain('robots: publicRobots(shouldIndex)')
      expect(page).toContain('alternates: { canonical: canonicalUrl }')
      expect(page).toMatch(/["']@type["']:\s*["']CollectionPage["']/)
      expect(page).toMatch(/["']@type["']:\s*["']BreadcrumbList["']/)
      expect(page.match(/application\/ld\+json/g)).toHaveLength(2)
      expect(page.match(/<h1[\s>]/g)).toHaveLength(1)
    }
  })

  it('pessoas continua um índice fino com o contrato compartilhado', () => {
    expect(people).toContain('getPersonIndexData')
    expect(people).toContain('<EntityIndex')
    expect(people).toContain('vertical="person"')
    const posterCard = read('apps/web/app/_components/ds.tsx')
    expect(entityIndex.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(entityIndex).toContain('<PosterGrid cards={view.cards} />')
    expect(posterCard).toContain('href={card.href}')
    expect(entityIndex).toMatch(/["']@type["']:\s*["']CollectionPage["']/)
    expect(entityIndex).toMatch(/["']@type["']:\s*["']BreadcrumbList["']/)
    expect(entityIndex).toContain('Ainda não há pessoas publicadas nesta seção.')
  })

  it('componentes do design anterior seguem inexistentes', () => {
    expect(existsSync(path.join(ROOT, 'apps/web/app/_components/category-home.tsx'))).toBe(false)
    expect(existsSync(path.join(ROOT, 'apps/web/app/_components/category-home.module.css'))).toBe(
      false,
    )
  })
})
