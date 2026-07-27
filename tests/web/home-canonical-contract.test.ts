import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Contrato da home — ATUALIZADO DELIBERADAMENTE para a tela 02 do handoff
 * canônico (HomeTemplate). Os contratos de DADO/SEO continuam idênticos aos
 * do reset; as travas visuais passaram a exigir as composições do design em
 * vez de proibi-las.
 */

const ROOT = process.cwd()
const HOME_PATH = 'apps/web/app/pt/page.tsx'

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

describe('home pública — design canônico (tela 02)', () => {
  const home = read(HOME_PATH)

  it('mantém os getters locais e a decisão canônica de indexabilidade', () => {
    for (const getter of [
      'getHomeCatalogData()',
      'getNewsIndexData()',
      'getHomeHeroSlides()',
      'getHomeUpcomingMovies()',
      'getSeriesIndexData()',
    ]) {
      expect(home).toContain(getter)
    }
    expect(home).toContain('evaluatePortalIndexability({')
    expect(home).toMatch(/indexability\.decision === ['"]index['"]/)
    expect(home).toContain('canonicalPublicUrl(HOME_PATH)')
  })

  it('expõe um único H1 institucional e navegação para destinos reais', () => {
    expect(home.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(home).toContain('Cinerie — filmes, séries e pessoas')
    for (const destination of ['MOVIES_INDEX_PATH', 'SERIES_INDEX_PATH', 'NEWS_INDEX_PATH']) {
      expect(home).toContain(`seeAllHref={${destination}}`)
    }
    // Pessoas/Explorar navegam pelo chrome global (header/footer), como no
    // canônico — a home não tem seção própria de pessoas.
  })

  it('renderiza as composições do canônico só com dados persistidos', () => {
    expect(home).toContain('<HomeHeroCarousel slides={heroSlides} />')
    expect(home).toContain('<PosterGrid cards={movieCards} />')
    expect(home).toContain('<PosterGrid cards={seriesWeekCards} />')
    expect(home).toContain('upcomingMovies.map')
    expect(home).toContain('NewsOverlayCard')
    // Toda seção é condicionada ao dado real; vazio = seção omitida.
    expect(home).toContain('heroSlides.length > 0 ?')
    expect(home).toContain('movieCards.length > 0 ?')
    expect(home).toContain('seriesWeekCards.length > 0 ?')
    expect(home).toContain('upcomingMovies.length > 0 ?')
    expect(home).toContain('newsCards.length > 0 ?')
    expect(home).toContain('Ainda não há conteúdo publicado')
  })

  it('anúncios só via AdSlot governado (nunca criativo inline)', () => {
    expect(home).toMatch(/<AdSlot format="leaderboard" slotId="home-/)
    expect(home).not.toMatch(/<iframe|doubleclick|adsbygoogle/i)
  })

  it('preserva Organization e WebSite em JSON-LD', () => {
    expect(home).toMatch(/['"]@type['"]:\s*['"]Organization['"]/)
    expect(home).toMatch(/['"]@type['"]:\s*['"]WebSite['"]/)
    expect(home.match(/application\/ld\+json/g)).toHaveLength(2)
    expect(home).not.toMatch(/SearchAction|AggregateRating/)
  })
})
