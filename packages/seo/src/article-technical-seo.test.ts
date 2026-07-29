/**
 * Testes do SEO tecnico de artigo.
 *
 * O que estes testes defendem: a fronteira entre o que o CMS APROVA e o que o
 * lado publico DERIVA. Cada caso abaixo existe porque cruzar essa linha produz
 * um defeito que so aparece no indice do buscador — tarde, e sem sintoma local.
 */

import { describe, expect, it } from 'vitest'

import {
  articleRobots,
  buildArticleJsonLd,
  buildOpenGraph,
  buildTwitter,
  resolveCanonical,
  resolveInternalLinks,
  resolveSchemaType,
  socialDescriptionOf,
  socialTitleOf,
  type ArticleSeoFacts,
} from './article-technical-seo.js'

function facts(overrides: Partial<ArticleSeoFacts> = {}): ArticleSeoFacts {
  return {
    canonicalUrl: 'https://cinerie.com/pt/noticias/materia-exemplo/',
    canonicalOverride: null,
    decision: 'index',
    title: 'Estudio confirma data de estreia',
    metaTitle: 'Data de estreia confirmada pelo estudio',
    metaDescription: 'O estudio confirmou a data de estreia da nova serie.',
    deck: 'Producao chega em marco',
    socialTitle: null,
    socialDescription: null,
    articleSection: 'Series',
    schemaTypeRecommendation: 'NewsArticle',
    imageUrl: 'https://cinerie.com/media/cartaz.jpg',
    imageAlt: 'Cartaz oficial da serie',
    publishedAtIso: '2026-07-29T12:00:00.000Z',
    updatedAtIso: null,
    authorName: 'Redacao Cinerie',
    siteName: 'Cinerie',
    locale: 'pt-BR',
    ...overrides,
  }
}

describe('resolveCanonical', () => {
  it('sem override, a pagina e autorreferente', () => {
    const verdict = resolveCanonical(facts())
    expect(verdict.href).toBe('https://cinerie.com/pt/noticias/materia-exemplo/')
    expect(verdict.overridden).toBe(false)
  })

  it('override editorial e aplicado quando a pagina INDEXA', () => {
    const verdict = resolveCanonical(
      facts({ canonicalOverride: 'https://parceiro.com/materia-original/' }),
    )
    expect(verdict.href).toBe('https://parceiro.com/materia-original/')
    expect(verdict.overridden).toBe(true)
  })

  it('pagina NAO indexavel ignora o override', () => {
    // Uma pagina `noindex` apontando canonical para outra URL e pior que
    // inutil: consolida sinais numa pagina cujo conteudo o buscador foi
    // instruido a ignorar, e ainda sugere que a versao boa e outra.
    for (const decision of ['noindex', 'draft', 'stale', 'blocked'] as const) {
      const verdict = resolveCanonical(
        facts({ decision, canonicalOverride: 'https://parceiro.com/x/' }),
      )
      expect(verdict.href).toBe('https://cinerie.com/pt/noticias/materia-exemplo/')
      expect(verdict.overridden).toBe(false)
    }
  })

  it('override relativo NAO e aplicado', () => {
    // Canonical relativa e resolvida contra a URL corrente e vira
    // autorreferente sem ninguem perceber — o pior tipo de falha, silenciosa.
    const verdict = resolveCanonical(facts({ canonicalOverride: '/pt/outra/' }))
    expect(verdict.overridden).toBe(false)
    expect(verdict.reason).toContain('https absoluta')
  })

  it('override http (sem TLS) NAO e aplicado', () => {
    const verdict = resolveCanonical(facts({ canonicalOverride: 'http://parceiro.com/x/' }))
    expect(verdict.overridden).toBe(false)
  })

  it('override igual a canonical nao conta como override', () => {
    const verdict = resolveCanonical(
      facts({ canonicalOverride: 'https://cinerie.com/pt/noticias/materia-exemplo/' }),
    )
    expect(verdict.overridden).toBe(false)
  })

  it('override em branco e ruido, nao decisao', () => {
    const verdict = resolveCanonical(facts({ canonicalOverride: '   ' }))
    expect(verdict.overridden).toBe(false)
    expect(verdict.href).toBe('https://cinerie.com/pt/noticias/materia-exemplo/')
  })
})

describe('articleRobots', () => {
  it('so `index` indexa', () => {
    expect(articleRobots('index').index).toBe(true)
    for (const decision of ['noindex', 'draft', 'stale', 'blocked'] as const) {
      expect(articleRobots(decision).index).toBe(false)
    }
  })

  it('`follow` continua verdadeiro mesmo em noindex', () => {
    // Nao indexar ESTA pagina nao e motivo para desperdicar os links dela.
    expect(articleRobots('noindex').follow).toBe(true)
    expect(articleRobots('blocked').googleBot?.follow).toBe(true)
  })
})

describe('titulo e descricao sociais', () => {
  it('a cascata respeita o titulo social quando existe', () => {
    // O que funciona numa SERP nao funciona num card social. Quando o editor
    // escreveu um titulo social, ele sabia disso.
    expect(socialTitleOf(facts({ socialTitle: 'Card proprio' }))).toBe('Card proprio')
  })

  it('sem titulo social, cai para metaTitle e depois para o titulo', () => {
    expect(socialTitleOf(facts())).toBe('Data de estreia confirmada pelo estudio')
    expect(socialTitleOf(facts({ metaTitle: null }))).toBe('Estudio confirma data de estreia')
    expect(socialTitleOf(facts({ metaTitle: '   ' }))).toBe('Estudio confirma data de estreia')
  })

  it('a descricao cai para deck quando nao ha meta', () => {
    expect(socialDescriptionOf(facts({ metaDescription: null }))).toBe('Producao chega em marco')
    expect(socialDescriptionOf(facts({ metaDescription: null, deck: null }))).toBeNull()
  })
})

describe('buildOpenGraph', () => {
  it('a URL do card acompanha a canonical, incluindo o override', () => {
    // Apontar o compartilhamento para uma URL e a canonical para outra divide o
    // sinal social entre duas paginas.
    const og = buildOpenGraph(facts({ canonicalOverride: 'https://parceiro.com/original/' }))
    expect(og.url).toBe('https://parceiro.com/original/')
  })

  it('imagem sem alt cai para o titulo, nunca para vazio', () => {
    const og = buildOpenGraph(facts({ imageAlt: '  ' }))
    expect(og.images?.[0]?.alt).toBe('Estudio confirma data de estreia')
  })

  it('sem imagem, nao declara `images`', () => {
    expect(buildOpenGraph(facts({ imageUrl: null })).images).toBeUndefined()
  })

  it('carrega datas e secao quando existem', () => {
    const og = buildOpenGraph(facts({ updatedAtIso: '2026-07-30T09:00:00.000Z' }))
    expect(og.publishedTime).toBe('2026-07-29T12:00:00.000Z')
    expect(og.modifiedTime).toBe('2026-07-30T09:00:00.000Z')
    expect(og.section).toBe('Series')
  })
})

describe('buildTwitter', () => {
  it('o tipo do card acompanha a existencia da imagem', () => {
    // Declarar `summary_large_image` sem imagem produz um card degradado.
    expect(buildTwitter(facts()).card).toBe('summary_large_image')
    expect(buildTwitter(facts({ imageUrl: null })).card).toBe('summary')
  })
})

describe('resolveSchemaType', () => {
  it('aceita NewsArticle e Article', () => {
    expect(resolveSchemaType('NewsArticle')).toMatchObject({ type: 'NewsArticle', accepted: true })
    expect(resolveSchemaType('Article')).toMatchObject({ type: 'Article', accepted: true })
  })

  it('RECUSA Review — schema falso e a mesma familia de AggregateRating fabricada', () => {
    const verdict = resolveSchemaType('Review')
    expect(verdict.type).toBe('NewsArticle')
    expect(verdict.accepted).toBe(false)
  })

  it('RECUSA ItemList e HowTo — quem sabe a estrutura da pagina e o render', () => {
    // Aceitar cego marcaria como lista uma pagina de paragrafos corridos.
    expect(resolveSchemaType('ItemList').accepted).toBe(false)
    expect(resolveSchemaType('HowTo').accepted).toBe(false)
  })

  it('sem recomendacao, NewsArticle', () => {
    expect(resolveSchemaType(null).type).toBe('NewsArticle')
    expect(resolveSchemaType('  ').type).toBe('NewsArticle')
  })
})

describe('buildArticleJsonLd', () => {
  it('mainEntityOfPage aponta para a canonical resolvida', () => {
    const jsonLd = buildArticleJsonLd(facts({ canonicalOverride: 'https://parceiro.com/o/' }))
    expect(jsonLd.url).toBe('https://parceiro.com/o/')
    expect(jsonLd.mainEntityOfPage).toEqual({
      '@type': 'WebPage',
      '@id': 'https://parceiro.com/o/',
    })
  })

  it('dateModified cai para datePublished quando nao houve atualizacao', () => {
    // Sem `dateModified`, o buscador presume que a materia nunca mudou.
    const jsonLd = buildArticleJsonLd(facts())
    expect(jsonLd.dateModified).toBe('2026-07-29T12:00:00.000Z')
  })

  it('NUNCA emite aggregateRating nem review', () => {
    // Ratings externos e reviews proprias nao sao produto ativo com licenca
    // decidida. Emitir qualquer um deles aqui seria schema fabricado.
    const jsonLd = buildArticleJsonLd(facts({ schemaTypeRecommendation: 'Review' }))
    expect(jsonLd.aggregateRating).toBeUndefined()
    expect(jsonLd.review).toBeUndefined()
    expect(jsonLd['@type']).toBe('NewsArticle')
  })

  it('omite campos ausentes em vez de emitir vazio', () => {
    const jsonLd = buildArticleJsonLd(
      facts({
        metaDescription: null,
        deck: null,
        authorName: null,
        articleSection: null,
        imageUrl: null,
        publishedAtIso: null,
      }),
    )
    expect(jsonLd.description).toBeUndefined()
    expect(jsonLd.author).toBeUndefined()
    expect(jsonLd.articleSection).toBeUndefined()
    expect(jsonLd.image).toBeUndefined()
    expect(jsonLd.datePublished).toBeUndefined()
    expect(jsonLd.dateModified).toBeUndefined()
  })
})

describe('resolveInternalLinks', () => {
  const slugs = {
    'movie:1': 'duna-parte-tres',
    'tv_show:2': 'a-nova-serie',
    'person:3': 'diretora-exemplo',
  }

  it('monta href da rota publica de cada tipo', () => {
    const resolved = resolveInternalLinks(
      [
        { targetType: 'movie', targetId: '1', anchorText: 'Duna' },
        { targetType: 'tv_show', targetId: '2', anchorText: 'a serie' },
      ],
      slugs,
    )
    expect(resolved).toEqual([
      { href: '/pt/filmes/duna-parte-tres/', anchorText: 'Duna' },
      { href: '/pt/series/a-nova-serie/', anchorText: 'a serie' },
    ])
  })

  it('alvo SEM slug conhecido e descartado, nao renderizado com id cru', () => {
    // Link interno quebrado em pagina indexavel gasta rastreamento e sinaliza
    // qualidade baixa.
    const resolved = resolveInternalLinks(
      [{ targetType: 'movie', targetId: '999', anchorText: 'Desconhecido' }],
      slugs,
    )
    expect(resolved).toEqual([])
  })

  it('tipo de alvo sem rota publica e descartado', () => {
    const resolved = resolveInternalLinks(
      [{ targetType: 'franchise', targetId: '1', anchorText: 'Franquia' }],
      { 'franchise:1': 'duna' },
    )
    expect(resolved).toEqual([])
  })

  it('dedup por DESTINO — dois links para a mesma pagina diluem a ancora', () => {
    const resolved = resolveInternalLinks(
      [
        { targetType: 'movie', targetId: '1', anchorText: 'Duna' },
        { targetType: 'movie', targetId: '1', anchorText: 'o filme' },
      ],
      slugs,
    )
    expect(resolved).toHaveLength(1)
  })

  it('ancora vazia nao vira link', () => {
    const resolved = resolveInternalLinks(
      [{ targetType: 'movie', targetId: '1', anchorText: '   ' }],
      slugs,
    )
    expect(resolved).toEqual([])
  })
})
