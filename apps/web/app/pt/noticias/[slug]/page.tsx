import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { serializeJsonLd } from '@screena/seo'

import { HOME_PATH, SITE_URL } from '../../../../src/lib/site'
import { getNewsArticleData } from '../../../../src/server/news-pages'

/** Artigo textual alimentado somente pelo CMS real. */

export const dynamic = 'force-dynamic'

const NEWS_INDEX_PATH = '/pt/noticias/'

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
    robots: shouldIndex ? { index: true, follow: true } : { index: false, follow: false },
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
        <nav aria-label="Trilha de navegação">
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

        <article>
          <header>
            {view.category !== null ? <p>{view.category}</p> : null}
            <h1>{view.title}</h1>
            {view.deck !== null ? <p>{view.deck}</p> : null}
            {metaItems.length > 0 ? <p>{metaItems.join(' · ')}</p> : null}
          </header>

          {view.bodyParagraphs.map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
          ))}

          {view.source !== null ? (
            <p>
              Fonte: <strong>{view.source.name}</strong>
            </p>
          ) : null}

          {view.aiAssisted ? (
            <aside role="note">
              Conteúdo produzido com apoio de ferramentas de inteligência artificial e revisado pela
              equipe editorial da Screen.
            </aside>
          ) : null}
        </article>

        {isUnderReview ? (
          <p data-editorial-state="in-review">Esta notícia ainda está em revisão editorial.</p>
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
