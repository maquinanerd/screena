import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { HomeLike } from '../../_components/home-like'
import {
  HOME_NEWS_CARD_LIMIT,
  takeSectionCards,
} from '../../../src/lib/portal-presenter'
import { restrictEditorialHighlights } from '../../../src/lib/home-editorial-presenter'
import { filterNewsCardsByVertical } from '../../../src/lib/news-presenter'
import { RANKING_TABS, resolveActiveRankingSlug } from '../../../src/lib/popular-rankings'
import { SERIES_INDEX_PATH, SITE_URL, publicRobots } from '../../../src/lib/site'
import { getHomeCatalogData } from '../../../src/server/home-catalog'
import { getHomeEditorialHighlights } from '../../../src/server/home-editorial'
import { getHomeHeroSlides } from '../../../src/server/home-hero'
import { getHomeTickerItems } from '../../../src/server/home-ticker'
import { getHomeUpcomingSeries } from '../../../src/server/home-upcoming'
import { getPopularRankings } from '../../../src/server/popular-rankings'
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

export default async function SeriesCategoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const rankingActiveSlug = resolveActiveRankingSlug('series', params.ranking)

  const [index, catalog, news, seriesHero, tickerItems, upcoming, editorialHighlights, rankings] =
    await Promise.all([
      getSeriesIndexData(),
      // "Séries da semana" lê o TRENDING (mesma fonte da home), não `index`.
      getHomeCatalogData(),
      getNewsIndexData(),
      // O hero desta rota vem do escopo `series`. Antes ele vinha da lista da home
      // já cortada em 5 — e como filmes entram primeiro nessa lista, com 129
      // filmes em produção a página de séries nunca recebia um slide sequer.
      getHomeHeroSlides('series'),
      getHomeTickerItems('series'),
      getHomeUpcomingSeries(),
      getHomeEditorialHighlights(),
      getPopularRankings('series'),
    ])

  // Só matérias com vínculo `tv` persistido: a página de séries não lista a
  // matéria que só fala de filme.
  const newsCards = takeSectionCards(
    filterNewsCardsByVertical(
      [...(news.view.featured !== null ? [news.view.featured] : []), ...news.view.cards],
      'series',
    ),
    HOME_NEWS_CARD_LIMIT,
  )
  const rankingPanels = RANKING_TABS.series.map((tab, position) => ({
    tab,
    items: rankings[position]?.items ?? [],
  }))

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
        editorialHighlights={restrictEditorialHighlights(editorialHighlights, 'series')}
        editorialInitialVertical="series"
        emptyMessage="Ainda não há séries publicadas nesta seção."
        heroSlides={seriesHero}
        movieCards={[]}
        newsCards={newsCards}
        rankingActiveSlug={rankingActiveSlug}
        rankingPanels={rankingPanels}
        seriesCards={catalog.series}
        showMoviesBand={false}
        showSeriesBand
        tickerItems={tickerItems}
        upcoming={{ items: upcoming, vertical: 'series', route: SERIES_INDEX_PATH }}
        vertical="series"
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
