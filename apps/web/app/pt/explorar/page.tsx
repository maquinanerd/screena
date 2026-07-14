import type { Metadata } from "next";

import { AdSlot } from "../../_components/ad-slot";
import { takeUpcomingWeek } from "../../../src/lib/home-upcoming-presenter";
import {
  countPopulatedSections,
  evaluatePortalIndexability,
} from "../../../src/lib/portal-presenter";
import {
  canonicalPublicUrl,
  EXPLORE_PATH,
  HOME_PATH,
  SITE_URL,
} from "../../../src/lib/site";
import { getHomeUpcomingMovies } from "../../../src/server/home-upcoming";

import styles from "./explore-canonical.module.css";

/**
 * Tela canônica 11 · Discover / Explorar.
 *
 * A geometria vem de `paginas/11-discover.html`. Blocos cujo contrato ainda
 * não existe no produto (busca, tendência de 24 h, continuar assistindo,
 * watchlist, ranking social e filtros) não são simulados. A agenda usa somente
 * entidades e datas persistidas no PostgreSQL.
 */

export const dynamic = "force-dynamic";

const TITLE = "Explorar";
const DESCRIPTION =
  "Consulte a agenda semanal de próximos lançamentos já publicados na Screen.";
const UPCOMING_LIMIT = 5;
const UPCOMING_SOURCE_LIMIT = 30;

async function getExploreData() {
  const upcomingMovies = takeUpcomingWeek(
    await getHomeUpcomingMovies({ limit: UPCOMING_SOURCE_LIMIT }),
    new Date(),
    UPCOMING_LIMIT,
  );
  const indexability = evaluatePortalIndexability({
    populatedSectionCount: countPopulatedSections([upcomingMovies.length]),
  });

  return { upcomingMovies, indexability };
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
  const { upcomingMovies } = await getExploreData();
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
        </header>

        {upcomingMovies.length > 0 ? (
          <section className={styles.section} aria-labelledby="discover-releases-title">
            <div className={styles.sectionHead}>
              <div className={styles.sectionHeading}>
                <span className={styles.sectionAccent} data-kind="movie" />
                <h2 id="discover-releases-title">Lançamentos</h2>
              </div>
              <p>Agenda da semana</p>
            </div>

            <ul className={styles.releaseList}>
              {upcomingMovies.map((movie) => {
                return (
                  <li key={movie.href} className={styles.releaseItem}>
                    <a href={movie.href}>
                      <span className={styles.releaseDate}>
                        <span>{movie.weekday}</span>
                        <strong>{movie.dateIso.slice(8, 10)}</strong>
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
                        <h3>{movie.title}</h3>
                        <span>Estreia em {movie.date}</span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <p className={styles.emptyState}>
            Nenhum lançamento publicado para explorar no momento.
          </p>
        )}
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
