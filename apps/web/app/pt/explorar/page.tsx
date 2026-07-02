import type { Metadata } from "next";

import { EntityCardLink } from "../../_components/entity-card";
import { NewsCard } from "../../_components/news-card";
import {
  getMovieIndexData,
  getPersonIndexData,
  getSeriesIndexData,
} from "../../../src/server/entity-indexes";
import { getNewsIndexData } from "../../../src/server/news-pages";
import {
  countPopulatedSections,
  evaluatePortalIndexability,
  EXPLORE_ENTITY_CARD_LIMIT,
  EXPLORE_NEWS_CARD_LIMIT,
  formatCollectionCount,
  takeSectionCards,
} from "../../../src/lib/portal-presenter";
import {
  canonicalPublicUrl,
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  SERIES_INDEX_PATH,
  SITE_URL,
} from "../../../src/lib/site";

/**
 * Hub exploratorio — /pt/explorar/ (superficie NEUTRA/institucional).
 *
 * IMPORTANTE: esta pagina NAO e busca. Nao ha campo de busca, autosuggest,
 * filtro, ranking ou "populares" — nada e simulado. E um hub de navegacao
 * editorial: cards para as quatro secoes publicas + blocos de descoberta que
 * so aparecem quando ha dado REAL no banco (mesmos getters das listagens).
 *
 * Server component puro (invariantes 3/4): le somente PostgreSQL; zero API
 * externa, zero Gemini, zero TMDB. Sem ratings, sem streaming, sem numeros
 * inventados (as contagens exibidas sao `totalCount` real do banco, e so
 * quando > 0). Gate anti-thin (invariante 5): com menos de 2 secoes com dado
 * real, a pagina existe mas recebe `noindex`.
 */

export const dynamic = "force-dynamic";

const TITLE = "Explorar";
const DESCRIPTION =
  "Navegue pelo catálogo editorial do Screen: filmes, séries, pessoas e notícias em português, com páginas de referência revisadas pela redação.";

async function getExploreData() {
  const [movies, series, people, news] = await Promise.all([
    getMovieIndexData(),
    getSeriesIndexData(),
    getPersonIndexData(),
    getNewsIndexData(),
  ]);
  const movieCards = takeSectionCards(movies.view.cards, EXPLORE_ENTITY_CARD_LIMIT);
  const seriesCards = takeSectionCards(series.view.cards, EXPLORE_ENTITY_CARD_LIMIT);
  const personCards = takeSectionCards(people.view.cards, EXPLORE_ENTITY_CARD_LIMIT);
  const newsCards = takeSectionCards(
    [
      ...(news.view.featured !== null ? [news.view.featured] : []),
      ...news.view.cards,
    ],
    EXPLORE_NEWS_CARD_LIMIT,
  );
  const indexability = evaluatePortalIndexability({
    populatedSectionCount: countPopulatedSections([
      movieCards.length,
      seriesCards.length,
      personCards.length,
      newsCards.length,
    ]),
  });
  return {
    movieCards,
    seriesCards,
    personCards,
    newsCards,
    // Contagens REAIS do banco para os cards do hub (null quando 0).
    movieCount: formatCollectionCount(movies.view.totalCount, "título", "títulos"),
    seriesCount: formatCollectionCount(series.view.totalCount, "título", "títulos"),
    personCount: formatCollectionCount(people.view.totalCount, "perfil", "perfis"),
    newsCount: formatCollectionCount(news.view.totalCount, "notícia", "notícias"),
    indexability,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const { indexability } = await getExploreData();
  const shouldIndex = indexability.decision === "index";
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: shouldIndex
      ? { index: true, follow: true }
      : { index: false, follow: false },
    alternates: { canonical: canonicalPublicUrl(EXPLORE_PATH) },
  };
}

export default async function ExplorePage() {
  const {
    movieCards,
    seriesCards,
    personCards,
    newsCards,
    movieCount,
    seriesCount,
    personCount,
    newsCount,
  } = await getExploreData();

  const canonicalUrl = canonicalPublicUrl(EXPLORE_PATH);

  const hubCards = [
    {
      label: "Explorar filmes",
      href: MOVIES_INDEX_PATH,
      vertical: "movie" as const,
      description: "Fichas editoriais de filmes em português.",
      count: movieCount,
    },
    {
      label: "Explorar séries",
      href: SERIES_INDEX_PATH,
      vertical: "series" as const,
      description: "Séries com guia de temporadas e episódios.",
      count: seriesCount,
    },
    {
      label: "Explorar pessoas",
      href: PEOPLE_INDEX_PATH,
      vertical: "person" as const,
      description: "Perfis de quem faz o cinema e a TV.",
      count: personCount,
    },
    {
      label: "Ler notícias",
      href: NEWS_INDEX_PATH,
      vertical: "news" as const,
      description: "Notícias de entretenimento revisadas pela redação.",
      count: newsCount,
    },
  ];

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}${HOME_PATH}` },
      { "@type": "ListItem", position: 2, name: TITLE, item: canonicalUrl },
    ],
  };

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: TITLE,
    url: canonicalUrl,
    description: DESCRIPTION,
  };

  return (
    <main className="portal-page" data-vertical="explore">
      <div className="container">
        <nav className="breadcrumb" aria-label="Trilha de navegacao">
          <ol>
            <li>
              <a href={HOME_PATH}>Inicio</a>
            </li>
            <li aria-current="page">{TITLE}</li>
          </ol>
        </nav>

        <header className="portal-hero portal-hero--hub">
          <h1 className="portal-hero__title">{TITLE}</h1>
          <p className="portal-hero__desc">{DESCRIPTION}</p>
        </header>

        <nav className="portal-nav" aria-label="Seções do catálogo">
          {hubCards.map((card) => (
            <a
              key={card.href}
              className="portal-nav__card"
              href={card.href}
              data-vertical={card.vertical}
            >
              <span className="portal-nav__label">{card.label}</span>
              <span className="portal-nav__desc">{card.description}</span>
              {card.count !== null ? (
                <span className="portal-nav__count">{card.count}</span>
              ) : null}
            </a>
          ))}
        </nav>

        {movieCards.length > 0 ? (
          <section className="portal-section" aria-labelledby="explore-movies-title">
            <div className="portal-section__head">
              <h2 id="explore-movies-title" className="portal-section__title" data-vertical="movie">
                Filmes
              </h2>
              <a className="portal-section__more" href={MOVIES_INDEX_PATH}>
                Ver todos
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
          <section className="portal-section" aria-labelledby="explore-series-title">
            <div className="portal-section__head">
              <h2 id="explore-series-title" className="portal-section__title" data-vertical="series">
                Séries
              </h2>
              <a className="portal-section__more" href={SERIES_INDEX_PATH}>
                Ver todas
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

        {personCards.length > 0 ? (
          <section className="portal-section" aria-labelledby="explore-people-title">
            <div className="portal-section__head">
              <h2 id="explore-people-title" className="portal-section__title">
                Pessoas
              </h2>
              <a className="portal-section__more" href={PEOPLE_INDEX_PATH}>
                Ver todas
              </a>
            </div>
            <ul className="entity-grid">
              {personCards.map((card) => (
                <li key={card.href} className="entity-card-item">
                  <EntityCardLink card={card} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {newsCards.length > 0 ? (
          <section className="portal-section" aria-labelledby="explore-news-title">
            <div className="portal-section__head">
              <h2 id="explore-news-title" className="portal-section__title">
                Notícias
              </h2>
              <a className="portal-section__more" href={NEWS_INDEX_PATH}>
                Ver todas
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
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
    </main>
  );
}
