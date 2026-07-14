import type { Metadata } from "next";
import type { ReactNode } from "react";

import type { EntityCard } from "../../src/lib/entity-index-presenter";
import {
  countPopulatedSections,
  evaluatePortalIndexability,
  HOME_NEWS_CARD_LIMIT,
  takeSectionCards,
} from "../../src/lib/portal-presenter";
import {
  canonicalPublicUrl,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  SERIES_INDEX_PATH,
  SITE_URL,
} from "../../src/lib/site";
import { getHomeCatalogData } from "../../src/server/home-catalog";
import { getHomeHeroSlides } from "../../src/server/home-hero";
import { getHomeUpcomingMovies } from "../../src/server/home-upcoming";
import { getNewsIndexData } from "../../src/server/news-pages";
import { AdSlot } from "../_components/ad-slot";
import { ComingSoonRail } from "../_components/coming-soon-rail";
import type { ComingSoonItem } from "../_components/coming-soon-rail";
import { HeroCarousel } from "../_components/hero-carousel";

/**
 * Home pública pt-BR, portada da tela Home (`02`) do pacote cinematográfico.
 *
 * A ordem dos blocos é fixa e igual ao HTML canônico. Se um contrato de dado
 * ainda não existe, a seção correspondente não renderiza; as demais não são
 * reordenadas. Todo conteúdo vem do PostgreSQL local pelos getters server-only.
 */

export const dynamic = "force-dynamic";

const HOME_TITLE = "Screen — filmes, séries, pessoas e notícias";
const HOME_DESCRIPTION =
  "Base editorial de entretenimento em português: fichas de filmes e séries, perfis de pessoas e notícias com curadoria própria da redação do Screen.";
const HOME_H1 = "Screen — filmes, séries e pessoas";

const HOME_ORGANIZATION_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Screen",
  url: `${SITE_URL}/pt/`,
  logo: `${SITE_URL}/brand/screen-logo-black.svg`,
};

const HOME_WEBSITE_JSONLD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Screen",
  url: `${SITE_URL}/`,
};

type HomeNewsImage = { src: string; width: number; height: number };
type HomeNewsFeature = {
  badge: string | null;
  title: string;
  sub: string | null;
  href: string;
  image: HomeNewsImage | null;
};
type HomeNewsMini = Omit<HomeNewsFeature, "badge">;

async function getHomeData() {
  const [catalog, news, heroSlides, upcomingMovies] = await Promise.all([
    getHomeCatalogData(),
    getNewsIndexData(),
    getHomeHeroSlides(),
    getHomeUpcomingMovies(),
  ]);

  const sourceNews = [
    ...(news.view.featured !== null ? [news.view.featured] : []),
    ...news.view.cards,
  ];
  const seenNews = new Set<string>();
  const newsCards = takeSectionCards(
    sourceNews.filter((card) => {
      if (seenNews.has(card.href)) return false;
      seenNews.add(card.href);
      return true;
    }),
    HOME_NEWS_CARD_LIMIT,
  );

  // O snapshot de popularidade persistido sustenta “Filmes em alta”. Não há
  // janela semanal real para “Séries da semana”, portanto essa faixa permanece
  // omitida até existir o presenter temporal exigido pelo pacote.
  const movieCards = catalog.movies;
  const seriesWeekCards: EntityCard[] = [];
  const indexability = evaluatePortalIndexability({
    populatedSectionCount: countPopulatedSections([
      heroSlides.length,
      movieCards.length,
      seriesWeekCards.length,
      upcomingMovies.length,
      newsCards.length,
    ]),
  });

  return {
    heroSlides,
    movieCards,
    seriesWeekCards,
    upcomingMovies,
    newsCards,
    indexability,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const { indexability } = await getHomeData();
  const shouldIndex = indexability.decision === "index";
  const homeCanonicalUrl = canonicalPublicUrl(HOME_PATH);
  return {
    title: { absolute: HOME_TITLE },
    description: HOME_DESCRIPTION,
    robots: shouldIndex
      ? { index: true, follow: true }
      : { index: false, follow: false },
    alternates: {
      canonical: homeCanonicalUrl,
      languages:
        homeCanonicalUrl !== null
          ? { "pt-BR": homeCanonicalUrl, "x-default": homeCanonicalUrl }
          : undefined,
    },
  };
}

function SectionHeader({
  title,
  titleId,
  href,
  accent,
}: {
  title: string;
  titleId: string;
  href: string;
  accent: "red" | "green";
}) {
  return (
    <div className="home-v4-section-head">
      <div className="home-v4-section-title-wrap">
        <span
          className={`home-v4-section-accent home-v4-section-accent--${accent}`}
          aria-hidden="true"
        />
        <h2 id={titleId} className="home-v4-section-title">
          {title}
        </h2>
      </div>
      <a className="home-v4-section-more" href={href}>
        Ver tudo <span aria-hidden="true">›</span>
      </a>
    </div>
  );
}

function EntityPoster({
  card,
  className,
  children,
}: {
  card: EntityCard;
  className: string;
  children?: ReactNode;
}) {
  return (
    <span className={className} data-vertical={card.kind}>
      {card.image !== null ? (
        <img
          src={card.image.src}
          alt={`Pôster de ${card.title}`}
          width={card.image.width}
          height={card.image.height}
          className="home-v4-poster__img"
          loading="lazy"
        />
      ) : null}
      {children}
    </span>
  );
}

function MovieCard({ card }: { card: EntityCard }) {
  return (
    <a href={card.href} className="home-v4-poster-card" data-entity-type="movie">
      <EntityPoster card={card} className="home-v4-media-poster">
        <span className="home-v4-media-badge home-v4-media-badge--movie">
          FILME
        </span>
      </EntityPoster>
      <h3 className="home-v4-poster-title">{card.title}</h3>
      <span className="home-v4-poster-meta-row">
        <span className="home-v4-poster-meta">{card.meta ?? "—"}</span>
        {card.screenScore !== null ? (
          <span
            className="home-v4-media-rating"
            aria-label={`Nota ${card.screenScore} de 5`}
          >
            <span className="home-v4-star" aria-hidden="true">
              ★
            </span>
            {card.screenScore}
          </span>
        ) : null}
      </span>
    </a>
  );
}

function SeriesCard({ card }: { card: EntityCard }) {
  return (
    <a href={card.href} className="home-v4-series-tile" data-entity-type="series">
      <span className="home-v4-series-tile__poster">
        {card.image !== null ? (
          <img
            src={card.image.src}
            alt={`Pôster de ${card.title}`}
            width={card.image.width}
            height={card.image.height}
            className="home-v4-series-tile__img"
            loading="lazy"
          />
        ) : null}
        <span className="home-v4-series-tile__scrim" aria-hidden="true" />
        <span className="home-v4-media-badge home-v4-media-badge--series">
          SÉRIE
        </span>
        <h3 className="home-v4-series-title">{card.title}</h3>
      </span>
    </a>
  );
}

function NewsFeature({ item }: { item: HomeNewsFeature }) {
  return (
    <a href={item.href} className="home-v4-news-feature">
      {item.image !== null ? (
        <img
          src={item.image.src}
          alt=""
          width={item.image.width}
          height={item.image.height}
          className="home-v4-news-img"
          loading="lazy"
        />
      ) : null}
      <span className="home-v4-news-scrim" aria-hidden="true" />
      <span className="home-v4-news-body">
        {item.badge !== null ? (
          <span className="home-v4-news-badge">{item.badge}</span>
        ) : null}
        <h3 className="home-v4-news-feature-title">{item.title}</h3>
        {item.sub !== null ? (
          <span className="home-v4-news-feature-sub">{item.sub}</span>
        ) : null}
      </span>
    </a>
  );
}

function NewsMiniCard({ item }: { item: HomeNewsMini }) {
  return (
    <a href={item.href} className="home-v4-news-mini">
      {item.image !== null ? (
        <img
          src={item.image.src}
          alt=""
          width={item.image.width}
          height={item.image.height}
          className="home-v4-news-img"
          loading="lazy"
        />
      ) : null}
      <span className="home-v4-news-scrim" aria-hidden="true" />
      <span className="home-v4-news-body">
        <h3 className="home-v4-news-mini-title">{item.title}</h3>
        {item.sub !== null ? (
          <span className="home-v4-news-mini-sub">{item.sub}</span>
        ) : null}
      </span>
    </a>
  );
}

function Leaderboard({ margin }: { margin: "56px 0 56px" | "56px 0 0" }) {
  return (
    <div className="home-v4-ad-shell">
      <AdSlot variant="leaderboard" margin={margin} />
    </div>
  );
}

export default async function HomePage() {
  const {
    heroSlides,
    movieCards,
    seriesWeekCards,
    upcomingMovies,
    newsCards,
  } = await getHomeData();

  const upcomingItems: ComingSoonItem[] = upcomingMovies.map((movie) => ({
    title: movie.title,
    date: movie.date,
    href: movie.href,
    imageUrl: movie.imageUrl,
  }));
  const firstNews = newsCards[0];
  const featuredNews: HomeNewsFeature | null =
    firstNews === undefined
      ? null
      : {
          badge: firstNews.category,
          title: firstNews.title,
          sub: firstNews.deck,
          href: firstNews.href,
          image: firstNews.image,
        };
  const gridNews: HomeNewsMini[] = newsCards.slice(1, 5).map((card) => ({
    title: card.title,
    sub: card.deck,
    href: card.href,
    image: card.image,
  }));

  return (
    <main className="portal-page" data-vertical="home">
      <h1 className="u-visually-hidden">{HOME_H1}</h1>

      {/* 1. Hero: nenhum fallback visual quando não há destaque real. */}
      {heroSlides.length > 0 ? (
        <HeroCarousel slides={heroSlides} />
      ) : null}

      {/* 2. Ticker: sem schedulePresenter.today real, fica ausente. */}
      {/* 3. Top 10: sem ranking semanal completo de dez itens, fica ausente. */}

      {/* 4. Primeiro leaderboard. */}
      <Leaderboard margin="56px 0 56px" />

      {/* 5. Filmes em alta: snapshot real de popularidade persistida. */}
      {movieCards.length > 0 ? (
        <section
          className="home-v4-band home-v4-band--warm"
          aria-labelledby="home-movies-title"
        >
          <div className="home-v4-section home-v4-section--band">
            <SectionHeader
              accent="red"
              title="Filmes em alta"
              titleId="home-movies-title"
              href={MOVIES_INDEX_PATH}
            />
            <div className="home-v4-media-grid">
              {movieCards.map((card) => (
                <MovieCard key={card.href} card={card} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* 6. Estatísticas mensais: ausentes para usuário anônimo. */}

      {/* 7. Segundo leaderboard. */}
      <Leaderboard margin="56px 0 0" />

      {/* 8. Séries da semana: sem janela semanal real, fica ausente. */}
      {seriesWeekCards.length > 0 ? (
        <section
          className="home-v4-section home-v4-section--series"
          aria-labelledby="home-series-title"
        >
          <SectionHeader
            accent="green"
            title="Séries da semana"
            titleId="home-series-title"
            href={SERIES_INDEX_PATH}
          />
          <div className="home-v4-media-grid">
            {seriesWeekCards.map((card) => (
              <SeriesCard key={card.href} card={card} />
            ))}
          </div>
        </section>
      ) : null}

      {/* 9. Continue assistindo: o canônico já não possui DOM nessa posição. */}

      {/* 10. Em breve: somente lançamentos futuros persistidos. */}
      {upcomingItems.length > 0 ? (
        <section className="home-v4-soon" aria-labelledby="home-soon-title">
          <ComingSoonRail
            items={upcomingItems}
            heading={
              <div>
                <div className="home-v4-section-title-wrap">
                  <span
                    className="home-v4-section-accent home-v4-section-accent--red"
                    aria-hidden="true"
                  />
                  <h2 id="home-soon-title" className="home-v4-section-title">
                    Em breve
                  </h2>
                  <span className="home-v4-title-chevron" aria-hidden="true">
                    ›
                  </span>
                </div>
                <p className="home-v4-soon-sub">Próximos lançamentos</p>
              </div>
            }
          />
        </section>
      ) : null}

      {/* 11. Terceiro leaderboard. */}
      <Leaderboard margin="56px 0 0" />

      {/* 12. Notícias: primeiro artigo em destaque + até quatro, sem repetição. */}
      {featuredNews !== null ? (
        <section className="home-v4-news" aria-labelledby="home-news-title">
          <SectionHeader
            accent="red"
            title="Notícias"
            titleId="home-news-title"
            href={NEWS_INDEX_PATH}
          />
          <div className="home-v4-news-grid">
            <NewsFeature item={featuredNews} />
            {gridNews.length > 0 ? (
              <div className="home-v4-news-mini-grid">
                {gridNews.map((item) => (
                  <NewsMiniCard key={item.href} item={item} />
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(HOME_ORGANIZATION_JSONLD),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(HOME_WEBSITE_JSONLD) }}
      />
    </main>
  );
}
