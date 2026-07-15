import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const HOME_REL = 'apps/web/app/pt/page.tsx'
const ENTITY_PAGES: ReadonlyArray<[string, string]> = [
  ['movie', 'apps/web/app/pt/filmes/[slug]/page.tsx'],
  ['tv', 'apps/web/app/pt/series/[slug]/page.tsx'],
  ['person', 'apps/web/app/pt/pessoas/[slug]/page.tsx'],
]

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function withoutComments(source: string): string {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      for (let i = 0; i < line.length - 1; i += 1) {
        if (line[i] === '/' && line[i + 1] === '/') {
          if (i > 0 && line[i - 1] === ':') continue
          return line.slice(0, i)
        }
      }
      return line
    })
    .join('\n')
}

function countMatches(source: string, pattern: RegExp): number {
  const matches = source.match(pattern)
  return matches === null ? 0 : matches.length
}

describe('governança SEO: home entity-first e grafo de identidade', () => {
  it('home mantém um único H1 institucional estável', () => {
    const raw = read(HOME_REL)
    const code = withoutComments(raw)
    expect(countMatches(code, /<h1[\s>]/g)).toBe(1)
    expect(raw).toContain('Screen — filmes, séries e pessoas')
    expect(code).toContain('<h1>{HOME_H1}</h1>')
  })

  it('home emite Organization e WebSite, sem SearchAction nem AggregateRating', () => {
    const raw = read(HOME_REL)
    expect(raw).toMatch(/["']@type["']:\s*["']Organization["']/)
    expect(raw).toMatch(/["']@type["']:\s*["']WebSite["']/)
    const code = withoutComments(raw)
    expect(code).not.toMatch(/SearchAction/)
    expect(code).not.toMatch(/AggregateRating/)
  })

  it('fichas emitem @id, mainEntityOfPage e sameAs real, sem AggregateRating', () => {
    for (const [kind, relativePath] of ENTITY_PAGES) {
      const code = withoutComments(read(relativePath))
      expect(code, `${kind}: @id autorreferente`).toMatch(/["']@id["']:\s*canonicalUrl/)
      expect(code, `${kind}: mainEntityOfPage`).toContain('mainEntityOfPage: canonicalUrl')
      expect(code, `${kind}: buildSameAs`).toMatch(/buildSameAs\(externalIds,/)
      expect(code, `${kind}: guarda sameAs`).toMatch(/if \(sameAs\.length > 0\)/)
      expect(code, `${kind}: sem AggregateRating`).not.toMatch(/AggregateRating/)
    }
  })
})
