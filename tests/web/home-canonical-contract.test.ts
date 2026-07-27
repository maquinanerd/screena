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
const HOME_LIKE_PATH = 'apps/web/app/_components/home-like.tsx'

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

describe('home pública — design canônico (tela 02)', () => {
  const home = read(HOME_PATH)
  const homeLike = read(HOME_LIKE_PATH)

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
    // A navegação das seções vive no template compartilhado (HomeLike).
    for (const destination of ['MOVIES_INDEX_PATH', 'SERIES_INDEX_PATH', 'NEWS_INDEX_PATH']) {
      expect(homeLike).toContain(`href={${destination}}`)
    }
    // Pessoas/Explorar navegam pelo chrome global (header/footer), como no
    // canônico — a home não tem seção própria de pessoas.
  })

  it('segue a ORDEM EXATA da tela 02 do canônico, só com dados persistidos', () => {
    // A composição vive no template compartilhado HomeLike (tela 02 = tela 04
    // com as duas bandas ligadas). Ordem: hero → ticker → destaques → popular
    // (rank) → filmes em alta → stats → séries → em breve → notícias.
    const order = [
      '<HomeHeroCarousel slides={heroSlides} />',
      '<HomeTicker items={tickerEpisodes} />',
      'className="feat-grid"',
      'className="pop-rail__rank"',
      'label="Filmes em alta"',
      '<MonthStats />',
      'label="Séries da semana"',
      'className="glimpse-rail"',
      'className="hnews-grid"',
    ]
    let cursor = -1
    for (const marker of order) {
      const at = homeLike.indexOf(marker)
      expect(at, `marcador ausente/fora de ordem: ${marker}`).toBeGreaterThan(cursor)
      cursor = at
    }
    // A home liga as DUAS bandas e cada seção continua condicionada a dado real.
    expect(home).toContain('<HomeLike')
    expect(home).toContain('showMoviesBand')
    expect(home).toContain('showSeriesBand')
    expect(homeLike).toContain('heroSlides.length > 0 ?')
    expect(homeLike).toContain('showMoviesBand && movieCards.length > 0 ?')
    expect(homeLike).toContain('showSeriesBand && seriesCards.length > 0 ?')
    expect(homeLike).toContain('upcomingMovies.length > 0 ?')
    expect(homeLike).toContain('newsCards.length > 0 ?')
    expect(home).toContain('Ainda não há conteúdo publicado')
  })

  it('anúncios só via AdSlot governado (nunca criativo inline)', () => {
    expect(homeLike).toMatch(/<AdSlot format="leaderboard" slotId=\{`\$\{adPrefix\}-/)
    expect(homeLike).not.toMatch(/<iframe|doubleclick|adsbygoogle/i)
    expect(home).not.toMatch(/<iframe|doubleclick|adsbygoogle/i)
  })

  it('preserva Organization e WebSite em JSON-LD', () => {
    expect(home).toMatch(/['"]@type['"]:\s*['"]Organization['"]/)
    expect(home).toMatch(/['"]@type['"]:\s*['"]WebSite['"]/)
    expect(home.match(/application\/ld\+json/g)).toHaveLength(2)
    expect(home).not.toMatch(/SearchAction|AggregateRating/)
  })
})
