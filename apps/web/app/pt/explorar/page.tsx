import type { Metadata } from "next";

import { AdSlot } from "../../_components/ad-slot";
import type { EntityCard } from "../../../src/lib/entity-index-presenter";
import {
  countPopulatedSections,
  evaluatePortalIndexability,
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
import { getMovieIndexData, getSeriesIndexData } from "../../../src/server/entity-indexes";
import { getHomeUpcomingMovies } from "../../../src/server/home-upcoming";

import styles from "./explore-canonical.module.css";

/**
 * Tela canônica 11 · Discover / Explorar.
 *
 * A geometria vem de `paginas/11-discover.html`. Blocos cujo contrato ainda
 * não existe no produto (busca, tendência de 24 h, continuar assistindo,
 * watchlist, ranking social e filtros) não são simulados. O catálogo e a
 * agenda usam somente entidades e datas persistidas no PostgreSQL.
 */

export const dynamic = "force-dynamic";

const TITLE = "Explorar";
const DESCRIPTION =
  "Navegue pelo catálogo de filmes e séries do Screen e consulte os próximos lançamentos já publicados.";
const DISCOVER_CARD_LIMIT = 8;
const UPCOMING_LIMIT = 5;

const FILTER_LINKS = [
  { label: "Tudo", href: EXPLORE_PATH, current: true },
  { label: "Filmes", href: MOVIES_INDEX_PATH, current: false },
  { label: "Séries", href: SERIES_INDEX_PATH, current: false },
  { label: "Pessoas", href: PEOPLE_INDEX_PATH, current: false },
  { label: "Notícias", href: NEWS_INDEX_PATH, current: false },
] as const;

function cardKindLabel(kind: EntityCard["kind"]): string {
  if (kind === "movie") return "Filme";
  if (kind === "series") return "Série";
  return "Pessoa";
}

function splitUpcomingDate(date: string): { day: string; month: string } {
  const [day = date, , month = ""] = date.split(" ");
  return { day, month };
}

async function getExploreData() {
  const [movies, series, upcomingMovies] = await Promise.all([
    getMovieIndexData(),
    getSeriesIndexData(),
    getHomeUpcomingMovies({ limit: UPCOMING_LIMIT }),
  ]);

  const mixedCatalog = takeSectionCards(
    [...movies.view.cards, ...series.view.cards],
    DISCOVER_CARD_LIMIT,
  );
  const featured = mixedCatalog[0] ?? null;
  const catalogCards = featured === null ? [] : mixedCatalog.slice(1);
  const indexability = evaluatePortalIndexability({
    populatedSectionCount: countPopulatedSections([
      featured === null ? 0 : 1,
      catalogCards.length,
      upcomingMovies.length,
    ]),
  });

  return { featured, catalogCards, upcomingMovies, indexability };
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
  const { featured, catalogCards, upcomingMovies } = await getExploreData();
  const canonicalUrl = canonicalPublicUrl(EXPLORE_PATH);

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Início",
        item: `${SITE_URL}${HOME_PATH}`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: TITLE,
        item: canonicalUrl,
      },
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
    <main className={styles.page} data-vertical="explore">
      <div className={styles.shell}>
        <AdSlot variant="leaderboard" margin="0 0 36px" />

        <header className={styles.pageHead}>
          <div>
            <h1 className={styles.pageTitle}>{TITLE}</h1>
            <p className={styles.pageDescription}>{DESCRIPTION}</p>
          </div>

          <nav className={styles.filters} aria-label="Seções para explorar">
            {FILTER_LINKS.map((link) => (
              <a
                key={link.href}
                className={link.current ? styles.filterActive : styles.filter}
                href={link.href}
                aria-current={link.current ? "page" : undefined}
              >
                {link.label}
              </a>
            ))}
          </nav>
        </header>

        {featured !== null ? (
          <section className={styles.feature} aria-labelledby="discover-feature-title">
            <div className={styles.featureScrim} aria-hidden="true" />
            <div className={styles.featureInner}>
              <div className={styles.featureCopy}>
                <span className={styles.typeBadge} data-kind={featured.kind}>
                  {cardKindLabel(featured.kind)}
                </span>
                <h2 id="discover-feature-title" className={styles.featureTitle}>
                  {featured.title}
                </h2>
                {featured.meta !== null ? (
                  <p className={styles.featureMeta}>{featured.meta}</p>
                ) : null}
                <a className={styles.featureLink} href={featured.href}>
                  Ver detalhes
                </a>
              </div>

              <a
                className={styles.featurePoster}
                href={featured.href}
                aria-label={`Ver detalhes de ${featured.title}`}
              >
                {featured.image === null ? (
                  <span className={styles.posterFallback} aria-hidden="true" />
                ) : (
                  <img
                    className={styles.posterImage}
                    src={featured.image.src}
                    alt={`Pôster de ${featured.title}`}
                    width={featured.image.width}
                    height={featured.image.height}
                    fetchPriority="high"
                  />
                )}
              </a>
            </div>
          </section>
        ) : null}

        {catalogCards.length > 0 ? (
          <section className={styles.section} aria-labelledby="discover-catalog-title">
            <div className={styles.sectionHead}>
              <div className={styles.sectionHeading}>
                <span className={styles.sectionAccent} data-kind="mixed" />
                <h2 id="discover-catalog-title">Catálogo</h2>
              </div>
              <p>Filmes e séries publicados</p>
            </div>

            <ul className={styles.posterRail}>
              {catalogCards.map((card) => (
                <li key={card.href} className={styles.posterCard}>
                  <a href={card.href}>
                    <span className={styles.posterMedia}>
                      {card.image === null ? (
                        <span className={styles.posterFallback} aria-hidden="true" />
                      ) : (
                        <img
                          className={styles.posterImage}
                          src={card.image.src}
                          alt={`Pôster de ${card.title}`}
                          width={card.image.width}
                          height={card.image.height}
                          loading="lazy"
                        />
                      )}
                      <span className={styles.posterType} data-kind={card.kind}>
                        {cardKindLabel(card.kind)}
                      </span>
                    </span>
                    <span className={styles.posterTitle}>{card.title}</span>
                    {card.meta !== null || card.screenScore !== null ? (
                      <span className={styles.posterMeta}>
                        {[card.meta, card.screenScore === null ? null : `Screen ${card.screenScore}`]
                          .filter((item): item is string => item !== null)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {upcomingMovies.length > 0 ? (
          <section className={styles.section} aria-labelledby="discover-releases-title">
            <div className={styles.sectionHead}>
              <div className={styles.sectionHeading}>
                <span className={styles.sectionAccent} data-kind="movie" />
                <h2 id="discover-releases-title">Lançamentos</h2>
              </div>
              <p>Próximas estreias com data publicada</p>
            </div>

            <ul className={styles.releaseList}>
              {upcomingMovies.map((movie) => {
                const date = splitUpcomingDate(movie.date);
                return (
                  <li key={movie.href} className={styles.releaseItem}>
                    <a href={movie.href}>
                      <span className={styles.releaseDate}>
                        <span>{date.month}</span>
                        <strong>{date.day}</strong>
                      </span>
                      <span className={styles.releaseMedia}>
                        {movie.imageUrl === null ? (
                          <span className={styles.releaseFallback} aria-hidden="true" />
                        ) : (
                          <img
                            src={movie.imageUrl}
                            alt={`Imagem de ${movie.title}`}
                            width={780}
                            height={439}
                            loading="lazy"
                          />
                        )}
                      </span>
                      <span className={styles.releaseCopy}>
                        <span className={styles.releaseKind}>Filme</span>
                        <strong>{movie.title}</strong>
                        <span>Estreia em {movie.date}</span>
                      </span>
                    </a>
                  </li>
                );
              })}
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
