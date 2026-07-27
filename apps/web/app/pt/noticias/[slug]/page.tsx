import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { serializeJsonLd } from '@screena/seo'

import { AdSlot } from '../../../_components/ad-slot'
import { SectionHead } from '../../../_components/ds'
import { HOME_PATH, SITE_URL, publicRobots } from '../../../../src/lib/site'
import { getNewsArticleData } from '../../../../src/server/news-pages'

/**
 * Artigo — tela 05 do handoff (ArticleTemplate): hero de imagem 16/9 quando
 * existe (sem imagem -> cabeçalho compacto neutro, nunca imagem inventada),
 * corpo em CONTAINER DE LEITURA 720 (body-lg 17/1.7), blocos de fonte /
 * transparência de IA omitidos quando ausentes, entidades relacionadas como
 * pills e AdSlot. Dados 100% do CMS real; draft/agendada/retratada dão 404
 * pelo gate canônico.
 */

export const dynamic = 'force-dynamic'

const NEWS_INDEX_PATH = '/pt/noticias/'

const RELATED_LABELS: Readonly<Record<string, string>> = {
  movie: 'Filme',
  tv: 'Série',
  person: 'Pessoa',
}

interface NewsArticleParams {
  slug: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<NewsArticleParams>
}): Promise<Metadata> {
  const { slug } = await params
  const data = await getNewsArticleData(slug)

  if (data === null) {
    return {
      title: 'Notícia não encontrada',
      robots: { index: false, follow: false },
    }
  }

  const { view, indexability, canonicalUrl } = data
  const shouldIndex = indexability.decision === 'index'
  const metadata: Metadata = {
    title: view.metaTitle ?? `${view.title} — Notícias`,
    robots: publicRobots(shouldIndex),
    alternates: { canonical: canonicalUrl },
  }
  const description = view.metaDescription ?? view.deck
  if (description !== null) metadata.description = description
  return metadata
}

export default async function NewsArticlePage({ params }: { params: Promise<NewsArticleParams> }) {
  const { slug } = await params
  const data = await getNewsArticleData(slug)
  if (data === null) notFound()

  const { view, indexability, canonicalUrl } = data
  const isUnderReview = indexability.decision !== 'index'
  const metaItems = [view.author, view.dateLabel, view.readTimeLabel].filter(
    (item): item is string => item !== null,
  )

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Início',
        item: `${SITE_URL}${HOME_PATH}`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Notícias',
        item: `${SITE_URL}${NEWS_INDEX_PATH}`,
      },
      { '@type': 'ListItem', position: 3, name: view.title, item: canonicalUrl },
    ],
  }

  const articleJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: view.title,
    url: canonicalUrl,
  }
  if (view.dateIso !== null) articleJsonLd.datePublished = view.dateIso
  const jsonDescription = view.metaDescription ?? view.deck
  if (jsonDescription !== null) articleJsonLd.description = jsonDescription
  if (view.author !== null) {
    articleJsonLd.author = { '@type': 'Person', name: view.author }
  }
  if (view.category !== null) articleJsonLd.articleSection = view.category
  if (view.heroImage !== null) {
    articleJsonLd.image = `${SITE_URL}${view.heroImage.src}`
  }

  return (
    <main data-vertical="news">
      <div className="container">
        <nav aria-label="Trilha de navegação" className="breadcrumb">
          <ol>
            <li>
              <a href={HOME_PATH}>Início</a>
            </li>
            <li>
              <a href={NEWS_INDEX_PATH}>Notícias</a>
            </li>
            <li aria-current="page">{view.title}</li>
          </ol>
        </nav>

        {view.heroImage !== null ? (
          <div className="article-hero">
            <div className="article-hero__media">
              <img
                alt=""
                fetchPriority="high"
                height={view.heroImage.height}
                src={view.heroImage.src}
                width={view.heroImage.width}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="container container--reading">
        <article>
          <header className="article-header">
            {view.category !== null ? <span className="eyebrow news-list-card__eyebrow">{view.category}</span> : null}
            <h1 className="article-header__title">{view.title}</h1>
            {view.deck !== null ? <p className="article-header__deck">{view.deck}</p> : null}
            {metaItems.length > 0 ? (
              <p className="article-header__byline">
                {metaItems.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </p>
            ) : null}
          </header>

          <div className="article-body">
            {view.bodyParagraphs.map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
            ))}
          </div>

          {view.source !== null ? (
            <p className="article-footer-block">
              Fonte: <strong>{view.source.name}</strong>
            </p>
          ) : null}

          {view.aiAssisted ? (
            <aside className="article-footer-block" role="note">
              Conteúdo produzido com apoio de ferramentas de inteligência artificial e revisado pela
              equipe editorial da Cinerie.
            </aside>
          ) : null}
        </article>

        <AdSlot format="leaderboard" slotId="article-sources" />
      </div>

      {view.related.length > 0 ? (
        <div className="container">
          <section aria-labelledby="article-related-title" className="section">
            <SectionHead id="article-related-title" title="Entidades relacionadas" />
            <ul className="related-entities">
              {view.related.map((entity) => (
                <li key={`${entity.entityType}:${entity.href}`}>
                  <a href={entity.href}>
                    <span
                      className={
                        entity.entityType === 'movie'
                          ? 'badge badge--movie'
                          : entity.entityType === 'tv'
                            ? 'badge badge--series'
                            : 'badge'
                      }
                    >
                      {RELATED_LABELS[entity.entityType] ?? entity.entityType}
                    </span>
                    {entity.title}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      <div className="container">
        {isUnderReview ? (
          <p className="muted" data-editorial-state="in-review">
            Esta notícia ainda está em revisão editorial.
          </p>
        ) : null}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
