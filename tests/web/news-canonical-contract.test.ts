import { existsSync, readFileSync } from 'node:fs'
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
    expect(article).toContain('view.bodyParagraphs.map')
    expect(article).toContain('view.source !== null')
    expect(article).toContain('view.aiAssisted')
    expect(article).toMatch(/indexability\.decision !== ['"]index['"]/)
    expect(article).toContain('data-editorial-state="in-review"')
  })

  it('preserva NewsArticle e BreadcrumbList em JSON-LD', () => {
    expect(article).toMatch(/['"]@type['"]:\s*['"]NewsArticle['"]/)
    expect(article).toMatch(/['"]@type['"]:\s*['"]BreadcrumbList['"]/)
    expect(article).toContain('articleJsonLd.datePublished')
    expect(article).toContain('articleJsonLd.author')
    expect(article).toContain('articleJsonLd.articleSection')
    expect(article).toContain('articleJsonLd.image')
    expect(article.match(/application\/ld\+json/g)).toHaveLength(2)
  })

  it('design canônico: mosaico/hero reais, AdSlot governado, um H1 por página', () => {
    // Guard ATUALIZADO DELIBERADAMENTE (telas 03/05): o índice ganha o mosaico
    // de destaques e o artigo ganha hero 16/9 QUANDO a matéria tem imagem
    // real; anúncio só via AdSlot (rótulo + omissão por padrão).
    for (const page of [index, article]) {
      expect(page.match(/<h1[\s>]/g)).toHaveLength(1)
      expect(page).toMatch(/<AdSlot format="leaderboard"/)
      expect(page).not.toMatch(/<iframe|doubleclick|adsbygoogle/i)
    }
    expect(index).toContain('NewsOverlayCard')
    expect(article).toContain('view.heroImage !== null ?')
    expect(article).toContain('container--reading')
    // Entidades relacionadas persistidas (nunca inferidas no render)
    expect(article).toContain('view.related.length > 0 ?')
    expect(existsSync(path.join(ROOT, 'apps/web/app/pt/noticias/news-canonical.module.css'))).toBe(
      false,
    )
    expect(
      existsSync(path.join(ROOT, 'apps/web/app/pt/noticias/[slug]/article-canonical.module.css')),
    ).toBe(false)
  })

  it('não introduz conteúdo, compartilhamento ou recursos sociais falsos', () => {
    expect(index).not.toMatch(/Mais lidas|Cinerie Daily|Screen Daily|Assinar grátis|trending/)
    expect(article).not.toMatch(/Minha lista|Avaliar|Compartilhar|relatedArticles/)
    expect(article).not.toMatch(/Daredevil|Marvel|Collider/)
  })
})
