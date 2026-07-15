import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const HOME_PATH = 'apps/web/app/pt/page.tsx'

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

describe('home pública após o reset visual', () => {
  const home = read(HOME_PATH)

  it('mantém os getters locais e a decisão canônica de indexabilidade', () => {
    for (const getter of [
      'getHomeCatalogData()',
      'getNewsIndexData()',
      'getHomeHeroSlides()',
      'getHomeUpcomingMovies()',
    ]) {
      expect(home).toContain(getter)
    }
    expect(home).toContain('evaluatePortalIndexability({')
    expect(home).toMatch(/indexability\.decision === ['"]index['"]/)
    expect(home).toContain('canonicalPublicUrl(HOME_PATH)')
  })

  it('expõe um H1 visível, descrição e navegação para destinos reais', () => {
    expect(home.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(home).toContain('<h1>{HOME_H1}</h1>')
    expect(home).toContain('<p>{HOME_DESCRIPTION}</p>')
    for (const destination of [
      'MOVIES_INDEX_PATH',
      'SERIES_INDEX_PATH',
      'PEOPLE_INDEX_PATH',
      'NEWS_INDEX_PATH',
      'EXPLORE_PATH',
    ]) {
      expect(home).toContain(`href={${destination}}`)
    }
  })

  it('renderiza apenas listas textuais dos dados persistidos', () => {
    expect(home).toContain('heroSlides.map')
    expect(home).toContain('movieCards.map')
    expect(home).toContain('upcomingMovies.map')
    expect(home).toContain('newsCards.map')
    expect(home).toContain('Ainda não há conteúdo publicado')
    expect(home).not.toMatch(/<img|<HeroCarousel|<ComingSoonRail|<AdSlot/)
    expect(home).not.toMatch(/MovieCard|SeriesCard|NewsFeature|NewsMiniCard/)
  })

  it('preserva Organization e WebSite em JSON-LD', () => {
    expect(home).toMatch(/['"]@type['"]:\s*['"]Organization['"]/)
    expect(home).toMatch(/['"]@type['"]:\s*['"]WebSite['"]/)
    expect(home.match(/application\/ld\+json/g)).toHaveLength(2)
    expect(home).not.toMatch(/SearchAction|AggregateRating/)
  })
})
