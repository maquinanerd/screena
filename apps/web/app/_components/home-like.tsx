import type { ReactNode } from 'react'

import { AdSlot } from './ad-slot'
import { CardBookmark } from './card-bookmark'
import { EmptyState, SectionTitle } from './ds'
import { HomeEditorialHighlights } from './home-editorial-highlights'
import { HomeHeroCarousel } from './home-hero-carousel'
import { HomeTicker } from './home-ticker'
import { MonthStats } from './month-stats'
import { Rail } from './rail'
import { SectionBoundary } from './section-boundary'
import type { EntityCard } from '../../src/lib/entity-index-presenter'
import {
  hasEditorialHighlights,
  type HomeEditorialHighlights as EditorialHighlights,
  type HomeEditorialVertical,
} from '../../src/lib/home-editorial-presenter'
import type { HeroSlide } from '../../src/lib/home-hero-presenter'
import type { HomeTickerItem } from '../../src/lib/home-ticker-presenter'
import {
  hasEnoughUpcoming,
  type HomeUpcomingItem,
} from '../../src/lib/home-upcoming-presenter'
import type { NewsCardView } from '../../src/lib/news-presenter'
import { decideRouteSection } from '../../src/lib/section-absence'
import { MOVIES_INDEX_PATH, NEWS_INDEX_PATH, SERIES_INDEX_PATH } from '../../src/lib/site'

/**
 * HomeLike — o TEMPLATE home-like do canonico (tela 02), reusado pelas
 * categorias (tela 04, EX-04-dual): "CATEGORY HOME sem layout proprio →
 * home-like + bandas showMoviesBand/showSeriesBand", mudando dataset, acento e
 * logo por contexto (o acento vem do data-vertical da pagina; o logo, do
 * header por rota). Ordem EXATA do 02-home.html.
 */

/**
 * O trilho "Em breve" de UMA rota. As três superfícies home-like mostram a
 * MESMA seção com datasets DIFERENTES — e o `vertical`/`route` viajam junto
 * porque, quando o trilho não renderiza, é isso que o log precisa dizer:
 * "`/pt/series/` consultou séries e voltou vazio", não "sumiu".
 */
export interface HomeLikeUpcoming {
  items: readonly HomeUpcomingItem[]
  /** Dataset consultado: só filmes, só séries, ou os dois (home). */
  vertical: 'movie' | 'series' | 'mixed'
  /** Path público da rota, para a linha de log de ausência. */
  route: string
}

export interface HomeLikeProps {
  heroSlides: readonly HeroSlide[]
  /** Novidades reais da faixa amarela (4–5 no cenário completo). */
  tickerItems: readonly HomeTickerItem[]
  /** Matérias publicadas de "Destaques de hoje", por vertical. */
  editorialHighlights: EditorialHighlights
  /** Tab inicial da seção editorial (home = `movies`; categoria = a da rota). */
  editorialInitialVertical?: HomeEditorialVertical
  movieCards: readonly EntityCard[]
  seriesCards: readonly EntityCard[]
  upcoming: HomeLikeUpcoming
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

/**
 * Card do trilho "Em breve".
 *
 * Na home o trilho é MISTO: filme e série lado a lado. Por isso a vertical
 * viaja em CINCO sinais simultâneos, nunca só na cor (invariante 11):
 *
 *   label      -> `item.verticalLabel` ("Filme"/"Série"), texto visível no badge
 *   badge      -> `.glimpse-card__badge`, elemento próprio sobre o thumb
 *   URL        -> `/pt/filmes/{slug}/` vs `/pt/series/{slug}/` (vem do presenter)
 *   breadcrumb -> a rota de destino já carrega o seu
 *   schema     -> `Movie` vs `TVSeries` na ficha de destino
 *
 * O acento (`data-vertical`) é o SEXTO sinal, de reforço — se ele sumisse, o
 * card continuaria dizendo o que é.
 */
function GlimpseCard({ item }: { item: HomeUpcomingItem }): ReactNode {
  return (
    <article className="glimpse-card" data-vertical={item.vertical}>
      {item.imageUrl !== null ? (
        <img alt="" className="glimpse-card__img" loading="lazy" src={item.imageUrl} />
      ) : null}
      <span className="glimpse-card__scrim" />
      <span className="glimpse-card__badge" data-vertical={item.vertical}>
        {item.verticalLabel}
      </span>
      <span className="glimpse-card__bookmark">
        {item.entityId !== null ? (
          <CardBookmark
            entityId={item.entityId}
            entityType={item.bookmarkType}
            title={item.title}
            variant="circle"
          />
        ) : null}
      </span>
      <span className="glimpse-card__body">
        <span className="glimpse-card__row">
          <span style={{ minWidth: 0 }}>
            <span className="glimpse-card__title">{item.title}</span>
            <span className="glimpse-card__date">
              <svg aria-hidden="true" fill="none" height="13" viewBox="0 0 24 24" width="13">
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
              {item.date}
            </span>
          </span>
          {/* Seis links "Ver ficha" iguais não dizem nada fora de contexto: o
              nome acessível carrega título e vertical. */}
          <a
            aria-label={`Ver ficha de ${item.title} (${item.verticalLabel})`}
            className="glimpse-card__watch glimpse-card__link"
            href={item.href}
          >
            Ver ficha
            <svg aria-hidden="true" fill="currentColor" height="13" viewBox="0 0 24 24" width="13">
              <path d="M8 5v14l11-7z" />
            </svg>
          </a>
        </span>
      </span>
    </article>
  )
}

export function HomeLike({
  heroSlides,
  tickerItems,
  editorialHighlights,
  editorialInitialVertical = 'movies',
  movieCards,
  seriesCards,
  upcoming,
  newsCards,
  showMoviesBand,
  showSeriesBand,
  adPrefix,
  emptyMessage,
}: HomeLikeProps): ReactNode {
  const popularCards = showMoviesBand ? movieCards : seriesCards
  const newsCategories = [
    ...new Set(newsCards.map((card) => card.category).filter((c): c is string => c !== null)),
  ].slice(0, 6)
  const newsLead: NewsCardView | undefined = newsCards[0]
  const hasEditorial = hasEditorialHighlights(editorialHighlights)

  // Trilho "Em breve": ou ele renderiza, ou a linha de log sai — a decisão e o
  // registro são o MESMO ponto (`SectionBoundary`). Um trilho vazio em
  // `/pt/series/` e um trilho que nunca foi ingerido são visualmente idênticos;
  // só o log separa os dois.
  //
  // O piso (`hasEnoughUpcoming`) é parte da decisão, não um `if` à parte: abaixo
  // dele o trilho some COM motivo próprio (`below_upcoming_floor` + a contagem),
  // nunca calado. Um `items.length < 4 && return null` acima daqui devolveria a
  // ausência muda que este bloco existe para impedir.
  const upcomingCount = upcoming.items.length
  const upcomingRendered = hasEnoughUpcoming(upcoming.items)
  const upcomingSection = decideRouteSection(upcomingRendered ? upcoming.items : null, {
    section: 'em-breve',
    reason: upcomingCount === 0 ? 'no_upcoming_title' : 'below_upcoming_floor',
    route: upcoming.route,
    vertical: upcoming.vertical,
    available: upcomingCount,
  })

  // Estado vazio da página conta o trilho pelo que ele RENDERIZA, não pelo que
  // ele tem. Três itens abaixo do piso não são conteúdo publicado na tela.
  const hasContent =
    heroSlides.length +
      movieCards.length +
      seriesCards.length +
      (upcomingRendered ? upcomingCount : 0) +
      newsCards.length >
      0 || hasEditorial

  return (
    <>
      {heroSlides.length > 0 ? <HomeHeroCarousel slides={heroSlides} /> : null}

      {/* Faixa amarela: CARROSSEL de novidades reais (episódio, estreia de
          filme, estreia de temporada, chegada ao streaming). Estrutura fixa da
          composição: sem novidade nenhuma ela permanece, em estado neutro. */}
      <HomeTicker items={tickerItems} />

      {/* Destaques de hoje — seção EDITORIAL: três MATÉRIAS publicadas, grid
          1.62fr 1fr 1fr, cards de 460px. `Filmes`/`Séries` são tabs internas
          (não navegam).

          A seção NUNCA some: sem matéria em vertical alguma, ela declara o
          estado vazio ("Ainda não há destaques...") em vez de desaparecer.
          Sumir em silêncio foi exatamente o defeito nº 3 da lista de descarte
          silencioso — a seção existia desde a PR #91 e uma auditoria inteira a
          declarou inexistente porque ela se escondia quando não havia vínculo.
          Estrutura fixa da composição, como o ticker logo acima. */}
      <section
        aria-labelledby={`${adPrefix}-featured-title`}
        className="container"
        style={{ paddingTop: 48, paddingBottom: 10 }}
      >
        <HomeEditorialHighlights
          headingId={`${adPrefix}-featured-title`}
          highlights={editorialHighlights}
          initialVertical={editorialInitialVertical}
        />
      </section>

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

      {/* Em breve (Get a Glimpse) — banda escura, cards 332px 16/10.
          MESMA seção nas três rotas home-like; o que muda é o dataset:
          /pt/filmes/ = só filmes, /pt/series/ = só séries, /pt/ = os dois. */}
      <SectionBoundary decision={upcomingSection}>
        {(items) => (
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
                {items.map((item) => (
                  <GlimpseCard item={item} key={item.href} />
                ))}
              </Rail>
            </section>
          </div>
        )}
      </SectionBoundary>

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
