import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const PAGE_REL = 'apps/web/app/pt/series/[slug]/page.tsx'
const CSS_REL = 'apps/web/app/pt/series/[slug]/series-canonical.module.css'
const page = readFileSync(path.join(ROOT, PAGE_REL), 'utf8')

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('shell público mínimo · detalhe de série', () => {
  const code = withoutComments(page).replaceAll("'", '"')

  it('preserva dados, metadata, canonical, robots e identidade JSON-LD', () => {
    expect(code).toContain('getSeriesPageData(slug)')
    expect(code).toContain('canonicalRedirectPath(')
    expect(code).toContain('permanentRedirect(redirectPath)')
    expect(code).toContain('robots: gatePublicRobots(seo.robots)')
    expect(code).toContain('alternates: { canonical: canonicalUrl }')
    expect(code).toContain('"@type": "TVSeries"')
    expect(code).toContain('"@type": "BreadcrumbList"')
    expect(code).toContain('buildSameAs(externalIds, "tv")')
    expect(code.match(/application\/ld\+json/g)).toHaveLength(2)
    expect(code).not.toContain('AggregateRating')
  })

  it('mantém um H1, breadcrumb e badge textual de Série', () => {
    expect(code.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(code).toContain('data-vertical="series"')
    expect(code).toMatch(/data-entity-badge="series"[\s\S]{0,40}Série/)
    expect(code).toContain('href={SERIES_INDEX_PATH}>Séries</a>')
  })

  it('preserva seleção de temporada, query e âncoras', () => {
    expect(code).toContain('seasonNumberFromQuery(query.temporada)')
    expect(code).toContain('const selectedSeason =')
    expect(code).toContain('id="episodios"')
    expect(code).toContain('id={`temporada-${season.seasonNumber}`}')
    // Fase 4: as temporadas linkam para as rotas dedicadas (seasonPath),
    // preservando a selecao inline por query (`?temporada=`) como fallback.
    expect(code).toContain('seasonPath(data.canonicalSlug, season.seasonNumber)')
    expect(code).toContain('`?temporada=${season.seasonNumber}#episodios`')
    expect(code).toContain('season={selectedSeason}')
    expect(code).toContain('Nenhum episódio publicado nesta temporada.')
  })

  it('mantém somente blocos revisados e dados reais da ficha', () => {
    expect(code).toContain('WORK_BLOCK_TYPES.has(block.blockType)')
    expect(code).toContain('EPISODE_BLOCK_TYPES.has(block.blockType)')
    expect(code).toContain('block.blockType === "where_to_watch_text"')
    expect(code).toContain('block.blockType === "cast_intro"')
    expect(code).toContain('block.blockType === "news_context"')
    expect(code).toContain('watch !== null ?')
    expect(code).toContain('<WatchAvailabilityPanel view={watch} />')
    expect(code).toContain('<EntityExternalIds links={externalLinks} />')
    expect(code).toContain('visibleCast.map(')
    expect(code).toContain('visibleNews.map(')
    expect(code).toContain('data-editorial-state="in-review"')
  })

  it('design canônico (tela 07): estrutura EXATA do handoff, sem dado inventado', () => {
    // Ordem canônica: hero editorial claro (verde) → mídia → A obra →
    // Guia crítica → EPISÓDIOS (catálogo) → Elenco → Notícias → Detalhes.
    const order = [
      'className="detail-hero"',
      'className="media-strip"',
      'className="synopsis-lead"',
      'className="critic-band"',
      'className="season-tabs"',
      'className="cast-strip"',
      'className="mnews-grid"',
      'className="ficha-grid"',
    ]
    let cursor = -1
    for (const marker of order) {
      const at = code.indexOf(marker)
      expect(at, `marcador ausente/fora de ordem: ${marker}`).toBeGreaterThan(cursor)
      cursor = at
    }
    expect(existsSync(path.join(ROOT, CSS_REL))).toBe(false)
    expect(code).not.toContain('.module.css')
    expect(code).toContain('view.media.poster !== null')
    expect(code).toContain('episode.still !== null')
    expect(code).toContain('className="episode-row"')
    expect(code).not.toMatch(/src="https?:/)
    expect(code).not.toMatch(/(?:\?\?|=== null \?)\s*["']—["']/)
    // Cinerie Score honesto; 21k episódios nunca de uma vez (só a temporada
    // selecionada renderiza).
    expect(code).toContain('Ainda não calculado')
    expect(code).toContain('season={selectedSeason}')
  })
})
