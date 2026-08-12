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
    expect(code).toContain('robots: gatePublicRobots(seo.robots)')
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
    // Badge do design canônico: continua TEXTUAL (invariante 11) e marcado.
    expect(code).toMatch(/data-entity-badge="movie"[\s\S]{0,40}Filme/)
    expect(code).toContain('href={MOVIES_INDEX_PATH}>Filmes</a>')
  })

  it('mantém somente blocos revisados e dados reais da ficha', () => {
    expect(code).toContain('WORK_BLOCK_TYPES.has(block.blockType)')
    expect(code).toContain('const REVIEW_BLOCK_TYPE = "review_summary"')
    expect(code).toContain('block.blockType === REVIEW_BLOCK_TYPE')
    expect(code).toContain('block.blockType === "where_to_watch_text"')
    expect(code).toContain('block.blockType === "cast_intro"')
    expect(code).toContain('block.blockType === "news_context"')
    // O gate de oferta licenciada virou fronteira de secao: alem de manter o
    // painel fora do DOM, ela REGISTRA o motivo da ausencia (o ternario
    // anterior cumpria so a primeira metade).
    expect(code).toMatch(/decideSection\(watch,/)
    expect(code).toContain('<WatchAvailabilityPanel view={view} />')
    expect(code).toContain('<EntityExternalIds links={externalLinks} />')
    // Elenco e noticias tambem passam pela fronteira; a lista chega como
    // argumento ja garantido nao-vazio.
    expect(code).toMatch(/decideSection\(primaryCast,/)
    expect(code).toMatch(/decideSection\(editorialNews,/)
    expect(code).toContain('members.map(')
    expect(code).toContain('articles.map(')
    expect(code).toContain('data-editorial-state="in-review"')
  })

  it('design canônico (tela 06): estrutura EXATA do handoff, sem dado inventado', () => {
    // Ordem canônica: hero editorial claro → mídia full-bleed → A obra →
    // Guia crítica → Elenco (faixa 3/4) → Notícias e bastidores → Ficha.
    const order = [
      'className="detail-hero"',
      'className="media-strip"',
      'className="synopsis-lead"',
      'className="critic-band"',
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
    // Imagens só de asset governado; sem hotlink improvisado; sem "N/D".
    expect(code).toContain('view.media.poster !== null')
    expect(code).toContain('view.media.backdrop !== null')
    expect(code).not.toMatch(/src="https?:/)
    expect(code).not.toMatch(/(?:\?\?|=== null \?)\s*["']—["']/)
    // Cinerie Score: nunca número inventado — e agora nem placeholder.
    //
    // O canônico dá ao score o maior peso tipográfico da página (47px/800).
    // Não existe fórmula aprovada (`PRODUCTION_FORMULA_REGISTRY` está vazio) nem
    // decisão `cinerie_score_display` com `derivative_allowed`. A página escrevia
    // "Ainda não calculado" — texto solto ocupando a posição de maior destaque
    // para dizer que não há nada ali. O contrato de dados reais manda o oposto:
    // "se não há conteúdo, a seção inteira não renderiza". O bloco saiu.
    expect(code).not.toMatch(/score-line__value/)
    expect(code).not.toMatch(/Ainda não calculado/)
    expect(code).not.toMatch(/Cinerie Score/)
  })
})
