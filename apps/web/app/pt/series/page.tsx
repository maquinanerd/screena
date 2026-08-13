import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { HomeLike } from '../../_components/home-like'
import {
  HOME_NEWS_CARD_LIMIT,
  takeSectionCards,
} from '../../../src/lib/portal-presenter'
import { SERIES_INDEX_PATH, SITE_URL, publicRobots } from '../../../src/lib/site'
import { getHomeEditorialHighlights } from '../../../src/server/home-editorial'
import { getHomeHeroSlides } from '../../../src/server/home-hero'
import { getHomeTickerItems } from '../../../src/server/home-ticker'
import { getHomeUpcomingSeries } from '../../../src/server/home-upcoming'
import { getNewsIndexData } from '../../../src/server/news-pages'
import { getSeriesIndexData } from '../../../src/server/entity-indexes'

/**
 * Categoria Séries — tela 04 do canônico (EX-04-dual): home-like com a banda
 * de SÉRIES ligada (showSeriesBand), acento/logo verdes por contexto e o
 * ticker de episódios novos (dataset de séries). Contratos de SEO do índice
 * real preservados (canonical, robots, CollectionPage, BreadcrumbList).
 *
 * "Em breve" aqui é SÓ SÉRIE (`getHomeUpcomingSeries` — `TvShow.firstAirDate`
 * futura). A rota passava uma lista vazia fixa, então a seção não existia nesta
 * página: era a única das três superfícies home-like sem o trilho.
 */

export const dynamic = 'force-dynamic'

const TITLE = 'Séries'
const DESCRIPTION = 'Explore as séries catalogadas na Cinerie, com páginas editoriais em português.'

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getSeriesIndexData()
  const shouldIndex = indexability.decision === 'index'
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(shouldIndex),
    alternates: { canonical: canonicalUrl },
  }
}

export default async function SeriesCategoryPage() {
  const [index, news, heroSlides, tickerItems, upcoming, editorialHighlights] = await Promise.all([
    getSeriesIndexData(),
    getNewsIndexData(),
    getHomeHeroSlides(),
    getHomeTickerItems(),
    getHomeUpcomingSeries(),
    getHomeEditorialHighlights(),
  ])

  const seriesHero = heroSlides.filter((slide) => slide.vertical === 'series')
  const newsCards = takeSectionCards(
    [...(news.view.featured !== null ? [news.view.featured] : []), ...news.view.cards],
    HOME_NEWS_CARD_LIMIT,
  )

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/pt/` },
      { '@type': 'ListItem', position: 2, name: TITLE, item: index.canonicalUrl },
    ],
  }
  const collectionJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: TITLE,
    url: index.canonicalUrl,
    description: DESCRIPTION,
  }
  if (index.view.cards.length > 0) {
    collectionJsonLd.mainEntity = {
      '@type': 'ItemList',
      numberOfItems: index.view.cards.length,
      itemListElement: index.view.cards.map((card, position) => ({
        '@type': 'ListItem',
        position: position + 1,
        url: `${SITE_URL}${card.href}`,
        name: card.title,
      })),
    }
  }

  return (
    <main data-vertical="series">
      <h1 className="visually-hidden">{TITLE}</h1>

      <HomeLike
        adPrefix="series"
        editorialHighlights={editorialHighlights}
        editorialInitialVertical="series"
        emptyMessage="Ainda não há séries publicadas nesta seção."
        heroSlides={seriesHero}
        movieCards={[]}
        newsCards={newsCards}
        seriesCards={index.view.cards}
        showMoviesBand={false}
        showSeriesBand
        tickerItems={tickerItems}
        upcoming={{ items: upcoming, vertical: 'series', route: SERIES_INDEX_PATH }}
      />

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
