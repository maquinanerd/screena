import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { PUBLIC_HOME_PATH } from '@screena/seo'

import { HOME_PATH } from '../../apps/web/src/lib/routes'

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
    expect(raw).toContain('Cinerie — filmes, séries e pessoas')
    // Design canônico (tela 02): o H1 institucional é visually-hidden — o hero
    // exibe o TÍTULO DO DESTAQUE, não o nome do site. O H1 continua único,
    // estável e com o mesmo texto institucional.
    expect(code).toContain('className="visually-hidden">Cinerie — filmes, séries e pessoas</h1>')
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

  /**
   * UM no por identidade (auditoria de SEO, M7): `Organization.url` era `/pt/`,
   * `WebSite.url` era `/`, o `publisher` apontava para a origem sem barra, e nao
   * havia `@id`. A regra vive em `@screena/seo`; a home tem de usa-la.
   */
  it('grafo de identidade: @id por no, a MESMA URL publica, e o WebSite aponta a Organization', () => {
    const code = withoutComments(read(HOME_REL))
    expect(code).toContain("'@id': organizationId(SITE_URL)")
    expect(code).toContain("'@id': websiteId(SITE_URL)")
    expect(code.match(/url: publicHomeUrl\(SITE_URL\)/g)).toHaveLength(2)
    expect(code).toContain("publisher: { '@id': organizationId(SITE_URL) }")
    // A home canonica do pacote e a rota real do site — nunca duas verdades.
    expect(PUBLIC_HOME_PATH).toBe(HOME_PATH)
  })

  /**
   * As fichas descrevem o que a pagina MOSTRA (auditoria de SEO, 3.5): `Movie`
   * saia sem `image` (obrigatoria para o Google), sem `director`, `genre` e
   * `duration`; `TVSeries` e `Person` sem `image`. Os helpers sao testados no
   * pacote; aqui se prova que a pagina os liga.
   */
  it('fichas emitem image e os fatos visiveis de cada tipo', () => {
    const movie = withoutComments(read('apps/web/app/pt/filmes/[slug]/page.tsx'))
    for (const field of ['image', 'genre', 'director', 'actor', 'duration', 'datePublished']) {
      expect(movie, `Movie.${field}`).toContain(`movieJsonLd.${field} =`)
    }
    const series = withoutComments(read('apps/web/app/pt/series/[slug]/page.tsx'))
    for (const field of ['image', 'genre', 'numberOfSeasons', 'numberOfEpisodes', 'actor', 'startDate', 'endDate']) {
      expect(series, `TVSeries.${field}`).toContain(`seriesJsonLd.${field} =`)
    }
    const person = withoutComments(read('apps/web/app/pt/pessoas/[slug]/page.tsx'))
    expect(person).toContain('personJsonLd.image =')
  })
})
