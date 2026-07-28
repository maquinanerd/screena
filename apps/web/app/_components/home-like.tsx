import type { ReactNode } from 'react'

import { AdSlot } from './ad-slot'
import { CardBookmark } from './card-bookmark'
import { EmptyState, SectionTitle } from './ds'
import { HomeHeroCarousel } from './home-hero-carousel'
import { HomeTicker } from './home-ticker'
import { MonthStats } from './month-stats'
import { Rail } from './rail'
import type { EntityCard } from '../../src/lib/entity-index-presenter'
import type { HeroSlide } from '../../src/lib/home-hero-presenter'
import type { HomeUpcomingMovie } from '../../src/lib/home-upcoming-presenter'
import type { NewsCardView } from '../../src/lib/news-presenter'
import type { TickerEpisode } from '../../src/server/home-ticker'
import { MOVIES_INDEX_PATH, NEWS_INDEX_PATH, SERIES_INDEX_PATH } from '../../src/lib/site'

/**
 * HomeLike — o TEMPLATE home-like do canonico (tela 02), reusado pelas
 * categorias (tela 04, EX-04-dual): "CATEGORY HOME sem layout proprio →
 * home-like + bandas showMoviesBand/showSeriesBand", mudando dataset, acento e
 * logo por contexto (o acento vem do data-vertical da pagina; o logo, do
 * header por rota). Ordem EXATA do 02-home.html.
 */

export interface HomeLikeProps {
  heroSlides: readonly HeroSlide[]
  tickerEpisodes: readonly TickerEpisode[]
  movieCards: readonly EntityCard[]
  seriesCards: readonly EntityCard[]
  upcomingMovies: readonly HomeUpcomingMovie[]
  newsCards: readonly NewsCardView[]
  showMoviesBand: boolean
  showSeriesBand: boolean
  /** Prefixo dos slotIds de anuncio (home | filmes | series). */
  adPrefix: string
  emptyMessage: string
}

function FreshCard({ card, series = false }: { card: EntityCard; series?: boolean }): ReactNode {
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

export function HomeLike({
  heroSlides,
  tickerEpisodes,
  movieCards,
  seriesCards,
  upcomingMovies,
  newsCards,
  showMoviesBand,
  showSeriesBand,
  adPrefix,
  emptyMessage,
}: HomeLikeProps): ReactNode {
  const featuredSource = showMoviesBand ? movieCards : seriesCards
  const featured = featuredSource.slice(0, 3)
  const popularCards = showMoviesBand ? movieCards : seriesCards
  const newsCategories = [
    ...new Set(newsCards.map((card) => card.category).filter((c): c is string => c !== null)),
  ].slice(0, 6)
  const newsLead: NewsCardView | undefined = newsCards[0]
  const hasContent =
    heroSlides.length +
      movieCards.length +
      seriesCards.length +
      upcomingMovies.length +
      newsCards.length >
    0

  return (
    <>
      {heroSlides.length > 0 ? <HomeHeroCarousel slides={heroSlides} /> : null}

      {/* Ticker de episódios novos HOJE — dado real ou nada */}
      <HomeTicker items={tickerEpisodes} />

      {/* Destaques de hoje — grid 1.62fr 1fr 1fr, cards de 460px */}
      {featured.length > 0 ? (
        <section
          aria-labelledby={`${adPrefix}-featured-title`}
          className="container"
          style={{ paddingTop: 56, paddingBottom: 10 }}
        >
          <div className="feat-head">
            <SectionTitle id={`${adPrefix}-featured-title`} title="Destaques de hoje" />
            <div className="seg-toggle">
              <a
                aria-current={showMoviesBand ? 'page' : undefined}
                className="seg-toggle__opt"
                href={MOVIES_INDEX_PATH}
              >
                Filmes
              </a>
              <a
                aria-current={!showMoviesBand && showSeriesBand ? 'page' : undefined}
                className="seg-toggle__opt"
                href={SERIES_INDEX_PATH}
              >
                Séries
              </a>
            </div>
          </div>
          <div className="feat-grid">
            {featured[0] !== undefined ? (
              <a className="feat-card feat-card--lead" href={featured[0].href}>
                {featured[0].image !== null ? (
                  <img
                    alt=""
                    className="feat-card__img"
                    fetchPriority="high"
                    src={featured[0].image.src}
                  />
                ) : null}
                <span className="feat-card__scrim" />
                <span className="feat-card__body">
                  <h3 className="feat-card__title">{featured[0].title}</h3>
                  {featured[0].meta !== null ? (
                    <p className="feat-card__sub">
                      {featured[0].kind === 'series' ? 'Série' : 'Filme'} · {featured[0].meta}
                    </p>
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
                    {card.kind === 'series' ? 'Série' : 'Filme'}
                    {card.meta !== null ? ` · ${card.meta}` : ''}
                  </span>
                  <h3 className="feat-card__title--sm">{card.title}</h3>
                </span>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {/* Popular essa semana — banda escura com ranking */}
      {popularCards.length > 0 ? (
        <div className="band band--dark">
          <section aria-labelledby={`${adPrefix}-popular-title`} className="band__inner">
            <div className="section-head" style={{ marginBottom: 0 }}>
              <SectionTitle id={`${adPrefix}-popular-title`} title="Popular essa semana" />
              <a className="see-all" href="/pt/onde-assistir/">
                Ver tudo
              </a>
            </div>
            <nav aria-label="Popular por vertical" className="pop-tabs">
              <a
                aria-current={showMoviesBand ? 'true' : undefined}
                className="pop-tabs__tab"
                href={MOVIES_INDEX_PATH}
              >
                Filmes
              </a>
              <a
                aria-current={!showMoviesBand && showSeriesBand ? 'true' : undefined}
                className="pop-tabs__tab"
                href={SERIES_INDEX_PATH}
              >
                Séries
              </a>
            </nav>
            <Rail className="pop-rail" dark label="Popular essa semana">
              {popularCards.map((card, index) => (
                <a className="pop-rail__item" href={card.href} key={card.href}>
                  <span className="pop-rail__poster">
                    {card.image !== null ? (
                      <img alt="" loading="lazy" src={card.image.src} />
                    ) : null}
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
        <AdSlot format="leaderboard" slotId={`${adPrefix}-featured`} />
      </div>

      {/* Filmes em alta — certified-fresh cards (band condicional) */}
      {showMoviesBand && movieCards.length > 0 ? (
        <div className="band" style={{ background: '#FFFFFF' }}>
          <section aria-labelledby={`${adPrefix}-movies-title`} className="band__inner">
            <div className="section-head" style={{ marginBottom: 30 }}>
              <SectionTitle id={`${adPrefix}-movies-title`} title="Filmes em alta" />
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
        <AdSlot format="leaderboard" slotId={`${adPrefix}-filmes-alta`} />
      </div>

      {/* Séries da semana — certified-fresh cards (band condicional) */}
      {showSeriesBand && seriesCards.length > 0 ? (
        <div className="band" style={{ background: '#FFFFFF' }}>
          <section aria-labelledby={`${adPrefix}-series-title`} className="band__inner">
            <div className="section-head" style={{ marginBottom: 30 }}>
              <SectionTitle id={`${adPrefix}-series-title`} title="Séries da semana" />
              <a className="see-all" href={SERIES_INDEX_PATH}>
                Ver tudo
              </a>
            </div>
            <Rail className="fresh-rail" label="Séries da semana">
              {seriesCards.map((card) => (
                <FreshCard card={card} key={card.href} series />
              ))}
            </Rail>
          </section>
        </div>
      ) : null}

      {/* Em breve (Get a Glimpse) — banda escura, cards 332px 16/10 */}
      {upcomingMovies.length > 0 ? (
        <div className="band band--dark" style={{ marginTop: 56 }}>
          <section aria-labelledby={`${adPrefix}-upcoming-title`} className="band__inner">
            <div className="glimpse-head">
              <div>
                <SectionTitle id={`${adPrefix}-upcoming-title`} title="Em breve" />
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
                    {movie.entityId !== null ? (
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
                          <svg
                            aria-hidden="true"
                            fill="none"
                            height="13"
                            viewBox="0 0 24 24"
                            width="13"
                          >
                            <rect
                              height="16"
                              rx="2"
                              stroke="currentColor"
                              strokeWidth="2"
                              width="18"
                              x="3"
                              y="5"
                            />
                            <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" />
                          </svg>
                          {movie.date}
                        </span>
                      </span>
                      <a className="glimpse-card__watch glimpse-card__link" href={movie.href}>
                        Ver ficha
                        <svg
                          aria-hidden="true"
                          fill="currentColor"
                          height="13"
                          viewBox="0 0 24 24"
                          width="13"
                        >
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
        <AdSlot format="leaderboard" slotId={`${adPrefix}-em-breve`} />
      </div>

      {/* Notícias & entrevistas — chips + lead 430 + grade 2x2 */}
      {newsCards.length > 0 ? (
        <div className="band" style={{ background: '#FFFFFF' }}>
          <section aria-labelledby={`${adPrefix}-news-title`} className="band__inner">
            <div className="section-head" style={{ marginBottom: 0 }}>
              <SectionTitle id={`${adPrefix}-news-title`} title="Notícias & entrevistas" />
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
                    <img
                      alt=""
                      className="hnews-lead__img"
                      loading="lazy"
                      src={newsLead.image.src}
                    />
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
        <AdSlot format="leaderboard" slotId={`${adPrefix}-noticias`} />
      </div>

      {!hasContent ? (
        <div className="container section">
          <EmptyState title={emptyMessage}>
            <p>Volte em breve: o catálogo e a redação da Cinerie estão em preparação.</p>
          </EmptyState>
        </div>
      ) : null}
    </>
  )
}
