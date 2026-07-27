import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { AdSlot } from '../_components/ad-slot'
import { EmptyState, NewsOverlayCard, PosterGrid, SectionHead } from '../_components/ds'
import { HomeHeroCarousel } from '../_components/home-hero-carousel'
import type { EntityCard } from '../../src/lib/entity-index-presenter'
import {
  countPopulatedSections,
  evaluatePortalIndexability,
  HOME_ENTITY_CARD_LIMIT,
  HOME_NEWS_CARD_LIMIT,
  takeSectionCards,
} from '../../src/lib/portal-presenter'
import {
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  SERIES_INDEX_PATH,
  SITE_URL,
  canonicalPublicUrl,
  publicRobots,
} from '../../src/lib/site'
import { getHomeCatalogData } from '../../src/server/home-catalog'
import { getHomeHeroSlides } from '../../src/server/home-hero'
import { getHomeUpcomingMovies } from '../../src/server/home-upcoming'
import { getNewsIndexData } from '../../src/server/news-pages'
import { getSeriesIndexData } from '../../src/server/entity-indexes'

/**
 * Home pública pt-BR — tela 02 do handoff canônico (HomeTemplate).
 *
 * Estrutura fiel à especificação (43-PUBLIC-SCREEN-SPECIFICATIONS): hero em
 * slides full-bleed, seções editoriais com cabeçalho de duas pesagens, banda
 * escura sancionada para "Em breve", mosaico de notícias e AdSlots de
 * leaderboard entre seções. Toda seção sem dado real é OMITIDA (nunca card
 * fantasma); getters, canonical, robots e JSON-LD são os contratos já ativos.
 *
 * Divergência documentada (required by real data): "Today's Featured Picks" e
 * "Popular This Week" exigem datasets editoriais próprios que ainda não
 * existem; pela regra da própria spec ("seção omitida se vazia"), essas duas
 * seções não renderizam nesta fase.
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
  const [catalog, news, heroSlides, upcomingMovies, seriesIndex] = await Promise.all([
    getHomeCatalogData(),
    getNewsIndexData(),
    getHomeHeroSlides(),
    getHomeUpcomingMovies(),
    getSeriesIndexData(),
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
      upcomingMovies.length,
      newsCards.length,
    ]),
  })

  return {
    heroSlides,
    movieCards,
    seriesWeekCards,
    upcomingMovies,
    newsCards,
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
  const { heroSlides, movieCards, seriesWeekCards, upcomingMovies, newsCards } = await getHomeData()
  const hasPublishedContent =
    heroSlides.length +
      movieCards.length +
      seriesWeekCards.length +
      upcomingMovies.length +
      newsCards.length >
    0

  return (
    <main data-vertical="home">
      <h1 className="visually-hidden">Cinerie — filmes, séries e pessoas</h1>

      {heroSlides.length > 0 ? <HomeHeroCarousel slides={heroSlides} /> : null}

      {movieCards.length > 0 ? (
        <section aria-labelledby="home-movies-title" className="section">
          <div className="container">
            <SectionHead
              id="home-movies-title"
              seeAllHref={MOVIES_INDEX_PATH}
              title="Filmes em alta"
            />
            <PosterGrid cards={movieCards} />
          </div>
        </section>
      ) : null}

      <div className="container">
        <AdSlot format="leaderboard" slotId="home-filmes-alta" />
      </div>

      {seriesWeekCards.length > 0 ? (
        <section aria-labelledby="home-series-title" className="section">
          <div className="container">
            <SectionHead
              id="home-series-title"
              seeAllHref={SERIES_INDEX_PATH}
              title="Séries da semana"
            />
            <PosterGrid cards={seriesWeekCards} />
          </div>
        </section>
      ) : null}

      {upcomingMovies.length > 0 ? (
        <div className="dark-band">
          <section aria-labelledby="home-upcoming-title" className="section">
            <div className="container">
              <SectionHead
                id="home-upcoming-title"
                seeAllHref="/pt/em-breve/"
                title="Em breve"
              />
              <ul className="rail rail--wide">
                {upcomingMovies.map((movie) => (
                  <li key={movie.href}>
                    <article className="trailer-card">
                      <div className="trailer-card__media">
                        {movie.imageUrl !== null ? (
                          <img alt="" loading="lazy" src={movie.imageUrl} />
                        ) : null}
                      </div>
                      <div className="trailer-card__body">
                        <h3 className="trailer-card__title">
                          <a href={movie.href}>{movie.title}</a>
                        </h3>
                        <p className="trailer-card__meta">Estreia em {movie.date}</p>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      ) : null}

      <div className="container">
        <AdSlot format="leaderboard" slotId="home-em-breve" />
      </div>

      {newsCards.length > 0 ? (
        <section aria-labelledby="home-news-title" className="section">
          <div className="container">
            <SectionHead
              id="home-news-title"
              seeAllHref={NEWS_INDEX_PATH}
              title="Notícias & Entrevistas"
            />
            <div className="news-mosaic">
              {newsCards[0] !== undefined ? <NewsOverlayCard card={newsCards[0]} lead /> : null}
              <div className="news-mosaic__side">
                {newsCards.slice(1, 5).map((card) => (
                  <NewsOverlayCard card={card} key={card.href} />
                ))}
              </div>
            </div>
            <AdSlot format="leaderboard" slotId="home-noticias" />
          </div>
        </section>
      ) : null}

      {!hasPublishedContent ? (
        <div className="container section">
          <EmptyState title="Ainda não há conteúdo publicado">
            <p>Volte em breve: o catálogo e a redação da Cinerie estão em preparação.</p>
          </EmptyState>
        </div>
      ) : null}

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
