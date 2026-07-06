import type { Metadata } from "next";

import { EntityCardLink } from "../_components/entity-card";
import { NewsCard } from "../_components/news-card";
import { HeroCarousel } from "../_components/hero-carousel";
import {
  getMovieIndexData,
  getSeriesIndexData,
} from "../../src/server/entity-indexes";
import { getHomeHeroSlides } from "../../src/server/home-hero";
import { getNewsIndexData } from "../../src/server/news-pages";
import {
  countPopulatedSections,
  evaluatePortalIndexability,
  HOME_ENTITY_CARD_LIMIT,
  HOME_NEWS_CARD_LIMIT,
  takeSectionCards,
} from "../../src/lib/portal-presenter";
import {
  canonicalPublicUrl,
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  SERIES_INDEX_PATH,
} from "../../src/lib/site";

/**
 * Home publica pt-BR — /pt/ (superficie NEUTRA/institucional; invariante 11:
 * sem cor de vertical como identidade — o vermelho/verde aparecem so como
 * apoio nas secoes de filmes/series, sempre com label textual).
 *
 * Server component puro: le somente PostgreSQL via os getters de listagem ja
 * existentes (invariantes 3/4 — zero API externa, zero Gemini, zero TMDB no
 * render). NADA e inventado: as secoes de conteudo so aparecem quando ha dado
 * real no banco; sem dados, a home degrada para o hero institucional + cards
 * de navegacao (fallback seguro). Sem ratings, sem streaming, sem "populares",
 * sem numeros fake, sem busca.
 *
 * Gate anti-thin (invariante 5): com menos de 2 secoes com dado real, a home
 * existe mas recebe `noindex` (decisao de `evaluatePortalIndexability`).
 */

export const dynamic = "force-dynamic";

const HOME_TITLE = "Screen — filmes, séries, pessoas e notícias";
const HOME_DESCRIPTION =
  "Base editorial de entretenimento em português: fichas de filmes e séries, perfis de pessoas e notícias com curadoria própria da redação do Screen.";

/** Cards de navegacao institucional (todas as rotas EXISTEM; sem link morto). */
const NAV_CARDS = [
  {
    label: "Filmes",
    href: MOVIES_INDEX_PATH,
    vertical: "movie" as const,
    description: "Fichas editoriais de filmes em português.",
  },
  {
    label: "Séries",
    href: SERIES_INDEX_PATH,
    vertical: "series" as const,
    description: "Séries com guia de temporadas e episódios.",
  },
  {
    label: "Pessoas",
    href: PEOPLE_INDEX_PATH,
    vertical: "person" as const,
    description: "Perfis de quem faz o cinema e a TV.",
  },
  {
    label: "Notícias",
    href: NEWS_INDEX_PATH,
    vertical: "news" as const,
    description: "Notícias de entretenimento revisadas pela redação.",
  },
];

async function getHomeData() {
  const [movies, series, news] = await Promise.all([
    getMovieIndexData(),
    getSeriesIndexData(),
    getNewsIndexData(),
  ]);
  const movieCards = takeSectionCards(movies.view.cards, HOME_ENTITY_CARD_LIMIT);
  const seriesCards = takeSectionCards(series.view.cards, HOME_ENTITY_CARD_LIMIT);
  // `featured` e o primeiro card do feed em destaque na listagem de noticias;
  // na home usamos a lista unica (featured + demais), sem duplicar.
  const newsCards = takeSectionCards(
    [
      ...(news.view.featured !== null ? [news.view.featured] : []),
      ...news.view.cards,
    ],
    HOME_NEWS_CARD_LIMIT,
  );
  const indexability = evaluatePortalIndexability({
    populatedSectionCount: countPopulatedSections([
      movieCards.length,
      seriesCards.length,
      newsCards.length,
    ]),
  });
  return { movieCards, seriesCards, newsCards, indexability };
}

export async function generateMetadata(): Promise<Metadata> {
  const { indexability } = await getHomeData();
  const shouldIndex = indexability.decision === "index";
  return {
    title: { absolute: HOME_TITLE },
    description: HOME_DESCRIPTION,
    robots: shouldIndex
      ? { index: true, follow: true }
      : { index: false, follow: false },
    alternates: { canonical: canonicalPublicUrl(HOME_PATH) },
  };
}

export default async function HomePage() {
  const [{ movieCards, seriesCards, newsCards }, heroSlides] = await Promise.all([
    getHomeData(),
    getHomeHeroSlides(),
  ]);

  return (
    <main className="portal-page" data-vertical="home">
      {/* Hero-carousel cinematografico (design v4): varios slides, cada um com
          titulo, linha de metadados (info · nota editorial do Screen ·
          classificacao), botoes e creditos textuais (diretor/elenco/sinopse).
          SEM poster/card lateral. Client component puro de IO — recebe os slides
          ja montados do PostgreSQL. Sem slides reais, cai para o hero
          institucional (copy propria, tambem sem poster). */}
      {heroSlides.length > 0 ? (
        <HeroCarousel slides={heroSlides} />
      ) : (
        <section className="sc-hero sc-hero--institutional">
          <div className="sc-hero__wash sc-hero__wash--neutral" aria-hidden="true" />
          <div className="sc-hero__scrim" aria-hidden="true" />
          <div className="sc-hero__inner">
            <div className="sc-hero__lead">
              <span className="sc-hero__eyebrow" data-vertical="neutral">
                The Screen
              </span>
              <h1 className="sc-hero__title sc-hero__title--sm">
                Filmes, séries, pessoas e notícias — em um só lugar.
              </h1>
              <p className="sc-hero__desc">{HOME_DESCRIPTION}</p>
            </div>
          </div>
        </section>
      )}

      <div className="container">
        <nav className="portal-nav" aria-label="Seções do Screen">
          {NAV_CARDS.map((card) => (
            <a
              key={card.href}
              className="portal-nav__card"
              href={card.href}
              data-vertical={card.vertical}
            >
              <span className="portal-nav__label">{card.label}</span>
              <span className="portal-nav__desc">{card.description}</span>
            </a>
          ))}
        </nav>

        {movieCards.length > 0 ? (
          <section className="portal-section" aria-labelledby="home-movies-title">
            <div className="portal-section__head">
              <h2 id="home-movies-title" className="portal-section__title" data-vertical="movie">
                Filmes no catálogo
              </h2>
              <a className="portal-section__more" href={MOVIES_INDEX_PATH}>
                Ver todos os filmes
              </a>
            </div>
            <ul className="entity-grid">
              {movieCards.map((card) => (
                <li key={card.href} className="entity-card-item">
                  <EntityCardLink card={card} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {seriesCards.length > 0 ? (
          <section className="portal-section" aria-labelledby="home-series-title">
            <div className="portal-section__head">
              <h2 id="home-series-title" className="portal-section__title" data-vertical="series">
                Séries no catálogo
              </h2>
              <a className="portal-section__more" href={SERIES_INDEX_PATH}>
                Ver todas as séries
              </a>
            </div>
            <ul className="entity-grid">
              {seriesCards.map((card) => (
                <li key={card.href} className="entity-card-item">
                  <EntityCardLink card={card} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {newsCards.length > 0 ? (
          <section className="portal-section" aria-labelledby="home-news-title">
            <div className="portal-section__head">
              <h2 id="home-news-title" className="portal-section__title">
                Últimas notícias
              </h2>
              <a className="portal-section__more" href={NEWS_INDEX_PATH}>
                Ver todas as notícias
              </a>
            </div>
            <ul className="news-grid">
              {newsCards.map((card) => (
                <li key={card.href} className="news-grid__item">
                  <NewsCard card={card} variant="feed" />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="portal-explore-note">
          Quer navegar por tudo? <a href={EXPLORE_PATH}>Explore filmes, séries, pessoas e notícias</a>.
        </p>
      </div>
    </main>
  );
}
