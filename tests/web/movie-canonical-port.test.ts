import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const PAGE_REL = 'apps/web/app/pt/filmes/[slug]/page.tsx'
const CSS_REL = 'apps/web/app/pt/filmes/[slug]/movie-canonical.module.css'
const page = readFileSync(path.join(ROOT, PAGE_REL), 'utf8')

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('shell público mínimo · detalhe de filme', () => {
  const code = withoutComments(page).replaceAll("'", '"')

  it('preserva dados, metadata, canonical, robots e identidade JSON-LD', () => {
    expect(code).toContain('getMoviePageData(slug)')
    expect(code).toContain('canonicalRedirectPath(')
    expect(code).toContain('permanentRedirect(redirectPath)')
    expect(code).toContain('robots: seo.robots')
    expect(code).toContain('alternates: { canonical: canonicalUrl }')
    expect(code).toContain('"@type": "Movie"')
    expect(code).toContain('"@type": "BreadcrumbList"')
    expect(code).toContain('buildSameAs(externalIds, "movie")')
    expect(code.match(/application\/ld\+json/g)).toHaveLength(2)
    expect(code).not.toContain('AggregateRating')
  })

  it('mantém um H1, breadcrumb e badge textual de Filme', () => {
    expect(code.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(code).toContain('data-vertical="movie"')
    expect(code).toContain('data-entity-badge="movie">Filme</strong>')
    expect(code).toContain('href={MOVIES_INDEX_PATH}>Filmes</a>')
  })

  it('mantém somente blocos revisados e dados reais da ficha', () => {
    expect(code).toContain('WORK_BLOCK_TYPES.has(block.blockType)')
    expect(code).toContain('const REVIEW_BLOCK_TYPE = "review_summary"')
    expect(code).toContain('block.blockType === REVIEW_BLOCK_TYPE')
    expect(code).toContain('block.blockType === "where_to_watch_text"')
    expect(code).toContain('block.blockType === "cast_intro"')
    expect(code).toContain('block.blockType === "news_context"')
    expect(code).toContain('watch !== null ?')
    expect(code).toContain('<WatchAvailabilityPanel view={watch} />')
    expect(code).toContain('<EntityExternalIds links={externalLinks} />')
    expect(code).toContain('primaryCast.map(')
    expect(code).toContain('editorialNews.map(')
    expect(code).toContain('data-editorial-state="in-review"')
  })

  it('remove a camada visual interpretativa e não inventa dado ausente', () => {
    expect(existsSync(path.join(ROOT, CSS_REL))).toBe(false)
    expect(code).not.toContain('.module.css')
    expect(code).toContain('className="container"')
    expect(code.match(/className=/g)).toHaveLength(1)
    expect(code).not.toContain('<img')
    expect(code).not.toContain('view.media')
    expect(code).not.toMatch(/poster|backdrop|fallback|mediaTile/i)
    expect(code).not.toMatch(/(?:\?\?|=== null \?)\s*["']—["']/)
  })
})
