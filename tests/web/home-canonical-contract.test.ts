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
      'getHomeTickerEpisodes()',
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
      expect(home).toContain(`href={${destination}}`)
    }
    // Pessoas/Explorar navegam pelo chrome global (header/footer), como no
    // canônico — a home não tem seção própria de pessoas.
  })

  it('segue a ORDEM EXATA da tela 02 do canônico, só com dados persistidos', () => {
    // hero → ticker → destaques → popular (rank) → filmes em alta → séries →
    // em breve (glimpse) → notícias (lead + 2x2)
    const order = [
      '<HomeHeroCarousel slides={heroSlides} />',
      '<HomeTicker items={tickerEpisodes} />',
      'className="feat-grid"',
      'className="pop-rail__rank"',
      'className="fresh-rail" label="Filmes em alta"',
      'className="fresh-rail" label="Séries da semana"',
      'className="glimpse-rail"',
      'className="hnews-grid"',
    ]
    let cursor = -1
    for (const marker of order) {
      const at = home.indexOf(marker)
      expect(at, `marcador ausente/fora de ordem: ${marker}`).toBeGreaterThan(cursor)
      cursor = at
    }
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
