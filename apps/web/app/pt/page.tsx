import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { AdSlot } from '../_components/ad-slot'
import { EmptyState, SectionTitle } from '../_components/ds'
import { HomeHeroCarousel } from '../_components/home-hero-carousel'
import { CardBookmark } from '../_components/card-bookmark'
import { HomeTicker } from '../_components/home-ticker'
import { MonthStats } from '../_components/month-stats'
import { Rail } from '../_components/rail'
import type { EntityCard } from '../../src/lib/entity-index-presenter'
import type { NewsCardView } from '../../src/lib/news-presenter'
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
import { getHomeTickerEpisodes } from '../../src/server/home-ticker'
import { getHomeUpcomingMovies } from '../../src/server/home-upcoming'
import { getNewsIndexData } from '../../src/server/news-pages'
import { getSeriesIndexData } from '../../src/server/entity-indexes'

/**
 * Home pública pt-BR — tela 02 do handoff canônico, na ORDEM EXATA do HTML:
 * hero em slides → ticker de episódios novos (só com dado real) → Destaques de
 * hoje (grid 1.62fr/1fr/1fr) → Popular essa semana (banda escura com ranks) →
 * Ad → Filmes em alta (certified-fresh) → Ad → Séries da semana → Em breve
 * (banda escura, cards 16/10 com Watch) → Ad → Notícias & entrevistas (chips +
 * lead 430 + grade 2x2) → Ad.
 *
 * "Seu mês em números" e o bookmark dos cards são CANÔNICOS e reais:
 * a faixa de stats é um boundary autenticado no cliente (dado pessoal nunca
 * entra no cache público; anônimo = convite honesto) e o bookmark liga no
 * Backend C (watchlist = UserWatchState.planned) com UMA busca compartilhada
 * por página. Divergências restantes em DESIGN-DELTA.md (ex.: logo de
 * provedor por licença; "Ver trailer" sem contrato de vídeo por card).
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
  const [catalog, news, heroSlides, upcomingMovies, seriesIndex, tickerEpisodes] =
    await Promise.all([
      getHomeCatalogData(),
      getNewsIndexData(),
      getHomeHeroSlides(),
      getHomeUpcomingMovies(),
      getSeriesIndexData(),
      getHomeTickerEpisodes(),
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
    tickerEpisodes,
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

function FreshCard({ card, series = false }: { card: EntityCard; series?: boolean }) {
  return (
    <article className={series ? 'fresh-card fresh-card--series' : 'fresh-card'}>
      <div className="fresh-card__head">
        {card.screenScore !== null ? (
          <span className="fresh-card__rating">
            <svg aria-hidden="true" fill="currentColor" height="13" viewBox="0 0 24 24" width="13">
              <path d="M12 2.4l2.92 6.24 6.83.9-5.04 4.73 1.3 6.79L12 17.7l-6.01 3.36 1.3-6.79L2.25 9.54l6.83-.9z" />
            </svg>
            {card.screenScore}
          </span>
        ) : (
          <span aria-hidden="true" />
        )}
        {card.meta !== null ? <span className="fresh-card__meta">{card.meta}</span> : null}
      </div>
      <div className="fresh-card__poster">
        {card.image !== null ? <img alt="" loading="lazy" src={card.image.src} /> : null}
      </div>
      <div className="fresh-card__body">
        <h3 className="fresh-card__title">{card.title}</h3>
        <div className="fresh-card__cta-row">
          {/* Link principal (stretched): o card inteiro navega, DD-19 */}
          <a className="fresh-card__cta fresh-card__link" href={card.href}>
            Ver detalhes
          </a>
          {/* Bookmark REAL (watchlist = UserWatchState.planned, C8) */}
          {card.entityId !== null ? (
            <CardBookmark
              entityId={card.entityId}
              entityType={series ? 'tv' : 'movie'}
              title={card.title}
            />
          ) : null}
        </div>
      </div>
    </article>
  )
}

export default async function HomePage() {
  const { heroSlides, movieCards, seriesWeekCards, upcomingMovies, newsCards, tickerEpisodes } =
    await getHomeData()
  const hasPublishedContent =
    heroSlides.length +
      movieCards.length +
      seriesWeekCards.length +
      upcomingMovies.length +
      newsCards.length >
    0

  const featured = movieCards.slice(0, 3)
  const newsCategories = [
    ...new Set(newsCards.map((card) => card.category).filter((c): c is string => c !== null)),
  ].slice(0, 6)
  const newsLead: NewsCardView | undefined = newsCards[0]

  return (
    <main data-vertical="home">
      <h1 className="visually-hidden">Cinerie — filmes, séries e pessoas</h1>

      {heroSlides.length > 0 ? <HomeHeroCarousel slides={heroSlides} /> : null}

      {/* Ticker de episódios novos HOJE — dado real ou nada */}
      <HomeTicker items={tickerEpisodes} />

      {/* Destaques de hoje — grid 1.62fr 1fr 1fr, cards de 460px */}
      {featured.length > 0 ? (
        <section aria-labelledby="home-featured-title" className="container" style={{ paddingTop: 56, paddingBottom: 10 }}>
          <div className="feat-head">
            <SectionTitle id="home-featured-title" title="Destaques de hoje" />
            <div className="seg-toggle">
              <a aria-current="page" className="seg-toggle__opt" href={MOVIES_INDEX_PATH}>
                Filmes
              </a>
              <a className="seg-toggle__opt" href={SERIES_INDEX_PATH}>
                Séries
              </a>
            </div>
          </div>
          <div className="feat-grid">
            {featured[0] !== undefined ? (
              <a className="feat-card feat-card--lead" href={featured[0].href}>
                {featured[0].image !== null ? (
                  <img alt="" className="feat-card__img" fetchPriority="high" src={featured[0].image.src} />
                ) : null}
                <span className="feat-card__scrim" />
                <span className="feat-card__body">
                  <h3 className="feat-card__title">{featured[0].title}</h3>
                  {featured[0].meta !== null ? (
                    <p className="feat-card__sub">Filme · {featured[0].meta}</p>
                  ) : null}
                </span>
              </a>
            ) : null}
            {featured.slice(1, 3).map((card, index) => (
              <a className="feat-card feat-card--poster" href={card.href} key={card.href}>
                {card.image !== null ? (
                  <img alt="" className="feat-card__img" loading="lazy" src={card.image.src} />
                ) : null}
                <span className="feat-card__scrim" />
                <span className="feat-card__body">
                  <span
                    className={
                      index === 0 ? 'feat-card__kicker' : 'feat-card__kicker feat-card__kicker--dim'
                    }
                  >
                    {card.meta !== null ? `Filme · ${card.meta}` : 'Filme'}
                  </span>
                  <h3 className="feat-card__title--sm">{card.title}</h3>
                </span>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {/* Popular essa semana — banda escura com ranking */}
      {movieCards.length > 0 ? (
        <div className="band band--dark">
          <section aria-labelledby="home-popular-title" className="band__inner">
            <div className="section-head" style={{ marginBottom: 0 }}>
              <SectionTitle id="home-popular-title" title="Popular essa semana" />
              <a className="see-all" href="/pt/onde-assistir/">
                Ver tudo
              </a>
            </div>
            <nav aria-label="Popular por vertical" className="pop-tabs">
              <a aria-current="true" className="pop-tabs__tab" href={MOVIES_INDEX_PATH}>
                Filmes
              </a>
              <a className="pop-tabs__tab" href={SERIES_INDEX_PATH}>
                Séries
              </a>
            </nav>
            <Rail className="pop-rail" dark label="Popular essa semana">
              {movieCards.map((card, index) => (
                <a className="pop-rail__item" href={card.href} key={card.href}>
                  <span className="pop-rail__poster">
                    {card.image !== null ? <img alt="" loading="lazy" src={card.image.src} /> : null}
                  </span>
                  <span aria-hidden="true" className="pop-rail__rank">
                    <span>{index + 1}</span>
                  </span>
                  <span className="visually-hidden">
                    {index + 1}º: {card.title}
                  </span>
                </a>
              ))}
            </Rail>
          </section>
        </div>
      ) : null}

      <div className="container">
        <AdSlot format="leaderboard" slotId="home-featured" />
      </div>

      {/* Filmes em alta — certified-fresh cards */}
      {movieCards.length > 0 ? (
        <div className="band" style={{ background: '#FFFFFF' }}>
          <section aria-labelledby="home-movies-title" className="band__inner">
            <div className="section-head" style={{ marginBottom: 30 }}>
              <SectionTitle id="home-movies-title" title="Filmes em alta" />
              <a className="see-all" href={MOVIES_INDEX_PATH}>
                Ver tudo
              </a>
            </div>
            <Rail className="fresh-rail" label="Filmes em alta">
              {movieCards.map((card) => (
                <FreshCard card={card} key={card.href} />
              ))}
            </Rail>
          </section>
        </div>
      ) : null}

      {/* Seu mês em números — boundary autenticado; anônimo = estado honesto */}
      <MonthStats />

      <div className="container">
        <AdSlot format="leaderboard" slotId="home-filmes-alta" />
      </div>

      {/* Séries da semana — certified-fresh cards */}
      {seriesWeekCards.length > 0 ? (
        <div className="band" style={{ background: '#FFFFFF' }}>
          <section aria-labelledby="home-series-title" className="band__inner">
            <div className="section-head" style={{ marginBottom: 30 }}>
              <SectionTitle id="home-series-title" title="Séries da semana" />
              <a className="see-all" href={SERIES_INDEX_PATH}>
                Ver tudo
              </a>
            </div>
            <Rail className="fresh-rail" label="Séries da semana">
              {seriesWeekCards.map((card) => (
                <FreshCard card={card} key={card.href} series />
              ))}
            </Rail>
          </section>
        </div>
      ) : null}

      {/* Em breve (Get a Glimpse) — banda escura, cards 332px 16/10 */}
      {upcomingMovies.length > 0 ? (
        <div className="band band--dark" style={{ marginTop: 56 }}>
          <section aria-labelledby="home-upcoming-title" className="band__inner">
            <div className="glimpse-head">
              <div>
                <SectionTitle id="home-upcoming-title" title="Em breve" />
                <p className="glimpse-head__sub">Próximos lançamentos no catálogo</p>
              </div>
              <a className="see-all" href="/pt/em-breve/">
                Ver tudo
              </a>
            </div>
            <Rail className="glimpse-rail" dark label="Em breve">
              {upcomingMovies.map((movie) => (
                <article className="glimpse-card" key={movie.href}>
                  {movie.imageUrl !== null ? (
                    <img alt="" className="glimpse-card__img" loading="lazy" src={movie.imageUrl} />
                  ) : null}
                  <span className="glimpse-card__scrim" />
                  <span className="glimpse-card__bookmark">
                    {movie.entityId !== undefined && movie.entityId !== null ? (
                      <CardBookmark
                        entityId={movie.entityId}
                        entityType="movie"
                        title={movie.title}
                        variant="circle"
                      />
                    ) : null}
                  </span>
                  <span className="glimpse-card__body">
                    <span className="glimpse-card__row">
                      <span style={{ minWidth: 0 }}>
                        <span className="glimpse-card__title">{movie.title}</span>
                        <span className="glimpse-card__date">
                          <svg aria-hidden="true" fill="none" height="13" viewBox="0 0 24 24" width="13">
                            <rect height="16" rx="2" stroke="currentColor" strokeWidth="2" width="18" x="3" y="5" />
                            <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" />
                          </svg>
                          {movie.date}
                        </span>
                      </span>
                      <a className="glimpse-card__watch glimpse-card__link" href={movie.href}>
                        Ver ficha
                        <svg aria-hidden="true" fill="currentColor" height="13" viewBox="0 0 24 24" width="13">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </a>
                    </span>
                  </span>
                </article>
              ))}
            </Rail>
          </section>
        </div>
      ) : null}

      <div className="container">
        <AdSlot format="leaderboard" slotId="home-em-breve" />
      </div>

      {/* Notícias & entrevistas — chips + lead 430 + grade 2x2 */}
      {newsCards.length > 0 ? (
        <div className="band" style={{ background: '#FFFFFF' }}>
          <section aria-labelledby="home-news-title" className="band__inner">
            <div className="section-head" style={{ marginBottom: 0 }}>
              <SectionTitle id="home-news-title" title="Notícias & entrevistas" />
              <a className="see-all" href={NEWS_INDEX_PATH}>
                Ver tudo
              </a>
            </div>
            <p className="hnews-sub">
              Crônicas do cinema: lançamentos, bastidores e entrevistas do mundo dos filmes e
              séries
            </p>
            {newsCategories.length > 0 ? (
              <ul className="hnews-chips">
                <li>
                  <a aria-current="true" href={NEWS_INDEX_PATH}>
                    Recomendados
                  </a>
                </li>
                {newsCategories.map((category) => (
                  <li key={category}>
                    <a href={NEWS_INDEX_PATH}>{category}</a>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="hnews-grid">
              {newsLead !== undefined ? (
                <a className="hnews-lead" href={newsLead.href}>
                  {newsLead.image !== null ? (
                    <img alt="" className="hnews-lead__img" loading="lazy" src={newsLead.image.src} />
                  ) : null}
                  <span className="hnews-lead__scrim" />
                  <span className="hnews-lead__body">
                    <h3 className="hnews-lead__title">{newsLead.title}</h3>
                    {newsLead.deck !== null ? (
                      <p className="hnews-lead__sub">{newsLead.deck}</p>
                    ) : null}
                  </span>
                </a>
              ) : null}
              <div className="hnews-side">
                {newsCards.slice(1, 5).map((card) => (
                  <a className="hnews-card" href={card.href} key={card.href}>
                    {card.image !== null ? (
                      <img alt="" className="hnews-card__img" loading="lazy" src={card.image.src} />
                    ) : null}
                    <span className="hnews-card__scrim" />
                    <span className="hnews-card__body">
                      <h3 className="hnews-card__title">{card.title}</h3>
                      {card.deck !== null ? <p className="hnews-card__sub">{card.deck}</p> : null}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <div className="container" style={{ paddingBottom: 56 }}>
        <AdSlot format="leaderboard" slotId="home-noticias" />
      </div>

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
