import type { Metadata } from "next";

import { EntityCardLink } from "../../_components/entity-card";
import { NewsCard } from "../../_components/news-card";
import { Breadcrumbs, PageIntro, SectionHeader } from "../../_components/page-primitives";
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
 * quando > 0). Pela politica de indexacao total, `noindex` fica restrito ao
 * estado tecnico em que nenhuma secao possui dado real.
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
    [...(news.view.featured !== null ? [news.view.featured] : []), ...news.view.cards],
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
    robots: shouldIndex ? { index: true, follow: true } : { index: false, follow: false },
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
      { "@type": "ListItem", position: 1, name: "Início", item: `${SITE_URL}${HOME_PATH}` },
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
        <Breadcrumbs items={[{ label: "Início", href: HOME_PATH }, { label: TITLE }]} />

        <PageIntro title={TITLE} description={DESCRIPTION} vertical="neutral" />

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
              {card.count !== null ? <span className="portal-nav__count">{card.count}</span> : null}
            </a>
          ))}
        </nav>

        {movieCards.length > 0 ? (
          <section className="portal-section" aria-labelledby="explore-movies-title">
            <SectionHeader
              id="explore-movies-title"
              title="Filmes"
              href={MOVIES_INDEX_PATH}
              linkLabel="Ver todos"
              vertical="movie"
            />
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
            <SectionHeader
              id="explore-series-title"
              title="Séries"
              href={SERIES_INDEX_PATH}
              linkLabel="Ver todas"
              vertical="series"
            />
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
            <SectionHeader
              id="explore-people-title"
              title="Pessoas"
              href={PEOPLE_INDEX_PATH}
              linkLabel="Ver todas"
              vertical="person"
            />
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
            <SectionHeader
              id="explore-news-title"
              title="Notícias"
              href={NEWS_INDEX_PATH}
              linkLabel="Ver todas"
              vertical="news"
            />
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
