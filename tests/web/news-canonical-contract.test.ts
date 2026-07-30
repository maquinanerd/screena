import { existsSync, readFileSync } from 'node:fs'
import { buildArticleJsonLd } from '@screena/seo'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

describe('notícias após o reset visual', () => {
  const index = read('apps/web/app/pt/noticias/page.tsx')
  const article = read('apps/web/app/pt/noticias/[slug]/page.tsx')

  it('lista todas as notícias reais uma única vez e mostra empty state', () => {
    expect(index).toContain('getNewsIndexData()')
    expect(index).toContain('[view.featured, ...view.cards]')
    expect(index).toContain('orderedCards.map')
    expect(index).toContain('Ainda não há notícias publicadas nesta seção.')
    expect(index).toContain('view.hasMore')
  })

  it('mantém metadata, canonical e CollectionPage/BreadcrumbList', () => {
    expect(index).toMatch(/indexability\.decision === ['"]index['"]/)
    expect(index).toContain('alternates: { canonical: canonicalUrl }')
    expect(index).toMatch(/['"]@type['"]:\s*['"]CollectionPage['"]/)
    expect(index).toMatch(/['"]@type['"]:\s*['"]BreadcrumbList['"]/)
    expect(index.match(/application\/ld\+json/g)).toHaveLength(2)
  })

  it('renderiza o artigo real como texto e preserva seu estado editorial', () => {
    expect(article).toContain('getNewsArticleData(slug)')
    expect(article).toContain('notFound()')
    // Corpo real dividido em antes/depois do AdSlot mid-article (tela 05)
    expect(article).toContain('view.bodyParagraphs')
    expect(article).toContain('bodyBefore.map')
    expect(article).toContain('bodyAfter.map')
    expect(article).toContain('view.source !== null')
    expect(article).toContain('view.aiAssisted')
    expect(article).toMatch(/indexability\.decision !== ['"]index['"]/)
    expect(article).toContain('data-editorial-state="in-review"')
  })

  it('preserva NewsArticle e BreadcrumbList em JSON-LD', () => {
    // O JSON-LD do artigo deixou de ser montado a mao na pagina e passou a vir
    // de `buildArticleJsonLd` (@screena/seo), que e puro e testado. Este teste
    // segue a indirecao em vez de grepar o literal: continuar exigindo
    // `"@type": "NewsArticle"` no arquivo da pagina forcaria a duplicacao de
    // volta so para o grep passar — e a duplicacao e o defeito.
    expect(article).toContain('buildArticleJsonLd(')
    expect(article).toMatch(/['"]@type['"]:\s*['"]BreadcrumbList['"]/)
    expect(article.match(/application\/ld\+json/g)).toHaveLength(2)

    // O COMPORTAMENTO, provado de verdade: o tipo emitido e `NewsArticle`, e a
    // marcacao carrega data, autor, secao e imagem quando existem.
    const jsonLd = buildArticleJsonLd({
      canonicalUrl: 'https://cinerie.com/pt/noticias/x/',
      canonicalOverride: null,
      decision: 'index',
      title: 'Titulo',
      metaTitle: null,
      metaDescription: 'Descricao',
      deck: null,
      socialTitle: null,
      socialDescription: null,
      articleSection: 'Series',
      schemaTypeRecommendation: null,
      imageUrl: 'https://cinerie.com/img.jpg',
      imageAlt: 'alt',
      publishedAtIso: '2026-07-29T12:00:00.000Z',
      updatedAtIso: null,
      authorName: 'Redacao',
      siteName: 'Cinerie',
      locale: 'pt-BR',
    })
    expect(jsonLd['@type']).toBe('NewsArticle')
    expect(jsonLd.datePublished).toBe('2026-07-29T12:00:00.000Z')
    expect(jsonLd.author).toEqual({ '@type': 'Person', name: 'Redacao' })
    expect(jsonLd.articleSection).toBe('Series')
    expect(jsonLd.image).toEqual(['https://cinerie.com/img.jpg'])
  })

  it('design canônico (tela 03): layout magazine, AdSlot governado, um H1 por página', () => {
    // Ordem: tabs+ad no header → magazine lead (feature 1.02/1.18 + rail
    // 290px) → 3 cards → Ad → feed 1fr/340px.
    const order = [
      'className="nws-header"',
      'className="nws-lead-grid"',
      'className="nws-feature"',
      'className="nws-cards3"',
      'className="nws-rail"',
      'className="nws-feed section"',
    ]
    let cursor = -1
    for (const marker of order) {
      const at = index.indexOf(marker)
      expect(at, `marcador ausente/fora de ordem: ${marker}`).toBeGreaterThan(cursor)
      cursor = at
    }
    for (const page of [index, article]) {
      expect(page.match(/<h1[\s>]/g)).toHaveLength(1)
      expect(page).toMatch(/<AdSlot format="(?:leaderboard|skyscraper)"/)
      expect(page).not.toMatch(/<iframe|doubleclick|adsbygoogle/i)
    }
    expect(article).toContain('view.heroImage !== null ?')
    // Tela 05: hero escuro -> corpo 720 -> ficha do titulo -> leia tambem
    const articleOrder = [
      'className="art-hero"',
      'className="art-body"',
      'className="art-ficha"',
      'className="read-also"',
    ]
    let artCursor = -1
    for (const marker of articleOrder) {
      const at = article.indexOf(marker)
      expect(at, `marcador ausente/fora de ordem: ${marker}`).toBeGreaterThan(artCursor)
      artCursor = at
    }
    // Entidades citadas persistidas (nunca inferidas no render)
    expect(article).toContain('view.related.length > 0 ?')
    // Ficha do titulo: so com entidade real hidratada; score honesto (bloqueado)
    expect(article).toContain('card !== null ?')
    expect(article).toContain('ainda não calculado')
    expect(article).not.toMatch(/AggregateRating/)
    expect(existsSync(path.join(ROOT, 'apps/web/app/pt/noticias/news-canonical.module.css'))).toBe(
      false,
    )
    expect(
      existsSync(path.join(ROOT, 'apps/web/app/pt/noticias/[slug]/article-canonical.module.css')),
    ).toBe(false)
  })

  it('share/minha-lista são reais; nada de conteúdo fake ou de amostra', () => {
    expect(index).not.toMatch(/Mais lidas|Cinerie Daily|Screen Daily|Assinar grátis|trending/)
    // Compartilhar = links reais de share (sem SDK/script externo no render)
    expect(article).toContain('x.com/intent/post')
    expect(article).toContain('facebook.com/sharer')
    expect(article).not.toMatch(/<script[^>]*src=|sdk\.js/)
    // "Minha lista" e o CardBookmark REAL (Backend C); "Avaliar" nao existe
    // como UI real ainda -> proibido botao morto
    expect(article).toContain('CardBookmark')
    expect(article).not.toMatch(/Avaliar/)
    // Nunca dados de amostra do prototipo
    expect(article).not.toMatch(/Daredevil|Marvel|Collider/)
    expect(article).not.toMatch(/relatedArticles/)
  })
})
