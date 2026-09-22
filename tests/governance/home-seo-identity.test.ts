import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { PUBLIC_HOME_PATH } from '@screena/seo'

import { OFFICIAL_PROFILES } from '../../apps/web/src/lib/institutional-facts'
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

  it('home emite a organização e o WebSite, sem SearchAction nem AggregateRating', () => {
    const raw = read(HOME_REL)
    // `NewsMediaOrganization` e subtipo de `Organization`; qualquer um dos dois
    // serve como no de identidade, e nenhum outro tipo serve.
    expect(raw).toMatch(/["']@type["']:\s*["'](?:News(?:Media)?)?Organization["']/)
    expect(raw).toMatch(/["']@type["']:\s*["']WebSite["']/)
    const code = withoutComments(raw)
    expect(code).not.toMatch(/SearchAction/)
    expect(code).not.toMatch(/AggregateRating/)
  })

  /**
   * A marca precisa ser uma ENTIDADE para a busca (22/09/2026): a home dizia so
   * nome, URL, logo e politica editorial. Sem quem responde, sem canal e sem
   * `sameAs`, nao ha o que o buscador reconheca como "Cinerie" — que e o que
   * sustenta o painel de marca e os sitelinks de marca.
   *
   * Cada propriedade aqui aponta para uma pagina que EXISTE e repete um fato que
   * o site ja publica. O guarda cruza as duas pontas: a home referencia a rota
   * pela constante, e a pagina de destino tem a ancora citada.
   */
  it('identidade da marca: transparência de publicador apontando para páginas reais', () => {
    const code = withoutComments(read(HOME_REL))
    for (const [prop, route] of [
      ['correctionsPolicy', 'EDITORIAL_POLICY_PATH'],
      ['ownershipFundingInfo', 'ABOUT_PATH'],
      ['actionableFeedbackPolicy', 'CONTACT_PATH'],
      ['masthead', 'AUTHORS_INDEX_PATH'],
    ] as const) {
      expect(code, `${prop} monta a URL pela rota`).toMatch(
        new RegExp(`${prop}: \`\\$\\{SITE_URL\\}\\$\\{${route}\\}`),
      )
    }
    // A ancora do `correctionsPolicy` tem de existir na politica editorial —
    // renomear o `id` la quebra a URL que a home afirma aqui.
    expect(read('apps/web/app/pt/politica-editorial/page.tsx')).toContain('id="erros-e-pedidos"')
    // Quem responde pela Cinerie: os MESMOS fatos de /pt/sobre/, nunca inventados.
    expect(code).toContain('legalName: SITE_CONTROLLER.name')
    expect(code).toContain('taxID: SITE_CONTROLLER.cnpj')
    expect(code).toContain("address: { '@type': 'PostalAddress', ...SITE_CONTROLLER_ADDRESS }")
    expect(code).toMatch(/contactType: '/)
  })

  /**
   * `sameAs` e o que liga o site a MESMA marca em outros lugares — e por isso
   * mesmo nao pode ser adivinhado. So entra perfil que a Cinerie controla.
   */
  it('sameAs da marca: só existe quando há perfil oficial declarado', () => {
    const code = withoutComments(read(HOME_REL))
    expect(code).toContain(
      "...(OFFICIAL_PROFILES.length > 0 ? { sameAs: [...OFFICIAL_PROFILES] } : {})",
    )
    // Enquanto a lista estiver vazia, a home nao pode emitir `sameAs` de outro jeito.
    if (OFFICIAL_PROFILES.length === 0) {
      expect(countMatches(code, /sameAs:/g)).toBe(1)
    }
    for (const profile of OFFICIAL_PROFILES) {
      expect(profile, 'perfil oficial é URL absoluta').toMatch(/^https:\/\//)
    }
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
