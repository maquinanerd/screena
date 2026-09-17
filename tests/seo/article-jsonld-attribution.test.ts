/**
 * JSON-LD da materia: atribuicao e secao.
 *
 * Tres defeitos reais, medidos na pagina publicada antes desta correcao:
 *  - `publisher` AUSENTE — `NewsArticle` sem editora perde a atribuicao que
 *    distingue materia de jornal de texto solto;
 *  - `articleSection` saindo `"news"`, em ingles, num site em pt-BR — o
 *    presenter caia para `category`, que carrega o TIPO de conteudo, nao a
 *    editoria;
 *  - `author.url` ausente — ficou ausente DE PROPOSITO enquanto nao existia
 *    pagina de autor. Desde a remediacao da auditoria de SEO de 11/09/2026 a
 *    pagina existe (`/pt/autores/{slug}/`), e a `url` entra quando o lado publico
 *    a entrega — e so entao.
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
      // O MESMO no da home: um `@id` e a URL publica da home canonica
      // (auditoria de SEO, M7 — eram tres enderecos e nenhum `@id`).
      '@id': 'https://cinerie.com/#organization',
      name: 'Cinerie',
      url: 'https://cinerie.com/pt/',
      // A marca-mae raster: o Google pede logo de publisher em formato de
      // imagem indexavel. Mesma origem da canonical, nunca caminho relativo.
      logo: { '@type': 'ImageObject', url: 'https://cinerie.com/brand/cinerie-logo.png' },
      // A Politica editorial publica: o mesmo `publishingPrinciples` do no da home.
      publishingPrinciples: 'https://cinerie.com/pt/politica-editorial/',
    })
  })

  it('a URL vem da CANONICAL, nao de constante — ambiente de teste nao anuncia producao', () => {
    const jsonLd = buildArticleJsonLd({
      ...facts,
      canonicalUrl: 'https://staging.cinerie.test/pt/noticias/x/',
    })
    expect((jsonLd.publisher as Record<string, unknown>).url).toBe('https://staging.cinerie.test/pt/')
    expect((jsonLd.publisher as Record<string, unknown>)['@id']).toBe(
      'https://staging.cinerie.test/#organization',
    )
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
  it('com pagina de autor: `@id` e `url` do perfil — o MESMO `@id` da pagina de autor', () => {
    expect(
      buildArticleJsonLd({ ...facts, authorUrl: 'https://cinerie.com/pt/autores/redacao-cinerie/' })
        .author,
    ).toEqual({
      '@type': 'Person',
      '@id': 'https://cinerie.com/pt/autores/redacao-cinerie/#person',
      name: 'Redação Cinerie',
      url: 'https://cinerie.com/pt/autores/redacao-cinerie/',
    })
  })

  it('sem pagina de autor: nome e SEM url', () => {
    // Emitir `url` para uma pagina inexistente promete perfil verificavel e
    // entrega 404. Sem pagina, a ausencia continua sendo a resposta certa.
    const semUrl = { '@type': 'Person', name: 'Redação Cinerie' }
    expect(buildArticleJsonLd(facts).author).toEqual(semUrl)
    expect(buildArticleJsonLd({ ...facts, authorUrl: null }).author).toEqual(semUrl)
  })

  it('url que nao e absoluta nao entra', () => {
    expect(buildArticleJsonLd({ ...facts, authorUrl: '/pt/autores/redacao-cinerie/' }).author).toEqual({
      '@type': 'Person',
      name: 'Redação Cinerie',
    })
  })

  it('sem autor, a chave nao aparece — autor inventado seria pior', () => {
    expect(
      buildArticleJsonLd({
        ...facts,
        authorName: null,
        authorUrl: 'https://cinerie.com/pt/autores/redacao-cinerie/',
      }).author,
    ).toBeUndefined()
  })
})

describe('mentions', () => {
  it('as entidades citadas e visiveis, com a pagina de cada uma', () => {
    const jsonLd = buildArticleJsonLd({
      ...facts,
      mentions: [
        { type: 'TVSeries', name: 'Ruptura', url: 'https://cinerie.com/pt/series/ruptura/' },
        { type: 'Person', name: 'Adam Scott', url: 'https://cinerie.com/pt/pessoas/adam-scott/' },
      ],
    })
    expect(jsonLd.mentions).toEqual([
      { '@type': 'TVSeries', name: 'Ruptura', url: 'https://cinerie.com/pt/series/ruptura/' },
      { '@type': 'Person', name: 'Adam Scott', url: 'https://cinerie.com/pt/pessoas/adam-scott/' },
    ])
  })

  it('uma por URL; sem nome ou sem URL absoluta nao entra', () => {
    const jsonLd = buildArticleJsonLd({
      ...facts,
      mentions: [
        { type: 'Movie', name: 'Duna', url: 'https://cinerie.com/pt/filmes/duna/' },
        { type: 'Movie', name: 'Duna de novo', url: 'https://cinerie.com/pt/filmes/duna/' },
        { type: 'Movie', name: '  ', url: 'https://cinerie.com/pt/filmes/sem-nome/' },
        { type: 'Movie', name: 'Relativa', url: '/pt/filmes/relativa/' },
      ],
    })
    expect(jsonLd.mentions).toEqual([
      { '@type': 'Movie', name: 'Duna', url: 'https://cinerie.com/pt/filmes/duna/' },
    ])
  })

  it('sem citacao a chave nao aparece — e `about` nunca: o banco nao marca o assunto', () => {
    expect(buildArticleJsonLd({ ...facts, mentions: [] }).mentions).toBeUndefined()
    expect(buildArticleJsonLd(facts).mentions).toBeUndefined()
    expect(
      buildArticleJsonLd({
        ...facts,
        mentions: [{ type: 'Movie', name: 'Duna', url: 'https://cinerie.com/pt/filmes/duna/' }],
      }).about,
    ).toBeUndefined()
  })
})

describe('dateModified', () => {
  it('a gravacao posterior a publicacao', () => {
    expect(
      buildArticleJsonLd({ ...facts, updatedAtIso: '2026-08-07T09:00:00.000Z' }).dateModified,
    ).toBe('2026-08-07T09:00:00.000Z')
  })

  it('nunca anterior a publicacao: materia agendada e gravada antes de ir ao ar', () => {
    expect(
      buildArticleJsonLd({ ...facts, updatedAtIso: '2026-08-04T09:00:00.000Z' }).dateModified,
    ).toBe('2026-08-05T12:00:00.000Z')
  })

  it('sem gravacao, a publicacao', () => {
    expect(buildArticleJsonLd(facts).dateModified).toBe('2026-08-05T12:00:00.000Z')
  })
})

describe('correction', () => {
  it('a correcao visivel sai como CorrectionComment, com o texto e a data da redacao', () => {
    expect(
      buildArticleJsonLd({
        ...facts,
        correction: { dateIso: '2026-08-07T09:00:00.000Z', note: 'Corrigido o nome do diretor.' },
      }).correction,
    ).toEqual({
      '@type': 'CorrectionComment',
      text: 'Corrigido o nome do diretor.',
      datePublished: '2026-08-07T09:00:00.000Z',
    })
  })

  it('sem correcao visivel — ou sem texto, ou sem data valida — a chave nao aparece', () => {
    expect(buildArticleJsonLd(facts).correction).toBeUndefined()
    expect(buildArticleJsonLd({ ...facts, correction: null }).correction).toBeUndefined()
    expect(
      buildArticleJsonLd({ ...facts, correction: { dateIso: '2026-08-07T09:00:00.000Z', note: '  ' } })
        .correction,
    ).toBeUndefined()
    expect(
      buildArticleJsonLd({ ...facts, correction: { dateIso: 'nao-e-data', note: 'Texto.' } }).correction,
    ).toBeUndefined()
  })
})
