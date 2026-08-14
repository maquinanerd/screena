import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { HomeLike } from '../_components/home-like'
import type { EntityCard } from '../../src/lib/entity-index-presenter'
import {
  countPopulatedSections,
  evaluatePortalIndexability,
  HOME_ENTITY_CARD_LIMIT,
  HOME_NEWS_CARD_LIMIT,
  takeSectionCards,
} from '../../src/lib/portal-presenter'
import { excludeEditorialHighlights } from '../../src/lib/home-editorial-presenter'
import { hasEnoughUpcoming } from '../../src/lib/home-upcoming-presenter'
import { HOME_PATH, SITE_URL, canonicalPublicUrl, publicRobots } from '../../src/lib/site'
import { getHomeCatalogData } from '../../src/server/home-catalog'
import { getHomeEditorialHighlights } from '../../src/server/home-editorial'
import { getHomeHeroSlides } from '../../src/server/home-hero'
import { getHomeTickerItems } from '../../src/server/home-ticker'
import { getHomeUpcomingMixed } from '../../src/server/home-upcoming'
import { getNewsIndexData } from '../../src/server/news-pages'
import { getSeriesIndexData } from '../../src/server/entity-indexes'

/**
 * Home pública pt-BR — tela 02 do handoff canônico, renderizada pelo template
 * compartilhado `HomeLike` (a MESMA composição é reusada pelas categorias,
 * tela 04, EX-04-dual). Na home, as DUAS bandas (filmes e séries) aparecem —
 * e o trilho "Em breve" segue a mesma regra: aqui ele é MISTO
 * (`getHomeUpcomingMixed`), enquanto `/pt/filmes/` mostra só filmes e
 * `/pt/series/` só séries.
 *
 * "Seu mês em números" e o bookmark dos cards são canônicos e REAIS: a faixa
 * de stats é boundary autenticado no cliente (dado pessoal nunca entra no
 * cache público; anônimo = convite honesto) e o bookmark liga no Backend C
 * (watchlist = UserWatchState.planned) com UMA busca compartilhada por página.
 */

export const dynamic = 'force-dynamic'

const HOME_TITLE = 'Cinerie — filmes, séries, pessoas e notícias'
const HOME_DESCRIPTION =
  'Base editorial de entretenimento em português: fichas de filmes e séries, perfis de pessoas e notícias com curadoria própria da redação da Cinerie.'

const HOME_ORGANIZATION_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Cinerie',
  url: `${SITE_URL}/pt/`,
  logo: `${SITE_URL}/brand/cinerie-logo-black.svg`,
}

const HOME_WEBSITE_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Cinerie',
  url: `${SITE_URL}/`,
}

async function getHomeData() {
  const [
    catalog,
    news,
    heroSlides,
    upcomingItems,
    seriesIndex,
    tickerItems,
    editorialHighlights,
  ] = await Promise.all([
    getHomeCatalogData(),
    getNewsIndexData(),
    getHomeHeroSlides(),
    getHomeUpcomingMixed(),
    getSeriesIndexData(),
    getHomeTickerItems(),
    getHomeEditorialHighlights(),
  ])

  const sourceNews = [
    ...(news.view.featured !== null ? [news.view.featured] : []),
    ...news.view.cards,
  ]
  const seenNews = new Set<string>()
  const newsCards = takeSectionCards(
    sourceNews.filter((card) => {
      if (seenNews.has(card.href)) return false
      seenNews.add(card.href)
      return true
    }),
    HOME_NEWS_CARD_LIMIT,
  )

  // A mesma matéria nunca aparece duas vezes na página: "Destaques de hoje"
  // cede para o bloco "Notícias & entrevistas" (que mostra exatamente estes
  // `newsCards`). Sem compensação — sobrando menos que três, o grid se adapta.
  const dedupedHighlights = excludeEditorialHighlights(
    editorialHighlights,
    new Set(newsCards.map((card) => card.href)),
  )

  const movieCards = catalog.movies
  const seriesWeekCards: EntityCard[] = takeSectionCards(
    seriesIndex.view.cards,
    HOME_ENTITY_CARD_LIMIT,
  )
  const indexability = evaluatePortalIndexability({
    populatedSectionCount: countPopulatedSections([
      heroSlides.length,
      movieCards.length,
      seriesWeekCards.length,
      // Conta o trilho pelo que ele RENDERIZA: abaixo do piso ele não está na
      // página, e uma seção fora da página não é seção populada. O piso vem de
      // `hasEnoughUpcoming` — a MESMA função que o template usa para decidir,
      // para que render e indexabilidade não possam divergir.
      hasEnoughUpcoming(upcomingItems) ? upcomingItems.length : 0,
      newsCards.length,
    ]),
  })

  return {
    heroSlides,
    movieCards,
    seriesWeekCards,
    upcomingItems,
    newsCards,
    tickerItems,
    editorialHighlights: dedupedHighlights,
    indexability,
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { indexability } = await getHomeData()
  const shouldIndex = indexability.decision === 'index'
  const homeCanonicalUrl = canonicalPublicUrl(HOME_PATH)
  return {
    title: { absolute: HOME_TITLE },
    description: HOME_DESCRIPTION,
    robots: publicRobots(shouldIndex),
    alternates: {
      canonical: homeCanonicalUrl,
      languages:
        homeCanonicalUrl !== null
          ? { 'pt-BR': homeCanonicalUrl, 'x-default': homeCanonicalUrl }
          : undefined,
    },
  }
}

export default async function HomePage() {
  const {
    heroSlides,
    movieCards,
    seriesWeekCards,
    upcomingItems,
    newsCards,
    tickerItems,
    editorialHighlights,
  } = await getHomeData()

  return (
    <main data-vertical="home">
      <h1 className="visually-hidden">Cinerie — filmes, séries e pessoas</h1>

      <HomeLike
        adPrefix="home"
        editorialHighlights={editorialHighlights}
        emptyMessage="Ainda não há conteúdo publicado"
        heroSlides={heroSlides}
        movieCards={movieCards}
        newsCards={newsCards}
        seriesCards={seriesWeekCards}
        showMoviesBand
        showSeriesBand
        tickerItems={tickerItems}
        upcoming={{ items: upcomingItems, vertical: 'mixed', route: HOME_PATH }}
      />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(HOME_ORGANIZATION_JSONLD),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(HOME_WEBSITE_JSONLD) }}
      />
    </main>
  )
}
