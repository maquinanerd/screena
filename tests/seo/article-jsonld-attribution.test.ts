/**
 * JSON-LD da materia: atribuicao e secao.
 *
 * Tres defeitos reais, medidos na pagina publicada antes desta correcao:
 *  - `publisher` AUSENTE — `NewsArticle` sem editora perde a atribuicao que
 *    distingue materia de jornal de texto solto;
 *  - `articleSection` saindo `"news"`, em ingles, num site em pt-BR — o
 *    presenter caia para `category`, que carrega o TIPO de conteudo, nao a
 *    editoria;
 *  - `author.url` ausente — este NAO foi "corrigido", e a ausencia agora e
 *    deliberada e documentada (nao existe pagina de autor para apontar).
 */

import { describe, expect, it } from 'vitest'

import { buildArticleJsonLd } from '../../packages/seo/src/article-technical-seo.js'

const facts = {
  canonicalUrl: 'https://cinerie.com/pt/noticias/estreia-da-temporada/',
  canonicalOverride: null,
  decision: 'index' as const,
  title: 'Estreia da temporada',
  metaTitle: null,
  metaDescription: 'O que muda nos primeiros episódios.',
  deck: null,
  socialTitle: null,
  socialDescription: null,
  articleSection: 'Séries',
  schemaTypeRecommendation: null,
  imageUrl: 'https://cinerie.com/media/editorial/capa.jpg',
  imageAlt: 'Cena da nova temporada',
  publishedAtIso: '2026-08-05T12:00:00.000Z',
  updatedAtIso: null,
  authorName: 'Redação Cinerie',
  siteName: 'Cinerie',
  locale: 'pt-BR',
}

describe('publisher', () => {
  it('existe, com nome e URL derivada da canonical', () => {
    const jsonLd = buildArticleJsonLd(facts)
    expect(jsonLd.publisher).toEqual({
      '@type': 'Organization',
      name: 'Cinerie',
      url: 'https://cinerie.com',
    })
  })

  it('a URL vem da CANONICAL, nao de constante — ambiente de teste nao anuncia producao', () => {
    const jsonLd = buildArticleJsonLd({
      ...facts,
      canonicalUrl: 'https://staging.cinerie.test/pt/noticias/x/',
    })
    expect((jsonLd.publisher as Record<string, unknown>).url).toBe('https://staging.cinerie.test')
  })

  it('canonical inutilizavel degrada para publisher sem URL, nao para publisher ausente', () => {
    const jsonLd = buildArticleJsonLd({ ...facts, canonicalUrl: 'nao-e-url' })
    expect(jsonLd.publisher).toEqual({ '@type': 'Organization', name: 'Cinerie' })
  })
})

describe('articleSection', () => {
  it('editoria de verdade e emitida', () => {
    expect(buildArticleJsonLd(facts).articleSection).toBe('Séries')
  })

  it('TIPO DE CONTEUDO nao vira secao — o defeito do "news"', () => {
    for (const contentType of ['news', 'News', 'NEWS', 'review', 'feature']) {
      const jsonLd = buildArticleJsonLd({ ...facts, articleSection: contentType })
      expect(jsonLd.articleSection, contentType).toBeUndefined()
    }
  })

  it('CONTROLE NEGATIVO: uma editoria em portugues parecida NAO e recusada', () => {
    // Sem isto, um filtro largo demais recusaria "Crítica", que E editoria.
    expect(buildArticleJsonLd({ ...facts, articleSection: 'Crítica' }).articleSection).toBe(
      'Crítica',
    )
    expect(buildArticleJsonLd({ ...facts, articleSection: 'Notícias' }).articleSection).toBe(
      'Notícias',
    )
  })
})

describe('author', () => {
  it('sai com nome e SEM url — a pagina de autor nao existe', () => {
    // Emitir `url` para uma pagina inexistente promete perfil verificavel e
    // entrega 404. A ausencia aqui e decisao, nao esquecimento.
    expect(buildArticleJsonLd(facts).author).toEqual({
      '@type': 'Person',
      name: 'Redação Cinerie',
    })
  })

  it('sem autor, a chave nao aparece — autor inventado seria pior', () => {
    expect(buildArticleJsonLd({ ...facts, authorName: null }).author).toBeUndefined()
  })
})
