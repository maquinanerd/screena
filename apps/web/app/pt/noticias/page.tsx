import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import type { NewsCardView } from '../../../src/lib/news-presenter'
import { HOME_PATH, SITE_URL, publicRobots } from '../../../src/lib/site'
import { getNewsIndexData } from '../../../src/server/news-pages'

/** Lista textual de notícias publicadas pelo CMS real. */

export const dynamic = 'force-dynamic'

const TITLE = 'Notícias'
const DESCRIPTION =
  'Últimas notícias e análises editoriais da Cinerie sobre cinema e séries, em português.'

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getNewsIndexData()
  const shouldIndex = indexability.decision === 'index'
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(shouldIndex),
    alternates: { canonical: canonicalUrl },
  }
}

function NewsMeta({ card }: { card: NewsCardView }) {
  const items = [card.category, card.dateLabel, card.author, card.readTimeLabel].filter(
    (item): item is string => item !== null,
  )
  return items.length > 0 ? <p>{items.join(' · ')}</p> : null
}

export default async function NewsIndexPage() {
  const { view, canonicalUrl } = await getNewsIndexData()
  const orderedCards = [view.featured, ...view.cards].filter(
    (card): card is NewsCardView => card !== null,
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
      { '@type': 'ListItem', position: 2, name: TITLE, item: canonicalUrl },
    ],
  }

  const collectionJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: TITLE,
    url: canonicalUrl,
    description: DESCRIPTION,
  }
  if (orderedCards.length > 0) {
    collectionJsonLd.mainEntity = {
      '@type': 'ItemList',
      numberOfItems: orderedCards.length,
      itemListElement: orderedCards.map((card, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: `${SITE_URL}${card.href}`,
        name: card.title,
      })),
    }
  }

  return (
    <main data-vertical="news">
      <div className="container">
        <nav aria-label="Trilha de navegação">
          <ol>
            <li>
              <a href={HOME_PATH}>Início</a>
            </li>
            <li aria-current="page">{TITLE}</li>
          </ol>
        </nav>

        <header>
          <h1>{TITLE}</h1>
          <p>{DESCRIPTION}</p>
        </header>

        {orderedCards.length > 0 ? (
          <section aria-labelledby="published-news-title">
            <h2 id="published-news-title">Publicadas recentemente</h2>
            <ul>
              {orderedCards.map((card) => (
                <li key={card.href}>
                  <article>
                    <h3>
                      <a href={card.href}>{card.title}</a>
                    </h3>
                    <NewsMeta card={card} />
                    {card.deck !== null ? <p>{card.deck}</p> : null}
                  </article>
                </li>
              ))}
            </ul>
            {view.hasMore ? (
              <p>
                Mostrando {orderedCards.length} de {view.totalCount} notícias.
              </p>
            ) : null}
          </section>
        ) : (
          <p>Ainda não há notícias publicadas nesta seção.</p>
        )}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(collectionJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
