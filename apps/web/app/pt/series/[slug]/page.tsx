import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { buildSameAs } from "@screena/seo";

import { getSeriesPageData } from "../../../../src/server/series-page";
import { canonicalRedirectPath } from "../../../../src/lib/canonical-redirect";
import { SITE_URL } from "../../../../src/lib/site";
import { buildExternalLinks } from "../../../../src/lib/external-links";
import { RelatedNewsSection } from "../../../_components/related-news-section";
import { CastStrip } from "../../../_components/cast-strip";
import { WatchProviders } from "../../../_components/watch-providers";
import { EntityExternalIds } from "../../../_components/entity-external-ids";
import { EntityFacts } from "../../../_components/entity-facts";

/**
 * Pagina publica de serie - /pt/series/[slug]/ (schema TVSeries, acento verde).
 *
 * Server component puro: le somente PostgreSQL via `getSeriesPageData`. Zero API
 * externa, zero Gemini e zero TMDB no render. A pagina omite secoes sem dados
 * reais e aplica `noindex` quando o gate anti-thin nao tem >= 2 blocos
 * editoriais publicaveis.
 *
 * URL canonica unica: slug antigo (alias despromovido em `slugs`) nao renderiza
 * 200 — redireciona permanentemente para o slug canonico.
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

  // Slug nao-canonico (alias antigo) nunca responde 200: 308 para o canonico.
  const redirectPath = canonicalRedirectPath(SERIES_INDEX_PATH, slug, data.canonicalSlug);
  if (redirectPath !== null) permanentRedirect(redirectPath);

  const { view, indexability, canonicalUrl, relatedNews, cast, watch, externalIds } = data;
  const isUnderReview = indexability.decision !== "index";

  // Ficha tecnica factual: periodo fica no <h1>; a ficha complementa com
  // situacao (tv_shows.status), contagem real de temporadas/episodios e idioma
  // original — todos colunas reais, mapeadas em pt-BR. Ausente = omitido.
  const facts = [
    view.statusLabel !== null ? { label: "Situação", value: view.statusLabel } : null,
    view.seasonsCount !== null
      ? { label: "Temporadas", value: String(view.seasonsCount) }
      : null,
    view.episodesCount !== null
      ? { label: "Episódios", value: String(view.episodesCount) }
      : null,
    view.originalLanguageLabel !== null
      ? { label: "Idioma original", value: view.originalLanguageLabel }
      : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  // Links de identidade externa (mesmas fontes do `sameAs` do JSON-LD).
  const externalLinks = buildExternalLinks(externalIds, "tv");

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

  // `@id`/`mainEntityOfPage` = URL canonica autorreferente e estavel da serie.
  // `sameAs` so com IDs externos REAIS (nunca inventa). SEM AggregateRating.
  const seriesJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "TVSeries",
    "@id": canonicalUrl,
    name: view.title,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
  };
  if (view.firstAirYear !== null) seriesJsonLd.startDate = String(view.firstAirYear);
  if (view.lastAirYear !== null) seriesJsonLd.endDate = String(view.lastAirYear);
  if (view.metaDescription !== null) {
    seriesJsonLd.description = view.metaDescription;
  }
  const sameAs = buildSameAs(externalIds, "tv");
  if (sameAs.length > 0) seriesJsonLd.sameAs = sameAs;

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

        <section
          className={`entity-topbar${view.media.poster !== null ? "" : " entity-topbar--solo"}`}
          data-vertical="series"
        >
          {view.media.poster !== null ? (
            <figure className="entity-topbar__poster">
              <img
                src={view.media.poster.src}
                alt={`Pôster de ${view.title}`}
                width={view.media.poster.width}
                height={view.media.poster.height}
                className="entity-topbar__poster-img"
              />
            </figure>
          ) : null}
          <div className="entity-topbar__lead">
            <p className="entity-topbar__badge">
              <span data-vertical="series" className="screena-badge screena-badge--series">
                Serie
              </span>
            </p>
            <h1 className="entity-topbar__title">
              {view.title}
              {view.periodLabel !== null ? (
                <span className="entity-topbar__year"> ({view.periodLabel})</span>
              ) : null}
            </h1>
            <EntityFacts facts={facts} />
            {view.metaDescription !== null ? (
              <p className="entity-topbar__synopsis">{view.metaDescription}</p>
            ) : null}
            <EntityExternalIds links={externalLinks} />
          </div>
        </section>
      </div>

      {/* Backdrop real (16:9) full-bleed — sem rotulo/tiles decorativos. */}
      {view.media.backdrop !== null ? (
        <div className="entity-backdrop" data-vertical="series">
          <img
            src={view.media.backdrop.src}
            alt=""
            width={view.media.backdrop.width}
            height={view.media.backdrop.height}
            className="entity-backdrop__img"
          />
        </div>
      ) : null}

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

      {/* Elenco principal (cast_members/people) — dado factual de catalogo. So
          aparece quando ha elenco real; nunca inventa nomes nem personagens. */}
      {cast.length > 0 ? (
        <div className="container">
          <CastStrip heading="Elenco principal" members={cast} />
        </div>
      ) : null}

      {/* Onde assistir (watch_availability licenciado no BR). So aparece com
          oferta `display_allowed` legal; nunca exibe pirataria nem nota. */}
      {watch.providers.length > 0 ? (
        <div className="container">
          <WatchProviders heading="Onde assistir" view={watch} />
        </div>
      ) : null}

      <RelatedNewsSection cards={relatedNews} />

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
