/**
 * author-presenter.test.ts — a pagina de autor mostra o que o banco sabe de quem
 * assina, e so isso.
 *
 * Auditoria de SEO de 11/09/2026 (secao 3.6): a assinatura das materias era texto
 * simples, sem pagina de autor, e o `NewsArticle` saia sem `author.url`.
 */

import { describe, expect, it } from 'vitest'

import {
  articleCountLabel,
  authorHrefOf,
  authorSlug,
  buildAuthorDirectory,
  describeAuthorProfile,
  findAuthorProfile,
  type AuthorProfileView,
} from '../../apps/web/src/lib/author-presenter'
import type { NewsCardView } from '../../apps/web/src/lib/news-presenter'

function card(overrides: Partial<NewsCardView> = {}): NewsCardView {
  return {
    slug: 'materia',
    title: 'Matéria',
    href: '/pt/noticias/materia/',
    category: null,
    dateIso: '2026-09-01T12:00:00.000Z',
    dateLabel: '1 de setembro de 2026',
    author: 'Pablo Gameleira',
    deck: null,
    readTimeLabel: null,
    image: null,
    linkedEntityTypes: [],
    ...overrides,
  }
}

function first(directory: readonly AuthorProfileView[]): AuthorProfileView {
  const [author] = directory
  if (author === undefined) throw new Error('diretorio vazio: o teste esperava um autor')
  return author
}

describe('authorSlug', () => {
  it('sem acento, minusculo, palavras ligadas por hifen', () => {
    expect(authorSlug('Pablo Gameleira')).toBe('pablo-gameleira')
    expect(authorSlug('  Redação   Cinerie ')).toBe('redacao-cinerie')
    expect(authorSlug("João D'Ávila")).toBe('joao-d-avila')
  })

  it('nome sem letra ou digito latino nao rende slug — e entao nao ha link', () => {
    expect(authorSlug('—')).toBeNull()
    expect(authorSlug('   ')).toBeNull()
    expect(authorSlug(null)).toBeNull()
    expect(authorHrefOf('—')).toBeNull()
    expect(authorHrefOf(null)).toBeNull()
    expect(authorHrefOf('Pablo Gameleira')).toBe('/pt/autores/pablo-gameleira/')
  })
})

describe('buildAuthorDirectory', () => {
  it('uma pagina por slug, com a contagem e a grafia da materia mais recente', () => {
    const directory = buildAuthorDirectory([
      card({
        slug: 'c',
        href: '/pt/noticias/c/',
        dateIso: '2026-09-03T12:00:00.000Z',
        dateLabel: '3 de setembro de 2026',
      }),
      card({
        slug: 'b',
        href: '/pt/noticias/b/',
        dateIso: '2026-09-02T12:00:00.000Z',
        dateLabel: '2 de setembro de 2026',
        author: 'pablo  gameleira',
      }),
      card({ slug: 'a', href: '/pt/noticias/a/', author: 'Redação Cinerie' }),
    ])

    expect(directory.map((author) => author.slug)).toEqual(['pablo-gameleira', 'redacao-cinerie'])
    const pablo = first(directory)
    expect(pablo.name).toBe('Pablo Gameleira')
    expect(pablo.href).toBe('/pt/autores/pablo-gameleira/')
    expect(pablo.articleCount).toBe(2)
    expect(pablo.latestDateIso).toBe('2026-09-03T12:00:00.000Z')
    expect(pablo.latestDateLabel).toBe('3 de setembro de 2026')
    expect(pablo.articles.map((article) => article.slug)).toEqual(['c', 'b'])
  })

  it('materia sem assinatura (ou com assinatura sem slug) nao cria autor', () => {
    expect(buildAuthorDirectory([card({ author: null }), card({ author: '—' })])).toEqual([])
  })

  it('os autores saem pela materia mais recente de cada um', () => {
    const directory = buildAuthorDirectory([
      card({ slug: 'x', dateIso: '2026-09-05T00:00:00.000Z', author: 'Beatriz' }),
      card({ slug: 'y', dateIso: '2026-09-01T00:00:00.000Z', author: 'Ana' }),
    ])
    expect(directory.map((author) => author.name)).toEqual(['Beatriz', 'Ana'])
  })
})

describe('findAuthorProfile', () => {
  it('so o slug canonico casa', () => {
    const directory = buildAuthorDirectory([card()])
    expect(findAuthorProfile(directory, 'pablo-gameleira')?.name).toBe('Pablo Gameleira')
    expect(findAuthorProfile(directory, 'Pablo-Gameleira')).toBeNull()
    expect(findAuthorProfile(directory, 'outro-autor')).toBeNull()
  })
})

describe('textos da pagina de autor', () => {
  it('so fatos que a pagina mostra: quantas materias e a data da mais recente', () => {
    expect(describeAuthorProfile(first(buildAuthorDirectory([card()])))).toBe(
      'Pablo Gameleira assina 1 matéria publicada na Cinerie; a mais recente em 1 de setembro de 2026.',
    )
    expect(
      describeAuthorProfile(
        first(buildAuthorDirectory([card({ slug: 'b' }), card({ slug: 'a', dateIso: null, dateLabel: null })])),
      ),
    ).toBe(
      'Pablo Gameleira assina 2 matérias publicadas na Cinerie; a mais recente em 1 de setembro de 2026.',
    )
    expect(
      describeAuthorProfile(first(buildAuthorDirectory([card({ dateIso: null, dateLabel: null })]))),
    ).toBe('Pablo Gameleira assina 1 matéria publicada na Cinerie.')
  })

  it('contagem no singular e no plural', () => {
    expect(articleCountLabel(1)).toBe('1 matéria')
    expect(articleCountLabel(3)).toBe('3 matérias')
  })
})
