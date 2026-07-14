import type { Metadata } from "next";

import { ComingSoonRail, type ComingSoonItem } from "../_components/coming-soon-rail";
import { EntityCardLink } from "../_components/entity-card";
import { HeroCarousel } from "../_components/hero-carousel";
import { NewsCard } from "../_components/news-card";
import { EmptyState, SectionHeader } from "../_components/page-primitives";
import {
  getMovieIndexData,
  getPersonIndexData,
  getSeriesIndexData,
} from "../../src/server/entity-indexes";
import { getHomeHeroSlides } from "../../src/server/home-hero";
import { getHomeUpcomingMovies } from "../../src/server/home-upcoming";
import { getNewsIndexData } from "../../src/server/news-pages";
import {
  countPopulatedSections,
  evaluatePortalIndexability,
  HOME_ENTITY_CARD_LIMIT,
  HOME_NEWS_CARD_LIMIT,
  interleaveUniqueByHref,
  takeSectionCards,
} from "../../src/lib/portal-presenter";
import {
  canonicalPublicUrl,
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  SERIES_INDEX_PATH,
  SITE_URL,
} from "../../src/lib/site";

/**
 * Public Marketing Home v4 — superficie editorial/cinematografica da cinerie.
 *
 * O render le apenas o snapshot local do PostgreSQL. A composicao usa entidades,
 * artigos e lancamentos reais; secoes sem dados recebem um estado vazio honesto.
 * Nao ha mocks de noticias, anuncios, streaming, ranking ou acoes de usuario.
 */
export const dynamic = "force-dynamic";

const HOME_TITLE = "cinerie — filmes, séries, pessoas e notícias";
const HOME_DESCRIPTION =
  "Base editorial de entretenimento em português: fichas de filmes e séries, perfis de pessoas e notícias com curadoria própria da redação da cinerie.";
const HOME_H1 = "cinerie — filmes, séries e pessoas";
const HIGHLIGHT_LIMIT = 6;
const HIGHLIGHTS_PER_VERTICAL = 3;

const HOME_ORGANIZATION_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "cinerie",
  url: `${SITE_URL}/pt/`,
  logo: `${SITE_URL}/brand/cinerie/logo.svg`,
};

const HOME_WEBSITE_JSONLD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "cinerie",
  url: `${SITE_URL}/`,
};

async function getHomeData() {
  const [movies, series, people, news] = await Promise.all([
    getMovieIndexData(),
    getSeriesIndexData(),
    getPersonIndexData(),
    getNewsIndexData(),
  ]);

  const poolLimit = HOME_ENTITY_CARD_LIMIT + HIGHLIGHTS_PER_VERTICAL;
  const moviePool = takeSectionCards(movies.view.cards, poolLimit);
  const seriesPool = takeSectionCards(series.view.cards, poolLimit);
  const highlights = interleaveUniqueByHref(moviePool, seriesPool, HIGHLIGHT_LIMIT);
  const highlightedHrefs = new Set(highlights.map((card) => card.href));
  const movieCards = takeSectionCards(
    moviePool.filter((card) => !highlightedHrefs.has(card.href)),
    HOME_ENTITY_CARD_LIMIT,
  );
  const seriesCards = takeSectionCards(
    seriesPool.filter((card) => !highlightedHrefs.has(card.href)),
    HOME_ENTITY_CARD_LIMIT,
  );
  const newsCards = takeSectionCards(
    [...(news.view.featured !== null ? [news.view.featured] : []), ...news.view.cards],
    HOME_NEWS_CARD_LIMIT,
  );

  const indexability = evaluatePortalIndexability({
    populatedSectionCount: countPopulatedSections([
      moviePool.length,
      seriesPool.length,
      newsCards.length,
    ]),
  });

  return {
    highlights,
    movieCards,
    seriesCards,
    newsCards,
    counts: {
      movies: movies.view.totalCount,
      series: series.view.totalCount,
      people: people.view.totalCount,
    },
    indexability,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const { indexability } = await getHomeData();
  const shouldIndex = indexability.decision === "index";
  const homeCanonicalUrl = canonicalPublicUrl(HOME_PATH);
  const languages =
    homeCanonicalUrl !== null
      ? { "pt-BR": homeCanonicalUrl, "x-default": homeCanonicalUrl }
      : undefined;

  return {
    title: { absolute: HOME_TITLE },
    description: HOME_DESCRIPTION,
    robots: shouldIndex ? { index: true, follow: true } : { index: false, follow: false },
    alternates: { canonical: homeCanonicalUrl, languages },
  };
}

export default async function HomePage() {
  const [home, heroSlides, upcomingMovies] = await Promise.all([
    getHomeData(),
    getHomeHeroSlides(),
    getHomeUpcomingMovies(),
  ]);

  const upcomingItems: ComingSoonItem[] = upcomingMovies.map((movie) => ({
    title: movie.title,
    date: movie.date,
    href: movie.href,
    imageUrl: movie.imageUrl,
  }));
  const featuredNews = home.newsCards[0] ?? null;
  const remainingNews = home.newsCards.slice(1);
  const hasCounts = home.counts.movies > 0 || home.counts.series > 0 || home.counts.people > 0;

  return (
    <main className="home-page" data-vertical="home">
      <h1 className="u-visually-hidden">{HOME_H1}</h1>

      {heroSlides.length > 0 ? (
        <HeroCarousel slides={heroSlides} />
      ) : (
        <section className="sc-hero sc-hero--institutional">
          <div className="sc-hero__wash sc-hero__wash--neutral" aria-hidden="true" />
          <div className="sc-hero__scrim" aria-hidden="true" />
          <div className="sc-hero__inner">
            <div className="sc-hero__lead">
              <span className="sc-hero__eyebrow" data-vertical="neutral">
                Editorial cinerie
              </span>
              <h2 className="sc-hero__title sc-hero__title--sm">
                Filmes, séries, pessoas e notícias em um só lugar.
              </h2>
              <p className="sc-hero__desc">{HOME_DESCRIPTION}</p>
            </div>
          </div>
        </section>
      )}

      <header className="home-intro container">
        <p className="home-intro__eyebrow">Catálogo e contexto editorial</p>
        <h2 className="home-intro__title">{HOME_H1}</h2>
        <p className="home-intro__description">
          Descubra obras e pessoas por páginas de referência, com dados claros e conteúdo editorial
          publicado pela cinerie.
        </p>
      </header>

      <section
        className="home-section home-section--discovery container"
        aria-labelledby="home-discovery-title"
      >
        <SectionHeader
          id="home-discovery-title"
          title="Descubra na cinerie"
          eyebrow="Filmes e séries"
          href={EXPLORE_PATH}
          linkLabel="Explorar catálogo"
        />

        {home.highlights.length > 0 ? (
          <div className="home-discovery">
            <ul className="home-discovery__features">
              {home.highlights.slice(0, 2).map((card, index) => (
                <li key={card.href}>
                  <EntityCardLink card={card} variant="feature" eager={index === 0} />
                </li>
              ))}
            </ul>
            {home.highlights.length > 2 ? (
              <ul className="home-discovery__list">
                {home.highlights.slice(2).map((card) => (
                  <li key={card.href}>
                    <EntityCardLink card={card} variant="compact" />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <EmptyState
            title="O catálogo está sendo preparado"
            description="As primeiras fichas públicas aparecerão aqui assim que estiverem disponíveis."
            headingLevel={3}
          />
        )}
      </section>

      <section className="home-band home-band--movie" aria-labelledby="home-movies-title">
        <div className="home-section container">
          <SectionHeader
            id="home-movies-title"
            title="Filmes na cinerie"
            eyebrow="Cinema"
            vertical="movie"
            href={MOVIES_INDEX_PATH}
            linkLabel="Ver filmes"
          />
          {home.movieCards.length > 0 ? (
            <ul className="entity-grid home-entity-grid">
              {home.movieCards.slice(0, 4).map((card) => (
                <li key={card.href} className="entity-card-item">
                  <EntityCardLink card={card} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="Nenhum filme disponível nesta seleção"
              description="Consulte a página de filmes para acompanhar as próximas fichas publicadas."
              action={{ label: "Abrir filmes", href: MOVIES_INDEX_PATH }}
              headingLevel={3}
            />
          )}
        </div>
      </section>

      {hasCounts ? (
        <section className="home-catalog-strip" aria-label="Catálogo da cinerie">
          <div className="container home-catalog-strip__inner">
            <div className="home-catalog-strip__lead">
              <span>Catálogo público</span>
              <strong>Um universo em expansão.</strong>
            </div>
            <dl className="home-catalog-strip__stats">
              <div>
                <dt>Filmes</dt>
                <dd>{home.counts.movies}</dd>
              </div>
              <div>
                <dt>Séries</dt>
                <dd>{home.counts.series}</dd>
              </div>
              <div>
                <dt>Pessoas</dt>
                <dd>{home.counts.people}</dd>
              </div>
            </dl>
            <a className="home-catalog-strip__link" href={EXPLORE_PATH}>
              Explorar o catálogo
            </a>
          </div>
        </section>
      ) : null}

      <section className="home-section container" aria-labelledby="home-series-title">
        <SectionHeader
          id="home-series-title"
          title="Séries na cinerie"
          eyebrow="Televisão"
          vertical="series"
          href={SERIES_INDEX_PATH}
          linkLabel="Ver séries"
        />
        {home.seriesCards.length > 0 ? (
          <ul className="entity-grid home-entity-grid">
            {home.seriesCards.slice(0, 4).map((card) => (
              <li key={card.href} className="entity-card-item">
                <EntityCardLink card={card} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Nenhuma série disponível nesta seleção"
            description="Consulte a página de séries para acompanhar as próximas fichas publicadas."
            action={{ label: "Abrir séries", href: SERIES_INDEX_PATH }}
            headingLevel={3}
          />
        )}
      </section>

      <section className="home-section container" aria-labelledby="home-upcoming-title">
        {upcomingItems.length > 0 ? (
          <ComingSoonRail
            items={upcomingItems}
            heading={
              <SectionHeader
                id="home-upcoming-title"
                title="Próximos lançamentos"
                eyebrow="Datas confirmadas no catálogo"
                vertical="movie"
                href={MOVIES_INDEX_PATH}
                linkLabel="Ver filmes"
              />
            }
          />
        ) : (
          <>
            <SectionHeader
              id="home-upcoming-title"
              title="Próximos lançamentos"
              eyebrow="Calendário"
              vertical="movie"
            />
            <EmptyState
              title="Sem estreias futuras confirmadas"
              description="Esta área será atualizada quando houver datas futuras já registradas no catálogo."
              action={{ label: "Explorar filmes", href: MOVIES_INDEX_PATH }}
              headingLevel={3}
            />
          </>
        )}
      </section>

      <section
        className="home-section home-section--news container"
        aria-labelledby="home-news-title"
      >
        <SectionHeader
          id="home-news-title"
          title="Notícias e contexto"
          eyebrow="Redação cinerie"
          href={NEWS_INDEX_PATH}
          linkLabel="Abrir notícias"
        />
        {featuredNews !== null ? (
          <div className="home-news-layout">
            <NewsCard card={featuredNews} variant="featured" headingLevel={3} />
            {remainingNews.length > 0 ? (
              <ul className="home-news-layout__grid">
                {remainingNews.map((card) => (
                  <li key={card.href}>
                    <NewsCard card={card} variant="feed" headingLevel={3} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <EmptyState
            title="A redação ainda não publicou notícias"
            description="Enquanto isso, explore as fichas de filmes, séries e pessoas já disponíveis."
            action={{ label: "Explorar catálogo", href: EXPLORE_PATH }}
            headingLevel={3}
          />
        )}
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(HOME_ORGANIZATION_JSONLD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(HOME_WEBSITE_JSONLD) }}
      />
    </main>
  );
}
