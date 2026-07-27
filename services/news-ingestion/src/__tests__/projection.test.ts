/**
 * Testes da projecao publica do artigo: documento de busca e decisao de
 * indexabilidade.
 *
 * O caso mais importante e o NEGATIVO: quando o artigo deixa de ser publicavel,
 * a projecao precisa devolver `null` para que o adapter REMOVA o documento.
 * Projecao que so cria deixa rascunho e materia retratada pesquisaveis depois
 * de sairem do ar.
 */

import { describe, expect, it } from 'vitest'

import { foldText as searchFold } from '../../../ingestion/src/search/fold.js'
import {
  decideArticleIndexability,
  foldText,
  MIN_ARTICLE_BODY_CHARS,
  projectArticleSearchDocument,
  type ArticleProjectionInput,
} from '../projection.js'

const NOW = '2026-07-01T12:00:00.000Z'
const BODY = 'x'.repeat(MIN_ARTICLE_BODY_CHARS)

function article(overrides: Partial<ArticleProjectionInput> = {}): ArticleProjectionInput {
  return {
    articleId: '1',
    locale: 'pt-BR',
    slug: 'trailer-de-duna',
    title: 'Trailer de Duna e divulgado',
    deck: 'Warner mostra a primeira previa',
    body: BODY,
    category: 'Trailers',
    authorName: 'Redacao Cinerie',
    heroImagePath: '/media/news/duna.webp',
    reviewStatus: 'published',
    indexStatus: 'index',
    licenseStatus: 'official',
    displayAllowed: true,
    requiresAttribution: false,
    requiresLinkback: false,
    sourceName: null,
    sourceUrl: null,
    translationPublishedAtIso: '2026-06-30T10:00:00.000Z',
    articlePublishedAtIso: null,
    ...overrides,
  }
}

describe('paridade de dobra com a busca do catalogo', () => {
  it('foldText do editorial == foldText do catalogo', () => {
    // Os dois lados precisam dobrar IGUAL, senao artigo e entidade nao casam
    // com o mesmo termo de busca. Os services nao se importam entre si, entao
    // a igualdade e travada aqui.
    for (const sample of ['Duna: Parte 2', 'ACAO  e  Aventura', 'Ficção Científica', 'ÉÀÇ']) {
      expect(foldText(sample)).toBe(searchFold(sample))
    }
  })
})

describe('projectArticleSearchDocument', () => {
  it('projeta artigo publicado', () => {
    const doc = projectArticleSearchDocument(article(), NOW)
    expect(doc).not.toBeNull()
    expect(doc?.primaryText).toBe('Trailer de Duna e divulgado')
    expect(doc?.canonicalUrl).toBe('/pt/noticias/trailer-de-duna/')
    expect(doc?.subtitle).toBe('Noticia · Trailers')
    expect(doc?.normalizedText).toContain('trailer de duna')
  })

  it('NAO indexa o corpo (busca nao e espelho de conteudo)', () => {
    const doc = projectArticleSearchDocument(
      article({ body: 'segredo-do-corpo '.repeat(30) }),
      NOW,
    )
    expect(doc?.normalizedText).not.toContain('segredo-do-corpo')
    expect(doc?.alternativeText).not.toContain('segredo-do-corpo')
  })

  it('remove o documento (null) quando deixa de ser publicavel', () => {
    expect(projectArticleSearchDocument(article({ reviewStatus: 'draft' }), NOW)).toBeNull()
    expect(projectArticleSearchDocument(article({ reviewStatus: 'archived' }), NOW)).toBeNull()
    expect(projectArticleSearchDocument(article({ reviewStatus: 'blocked' }), NOW)).toBeNull()
    expect(projectArticleSearchDocument(article({ displayAllowed: false }), NOW)).toBeNull()
    expect(projectArticleSearchDocument(article({ licenseStatus: 'unknown' }), NOW)).toBeNull()
    expect(projectArticleSearchDocument(article({ slug: null }), NOW)).toBeNull()
  })

  it('materia AGENDADA nao entra na busca', () => {
    expect(
      projectArticleSearchDocument(
        article({ translationPublishedAtIso: '2026-12-01T00:00:00.000Z' }),
        NOW,
      ),
    ).toBeNull()
  })
})

describe('decideArticleIndexability — precedencia da politica de SEO', () => {
  it('licenca bloqueada vence tudo -> blocked', () => {
    expect(decideArticleIndexability(article({ licenseStatus: 'blocked' }), NOW).decision).toBe(
      'blocked',
    )
    expect(decideArticleIndexability(article({ displayAllowed: false }), NOW).decision).toBe(
      'blocked',
    )
    expect(
      decideArticleIndexability(
        article({ requiresLinkback: true, sourceUrl: null }),
        NOW,
      ).decision,
    ).toBe('blocked')
  })

  it('idioma fora de PUBLISHED_LOCALES -> draft', () => {
    expect(decideArticleIndexability(article({ locale: 'en' }), NOW).decision).toBe('draft')
    expect(decideArticleIndexability(article({ locale: 'es' }), NOW).decision).toBe('draft')
  })

  it('caso tecnico -> noindex', () => {
    expect(decideArticleIndexability(article({ reviewStatus: 'draft' }), NOW).decision).toBe(
      'noindex',
    )
    expect(decideArticleIndexability(article({ body: 'curto' }), NOW).decision).toBe('noindex')
    expect(
      decideArticleIndexability(
        article({ translationPublishedAtIso: '2026-12-01T00:00:00.000Z' }),
        NOW,
      ).decision,
    ).toBe('noindex')
  })

  it('decisao editorial index_status so REBAIXA, nunca forca', () => {
    expect(decideArticleIndexability(article({ indexStatus: 'noindex' }), NOW).decision).toBe(
      'noindex',
    )
    // corpo curto + index_status=index continua noindex
    expect(
      decideArticleIndexability(article({ indexStatus: 'index', body: 'curto' }), NOW).decision,
    ).toBe('noindex')
  })

  it('artigo publicado e licenciado -> index (indexacao total)', () => {
    const d = decideArticleIndexability(article(), NOW)
    expect(d.decision).toBe('index')
    expect(d.url).toBe('/pt/noticias/trailer-de-duna/')
  })
})
