import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const PAGE_REL = 'apps/web/app/pt/pessoas/[slug]/page.tsx'
const CSS_REL = 'apps/web/app/pt/pessoas/[slug]/person-canonical.module.css'
const page = readFileSync(path.join(ROOT, PAGE_REL), 'utf8')

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('shell público mínimo · detalhe de pessoa', () => {
  const code = withoutComments(page).replaceAll("'", '"')

  it('preserva dados, metadata, canonical, robots e identidade JSON-LD', () => {
    expect(code).toContain('getPersonPageData(slug)')
    expect(code).toContain('canonicalRedirectPath(')
    expect(code).toContain('permanentRedirect(redirectPath)')
    expect(code).toContain('robots: gatePublicRobots(seo.robots)')
    expect(code).toContain('alternates: { canonical: canonicalUrl }')
    expect(code).toContain('"@type": "Person"')
    expect(code).toContain('"@type": "BreadcrumbList"')
    expect(code).toContain('buildSameAs(externalIds, "person")')
    expect(code.match(/application\/ld\+json/g)).toHaveLength(2)
    expect(code).not.toContain('AggregateRating')
  })

  it('mantém um H1, breadcrumb e identidade externa real', () => {
    expect(code.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(code).toContain('data-vertical="person"')
    expect(code).toContain('href={PESSOAS_INDEX_PATH}>Pessoas</a>')
    expect(code).toContain('buildExternalLinks(externalIds, "person")')
    expect(code).toContain('<EntityExternalIds links={externalLinks} />')
  })

  it('preserva biografia revisada, créditos, notícias e revisão editorial', () => {
    expect(code).toContain('BIOGRAPHY_BLOCK_TYPES.has(block.blockType)')
    expect(code).toContain('block.blockType === "news_context"')
    expect(code).toContain('view.credits.map(')
    expect(code).toContain('href={credit.href}')
    expect(code).toContain('Filmografia ainda não disponível.')
    expect(code).toContain('personalDetails.map(')
    expect(code).toContain('relatedNews.map(')
    expect(code).toContain('data-editorial-state="in-review"')
  })

  it('remove a camada visual interpretativa e não inventa dado ausente', () => {
    expect(existsSync(path.join(ROOT, CSS_REL))).toBe(false)
    expect(code).not.toContain('.module.css')
    expect(code).toContain('className="container"')
    expect(code.match(/className=/g)).toHaveLength(1)
    expect(code).not.toContain('<img')
    expect(code).not.toContain('view.profile')
    expect(code).not.toContain('AdSlot')
    expect(code).not.toMatch(/portrait|fallback|newsMedia/i)
    expect(code).not.toMatch(/(?:\?\?|=== null \?)\s*["']—["']/)
  })
})
