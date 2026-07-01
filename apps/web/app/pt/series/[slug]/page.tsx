import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getSeriesPageData } from "../../../../src/server/series-page";
import { SITE_URL } from "../../../../src/lib/site";

/**
 * Pagina publica de serie - /pt/series/[slug]/ (schema TVSeries, acento verde).
 *
 * Server component puro: le somente PostgreSQL via `getSeriesPageData`. Zero API
 * externa, zero Gemini e zero TMDB no render. A pagina omite secoes sem dados
 * reais e aplica `noindex` quando o gate anti-thin nao tem >= 2 blocos
 * editoriais publicaveis.
 */

export const revalidate = 3600;

const SERIES_INDEX_PATH = "/pt/series/";
const SUMMARY_BLOCK_TYPE = "summary_without_spoilers";

interface SeriesPageParams {
  slug: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<SeriesPageParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getSeriesPageData(slug);

  if (data === null) {
    return {
      title: "Serie nao encontrada",
      robots: { index: false, follow: false },
    };
  }

  const { view, indexability, canonicalUrl } = data;
  const shouldIndex = indexability.decision === "index";
  const title =
    view.metaTitle ??
    `${view.title}${view.periodLabel !== null ? ` (${view.periodLabel})` : ""} - Serie`;

  const metadata: Metadata = {
    title,
    robots: shouldIndex
      ? { index: true, follow: true }
      : { index: false, follow: false },
    alternates: { canonical: canonicalUrl },
  };
  if (view.metaDescription !== null) {
    metadata.description = view.metaDescription;
  }
  return metadata;
}

export default async function SeriesPage({
  params,
}: {
  params: Promise<SeriesPageParams>;
}) {
  const { slug } = await params;
  const data = await getSeriesPageData(slug);
  if (data === null) notFound();

  const { view, indexability, canonicalUrl } = data;
  const isUnderReview = indexability.decision !== "index";
  const metaItems = [view.seasonsCountLabel, view.episodesCountLabel].filter(
    (item): item is string => item !== null,
  );

  const summaryBlock =
    view.blocks.find((block) => block.blockType === SUMMARY_BLOCK_TYPE) ?? null;
  const mainBlocks = view.blocks.filter(
    (block) => block.blockType !== SUMMARY_BLOCK_TYPE,
  );
  const hasEditorial = mainBlocks.length > 0 || summaryBlock !== null;
  const hasSeasons = view.seasons.length > 0;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/pt/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Series",
        item: `${SITE_URL}${SERIES_INDEX_PATH}`,
      },
      { "@type": "ListItem", position: 3, name: view.title, item: canonicalUrl },
    ],
  };

  const seriesJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "TVSeries",
    name: view.title,
    url: canonicalUrl,
  };
  if (view.firstAirYear !== null) seriesJsonLd.startDate = String(view.firstAirYear);
  if (view.lastAirYear !== null) seriesJsonLd.endDate = String(view.lastAirYear);
  if (view.metaDescription !== null) {
    seriesJsonLd.description = view.metaDescription;
  }

  return (
    <main className="series-page" data-vertical="series">
      <div className="container">
        <nav className="breadcrumb" aria-label="Trilha de navegacao">
          <ol>
            <li>
              <a href="/pt/">Inicio</a>
            </li>
            <li>
              <a href={SERIES_INDEX_PATH}>Series</a>
            </li>
            <li aria-current="page">{view.title}</li>
          </ol>
        </nav>

        <section className="series-topbar" data-vertical="series">
          <div className="series-topbar__lead">
            <h1 className="series-topbar__title">
              {view.title}
              {view.periodLabel !== null ? (
                <span className="series-topbar__year"> ({view.periodLabel})</span>
              ) : null}
            </h1>
            <p className="series-topbar__badge">
              <span data-vertical="series" className="screena-badge screena-badge--series">
                Serie
              </span>
            </p>
            {metaItems.length > 0 ? (
              <p className="series-topbar__meta">{metaItems.join(" / ")}</p>
            ) : null}
            {view.metaDescription !== null ? (
              <p className="series-topbar__synopsis">{view.metaDescription}</p>
            ) : null}
          </div>
        </section>
      </div>

      <div className={`series-media${view.media.hasRealImage ? " series-media--real" : ""}`}>
        <div className="series-media__grid">
          <div className="series-media__poster">
            {view.media.poster !== null ? (
              <img
                src={view.media.poster.src}
                alt={`Poster de ${view.title}`}
                width={view.media.poster.width}
                height={view.media.poster.height}
                className="series-media__image"
              />
            ) : null}
          </div>
          <div className="series-media__stage">
            {view.media.backdrop !== null ? (
              <img
                src={view.media.backdrop.src}
                alt=""
                width={view.media.backdrop.width}
                height={view.media.backdrop.height}
                className="series-media__image"
              />
            ) : null}
            <span className="series-media__label" aria-hidden="true">
              Serie
            </span>
          </div>
          <div className="series-media__tiles">
            <span className="series-media__tile" />
            <span className="series-media__tile" />
            <span className="series-media__tile" />
          </div>
        </div>
      </div>

      {hasEditorial ? (
        <div className="container">
          <section className="series-synopsis">
            <h2 className="series-section-title">Sinopse</h2>
            <div className="series-synopsis__grid">
              <div className="series-synopsis__main">
                {mainBlocks.map((block) => (
                  <div
                    key={block.blockType}
                    className="series-block"
                    data-block-type={block.blockType}
                  >
                    <p className="series-block__body">{block.content}</p>
                  </div>
                ))}
              </div>

              {summaryBlock !== null ? (
                <aside className="series-aside">
                  <div className="series-spoiler-card" data-block-type={summaryBlock.blockType}>
                    <div className="series-spoiler-card__mark" aria-hidden="true" />
                    <div className="series-spoiler-card__text">
                      <p className="series-spoiler-card__label">Resumo sem spoilers</p>
                      <p className="series-spoiler-card__body">{summaryBlock.content}</p>
                    </div>
                  </div>
                </aside>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {hasSeasons ? (
        <div className="container">
          <section className="series-seasons" aria-labelledby="series-seasons-title">
            <h2 id="series-seasons-title" className="series-section-title">
              Temporadas
            </h2>
            <div className="series-seasons__list">
              {view.seasons.map((season) => {
                const seasonMeta = [
                  season.episodeCountLabel,
                  season.airYear !== null ? String(season.airYear) : null,
                ].filter((item): item is string => item !== null);
                return (
                  <article
                    key={season.seasonNumber}
                    className="series-season"
                    data-season-number={season.seasonNumber}
                  >
                    <div className="series-season__head">
                      <h3 className="series-season__title">{season.title}</h3>
                      {seasonMeta.length > 0 ? (
                        <p className="series-season__meta">{seasonMeta.join(" / ")}</p>
                      ) : null}
                    </div>
                    {season.overview !== null ? (
                      <p className="series-season__overview">{season.overview}</p>
                    ) : null}
                    {season.episodes.length > 0 ? (
                      <ol className="series-episode-list">
                        {season.episodes.map((episode) => {
                          const episodeMeta = [
                            episode.runtimeLabel,
                            episode.airYear !== null ? String(episode.airYear) : null,
                          ].filter((item): item is string => item !== null);
                          return (
                            <li
                              key={episode.episodeNumber}
                              className="series-episode-list__item"
                            >
                              <span className="series-episode-list__number">
                                E{episode.episodeNumber}
                              </span>
                              <span className="series-episode-list__content">
                                <span className="series-episode-list__title">
                                  {episode.title ?? `Episodio ${episode.episodeNumber}`}
                                </span>
                                {episodeMeta.length > 0 ? (
                                  <span className="series-episode-list__meta">
                                    {episodeMeta.join(" / ")}
                                  </span>
                                ) : null}
                                {episode.overview !== null ? (
                                  <span className="series-episode-list__overview">
                                    {episode.overview}
                                  </span>
                                ) : null}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}

      {isUnderReview ? (
        <div className="container">
          <p className="series-review-notice" data-editorial-state="in-review">
            Esta pagina ainda esta em revisao editorial.
          </p>
        </div>
      ) : null}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(seriesJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
    </main>
  );
}
