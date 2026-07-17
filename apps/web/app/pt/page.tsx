import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import type { EntityCard } from '../../src/lib/entity-index-presenter'
import {
  countPopulatedSections,
  evaluatePortalIndexability,
  HOME_NEWS_CARD_LIMIT,
  takeSectionCards,
} from '../../src/lib/portal-presenter'
import { EXPLORE_PATH, HOME_PATH, MOVIES_INDEX_PATH, NEWS_INDEX_PATH, PEOPLE_INDEX_PATH, SERIES_INDEX_PATH, SITE_URL, canonicalPublicUrl, publicRobots } from '../../src/lib/site'
import { getHomeCatalogData } from '../../src/server/home-catalog'
import { getHomeHeroSlides } from '../../src/server/home-hero'
import { getHomeUpcomingMovies } from '../../src/server/home-upcoming'
import { getNewsIndexData } from '../../src/server/news-pages'

/**
 * Home pública pt-BR reduzida ao conteúdo textual real já persistido.
 *
 * Os getters e a decisão de indexabilidade continuam iguais aos da camada
 * anterior. A rota não cria destaques, rankings, anúncios ou affordances sem
 * contrato: apenas expõe links e dados vindos do PostgreSQL local.
 */

export const dynamic = 'force-dynamic'

const HOME_TITLE = 'Cinerie — filmes, séries, pessoas e notícias'
const HOME_DESCRIPTION =
  'Base editorial de entretenimento em português: fichas de filmes e séries, perfis de pessoas e notícias com curadoria própria da redação da Cinerie.'
const HOME_H1 = 'Cinerie — filmes, séries e pessoas'

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
  const [catalog, news, heroSlides, upcomingMovies] = await Promise.all([
    getHomeCatalogData(),
    getNewsIndexData(),
    getHomeHeroSlides(),
    getHomeUpcomingMovies(),
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
  const seriesWeekCards: EntityCard[] = []
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
      <div className="container">
        <header>
          <h1>{HOME_H1}</h1>
          <p>{HOME_DESCRIPTION}</p>
        </header>

        <nav aria-label="Áreas da Cinerie">
          <ul>
            <li>
              <a href={MOVIES_INDEX_PATH}>Filmes</a>
            </li>
            <li>
              <a href={SERIES_INDEX_PATH}>Séries</a>
            </li>
            <li>
              <a href={PEOPLE_INDEX_PATH}>Pessoas</a>
            </li>
            <li>
              <a href={NEWS_INDEX_PATH}>Notícias</a>
            </li>
            <li>
              <a href={EXPLORE_PATH}>Explorar</a>
            </li>
          </ul>
        </nav>

        {heroSlides.length > 0 ? (
          <section aria-labelledby="home-highlights-title">
            <h2 id="home-highlights-title">Destaques</h2>
            <ul>
              {heroSlides.map((slide) => (
                <li key={slide.href}>
                  <a href={slide.href}>{slide.title}</a>
                  <span> — {slide.eyebrow}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {movieCards.length > 0 ? (
          <section aria-labelledby="home-movies-title">
            <h2 id="home-movies-title">Filmes em alta</h2>
            <ul>
              {movieCards.map((movie) => (
                <li key={movie.href}>
                  <a href={movie.href}>{movie.title}</a>
                  {movie.meta !== null ? <span> — {movie.meta}</span> : null}
                </li>
              ))}
            </ul>
            <p>
              <a href={MOVIES_INDEX_PATH}>Ver todos os filmes</a>
            </p>
          </section>
        ) : null}

        {seriesWeekCards.length > 0 ? (
          <section aria-labelledby="home-series-title">
            <h2 id="home-series-title">Séries da semana</h2>
            <ul>
              {seriesWeekCards.map((series) => (
                <li key={series.href}>
                  <a href={series.href}>{series.title}</a>
                  {series.meta !== null ? <span> — {series.meta}</span> : null}
                </li>
              ))}
            </ul>
            <p>
              <a href={SERIES_INDEX_PATH}>Ver todas as séries</a>
            </p>
          </section>
        ) : null}

        {upcomingMovies.length > 0 ? (
          <section aria-labelledby="home-upcoming-title">
            <h2 id="home-upcoming-title">Em breve</h2>
            <ul>
              {upcomingMovies.map((movie) => (
                <li key={movie.href}>
                  <a href={movie.href}>{movie.title}</a>
                  <span> — estreia em {movie.date}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {newsCards.length > 0 ? (
          <section aria-labelledby="home-news-title">
            <h2 id="home-news-title">Notícias</h2>
            <ul>
              {newsCards.map((article) => (
                <li key={article.href}>
                  <a href={article.href}>{article.title}</a>
                  {article.dateLabel !== null ? <span> — {article.dateLabel}</span> : null}
                </li>
              ))}
            </ul>
            <p>
              <a href={NEWS_INDEX_PATH}>Ver todas as notícias</a>
            </p>
          </section>
        ) : null}

        {!hasPublishedContent ? (
          <p>Ainda não há conteúdo publicado para exibir na página inicial.</p>
        ) : null}
      </div>

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
