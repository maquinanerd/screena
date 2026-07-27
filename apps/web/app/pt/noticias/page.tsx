import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { AdSlot } from '../../_components/ad-slot'
import { EmptyState, NewsListCard, NewsOverlayCard, SectionHead } from '../../_components/ds'
import type { NewsCardView } from '../../../src/lib/news-presenter'
import { HOME_PATH, SITE_URL, publicRobots } from '../../../src/lib/site'
import { getNewsIndexData } from '../../../src/server/news-pages'

/**
 * Notícias — tela 03 do handoff (NewsIndexTemplate): mosaico de destaques
 * (1 grande + 4 pequenos em overlay escuro de mídia) + grid de cards claros +
 * AdSlots. Somente artigos PUBLICADOS do CMS real; draft/agendada/retratada
 * nunca chegam aqui (gate canônico em @screena/seo).
 */

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

export default async function NewsIndexPage() {
  const { view, canonicalUrl } = await getNewsIndexData()
  const orderedCards = [view.featured, ...view.cards].filter(
    (card): card is NewsCardView => card !== null,
  )
  const mosaic = orderedCards.slice(0, 5)
  const rest = orderedCards.slice(5)

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
        <nav aria-label="Trilha de navegação" className="breadcrumb">
          <ol>
            <li>
              <a href={HOME_PATH}>Início</a>
            </li>
            <li aria-current="page">{TITLE}</li>
          </ol>
        </nav>

        <header className="compact-hero page-header">
          <h1>Notícias &amp; Entrevistas</h1>
          <p>{DESCRIPTION}</p>
        </header>

        {mosaic.length > 0 ? (
          <section aria-labelledby="news-mosaic-title">
            <h2 className="visually-hidden" id="news-mosaic-title">
              Destaques
            </h2>
            <div className="news-mosaic">
              {mosaic[0] !== undefined ? <NewsOverlayCard card={mosaic[0]} lead /> : null}
              {mosaic.length > 1 ? (
                <div className="news-mosaic__side">
                  {mosaic.slice(1).map((card) => (
                    <NewsOverlayCard card={card} key={card.href} />
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        <AdSlot format="leaderboard" slotId="news-mosaic" />

        {rest.length > 0 ? (
          <section aria-labelledby="published-news-title" className="section">
            <SectionHead id="published-news-title" title="Todas as notícias" />
            <ul className="news-grid">
              {rest.map((card) => (
                <li key={card.href}>
                  <NewsListCard card={card} />
                </li>
              ))}
            </ul>
            {view.hasMore ? (
              <p className="muted" style={{ marginTop: 20 }}>
                Mostrando {orderedCards.length} de {view.totalCount} notícias.
              </p>
            ) : null}
          </section>
        ) : null}

        {orderedCards.length === 0 ? (
          <EmptyState title="Ainda não há notícias publicadas nesta seção.">
            <p>A redação da Cinerie publica novas matérias em breve.</p>
          </EmptyState>
        ) : null}

        <AdSlot format="leaderboard" slotId="news-grid" />
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
