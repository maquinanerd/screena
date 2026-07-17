import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

describe('índices de entidades após o reset visual', () => {
  const movies = read('apps/web/app/pt/filmes/page.tsx')
  const series = read('apps/web/app/pt/series/page.tsx')
  const people = read('apps/web/app/pt/pessoas/page.tsx')
  const entityIndex = read('apps/web/app/_components/entity-index.tsx')

  it('usa o view real do getter canônico nas três rotas', () => {
    const cases = [
      [movies, 'getMovieIndexData', 'breadcrumbLabel="Filmes"', 'vertical="movie"'],
      [series, 'getSeriesIndexData', 'breadcrumbLabel="Séries"', 'vertical="series"'],
      [people, 'getPersonIndexData', 'breadcrumbLabel="Pessoas"', 'vertical="person"'],
    ] as const

    for (const [page, getter, breadcrumb, vertical] of cases) {
      expect(page).toContain(`const { view, canonicalUrl } = await ${getter}()`)
      expect(page).toContain('<EntityIndex')
      expect(page).toContain('view={view}')
      expect(page).toContain(breadcrumb)
      expect(page).toContain(vertical)
    }
  })

  it('mantém metadata, robots e canonical governados', () => {
    for (const page of [movies, series, people]) {
      expect(page).toMatch(/indexability\.decision === ['"]index['"]/)
      expect(page).toContain('robots: publicRobots(shouldIndex)')
      expect(page).toContain('alternates: { canonical: canonicalUrl }')
    }
  })

  it('remove o agregador visual de notícias, anúncios e lançamentos', () => {
    for (const page of [movies, series]) {
      expect(page).not.toMatch(/CategoryHome|getNewsIndexData|getHomeUpcomingMovies/)
      expect(page).not.toMatch(/AdSlot|<img/)
    }
    expect(existsSync(path.join(ROOT, 'apps/web/app/_components/category-home.tsx'))).toBe(false)
    expect(existsSync(path.join(ROOT, 'apps/web/app/_components/category-home.module.css'))).toBe(
      false,
    )
  })

  it('trava o contrato compartilhado de H1, links, schemas e empty states', () => {
    expect(entityIndex.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(entityIndex).toContain('href={card.href}')
    expect(entityIndex).toMatch(/["']@type["']:\s*["']CollectionPage["']/)
    expect(entityIndex).toMatch(/["']@type["']:\s*["']BreadcrumbList["']/)
    expect(entityIndex.match(/application\/ld\+json/g)).toHaveLength(2)
    expect(entityIndex).toContain('Ainda não há filmes publicados nesta seção.')
    expect(entityIndex).toContain('Ainda não há séries publicadas nesta seção.')
    expect(entityIndex).toContain('Ainda não há pessoas publicadas nesta seção.')

    for (const page of [movies, series, people]) {
      expect(page.match(/<h1[\s>]/g)).toBeNull()
    }
  })
})
