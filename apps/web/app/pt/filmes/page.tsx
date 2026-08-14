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
import { MOVIES_INDEX_PATH, SITE_URL, publicRobots } from '../../../src/lib/site'
import { getHomeCatalogData } from '../../../src/server/home-catalog'
import { getHomeEditorialHighlights } from '../../../src/server/home-editorial'
import { getHomeHeroSlides } from '../../../src/server/home-hero'
import { getHomeTickerItems } from '../../../src/server/home-ticker'
import { getHomeUpcomingMovies } from '../../../src/server/home-upcoming'
import { getPopularRankings } from '../../../src/server/popular-rankings'
import { getMovieIndexData } from '../../../src/server/entity-indexes'
import { getNewsIndexData } from '../../../src/server/news-pages'

/**
 * Categoria Filmes — tela 04 do canônico (EX-04-dual): "CATEGORY HOME sem
 * layout próprio → home-like + bandas". A rota reusa o template `HomeLike`
 * com dataset de FILMES, banda de filmes ligada (showMoviesBand) e acento/
 * logo vermelhos por contexto (data-vertical + header por rota). Hero mostra
 * só destaques de filme. Contratos de SEO (canonical, robots, CollectionPage,
 * BreadcrumbList, ItemList) permanecem os do índice real.
 *
 * "Em breve" aqui é SÓ FILME (`getHomeUpcomingMovies`): a rota de filmes não
 * mistura vertical. A home mistura; `/pt/series/` mostra só série.
 */

export const dynamic = 'force-dynamic'

const TITLE = 'Filmes'
const DESCRIPTION = 'Explore os filmes catalogados na Cinerie, com páginas editoriais em português.'

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getMovieIndexData()
  const shouldIndex = indexability.decision === 'index'
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(shouldIndex),
    alternates: { canonical: canonicalUrl },
  }
}

export default async function MovieCategoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  // `?ranking=` de OUTRA vertical (ou forjado) cai na primeira aba de filmes —
  // um param nunca dispara a consulta de outra pagina.
  const rankingActiveSlug = resolveActiveRankingSlug('movies', params.ranking)

  const [index, catalog, news, movieHero, tickerItems, upcoming, editorialHighlights, rankings] =
    await Promise.all([
      getMovieIndexData(),
      getHomeCatalogData(),
      getNewsIndexData(),
      // O hero pede o escopo: filtrar a lista da home DEPOIS do corte de 5 era
      // o que deixava a outra vertical sem hero nenhum.
      getHomeHeroSlides('movies'),
      getHomeTickerItems('movies'),
      getHomeUpcomingMovies(),
      getHomeEditorialHighlights(),
      getPopularRankings('movies'),
    ])

  const movieCards = catalog.movies.length > 0 ? catalog.movies : index.view.cards
  // Só matérias com vínculo `movie` persistido (`entity_news_links`): a página
  // de filmes não lista a matéria que só fala de série.
  const newsCards = takeSectionCards(
    filterNewsCardsByVertical(
      [...(news.view.featured !== null ? [news.view.featured] : []), ...news.view.cards],
      'movies',
    ),
    HOME_NEWS_CARD_LIMIT,
  )
  const rankingPanels = RANKING_TABS.movies.map((tab, position) => ({
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
    <main data-vertical="movie">
      <h1 className="visually-hidden">{TITLE}</h1>

      <HomeLike
        adPrefix="filmes"
        editorialHighlights={restrictEditorialHighlights(editorialHighlights, 'movies')}
        editorialInitialVertical="movies"
        emptyMessage="Ainda não há filmes publicados nesta seção."
        heroSlides={movieHero}
        movieCards={movieCards}
        newsCards={newsCards}
        rankingActiveSlug={rankingActiveSlug}
        rankingPanels={rankingPanels}
        seriesCards={[]}
        showMoviesBand
        showSeriesBand={false}
        tickerItems={tickerItems}
        upcoming={{ items: upcoming, vertical: 'movie', route: MOVIES_INDEX_PATH }}
        vertical="movies"
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
