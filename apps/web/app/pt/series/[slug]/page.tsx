import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { buildSameAs } from "@screena/seo";

import { getSeriesPageData } from "../../../../src/server/series-page";
import { canonicalRedirectPath } from "../../../../src/lib/canonical-redirect";
import { SITE_URL } from "../../../../src/lib/site";
import { buildExternalLinks } from "../../../../src/lib/external-links";
import { RelatedNewsSection } from "../../../_components/related-news-section";
import { CastStrip } from "../../../_components/cast-strip";
import { WatchAvailabilityPanel } from "../../../_components/watch-availability-panel";
import { EntityDetailHero } from "../../../_components/entity-detail-hero";

/**
 * Pagina publica de serie - /pt/series/[slug]/ (schema TVSeries, acento verde).
 *
 * Server component puro: le somente PostgreSQL via `getSeriesPageData`. Zero API
 * externa, zero Gemini e zero TMDB no render. Sob indexacao total (invariante
 * 5), blocos editoriais enriquecem a pagina sem serem pre-requisito de index.
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
      title: "Série não encontrada",
      robots: { index: false, follow: false },
    };
  }

  const { view, indexability, canonicalUrl } = data;
  const shouldIndex = indexability.decision === "index";
  const title =
    view.metaTitle ??
    `${view.title}${view.periodLabel !== null ? ` (${view.periodLabel})` : ""} — Série`;

  const metadata: Metadata = {
    title,
    robots: shouldIndex ? { index: true, follow: true } : { index: false, follow: false },
    alternates: { canonical: canonicalUrl },
  };
  if (view.metaDescription !== null) {
    metadata.description = view.metaDescription;
  }
  return metadata;
}

export default async function SeriesPage({ params }: { params: Promise<SeriesPageParams> }) {
  const { slug } = await params;
  const data = await getSeriesPageData(slug);
  if (data === null) notFound();

  // Slug nao-canonico (alias antigo) nunca responde 200: 308 para o canonico.
  const redirectPath = canonicalRedirectPath(SERIES_INDEX_PATH, slug, data.canonicalSlug);
  if (redirectPath !== null) permanentRedirect(redirectPath);

  const { view, canonicalUrl, relatedNews, cast, watch, externalIds } = data;

  // Ficha tecnica factual: periodo fica no <h1>; a ficha complementa com
  // situacao (tv_shows.status), contagem real de temporadas/episodios e idioma
  // original — todos colunas reais, mapeadas em pt-BR. Ausente = omitido.
  const facts = [
    view.statusLabel !== null ? { label: "Situação", value: view.statusLabel } : null,
    view.seasonsCount !== null ? { label: "Temporadas", value: String(view.seasonsCount) } : null,
    view.episodesCount !== null ? { label: "Episódios", value: String(view.episodesCount) } : null,
    view.originalLanguageLabel !== null
      ? { label: "Idioma original", value: view.originalLanguageLabel }
      : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  // Links de identidade externa (mesmas fontes do `sameAs` do JSON-LD).
  const externalLinks = buildExternalLinks(externalIds, "tv");

  const summaryBlock = view.blocks.find((block) => block.blockType === SUMMARY_BLOCK_TYPE) ?? null;
  const mainBlocks = view.blocks.filter((block) => block.blockType !== SUMMARY_BLOCK_TYPE);
  const hasEditorial = mainBlocks.length > 0 || summaryBlock !== null;
  const hasSeasons = view.seasons.length > 0;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Início", item: `${SITE_URL}/pt/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Séries",
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
      <EntityDetailHero
        vertical="series"
        label="Série"
        title={view.title}
        periodLabel={view.periodLabel}
        synopsis={view.metaDescription}
        poster={view.media.poster}
        backdrop={view.media.backdrop}
        facts={facts}
        externalLinks={externalLinks}
        breadcrumbs={[
          { label: "Início", href: "/pt/" },
          { label: "Séries", href: SERIES_INDEX_PATH },
          { label: view.title },
        ]}
      />

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
                            <li key={episode.episodeNumber} className="series-episode-list__item">
                              <span className="series-episode-list__number">
                                E{episode.episodeNumber}
                              </span>
                              <span className="series-episode-list__content">
                                <span className="series-episode-list__title">
                                  {episode.title ?? `Episódio ${episode.episodeNumber}`}
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

      {/* Disponibilidade no Brasil (watch_availability licenciado). So aparece
          com oferta `display_allowed = true`; hoje a ingestao grava `false` por
          padrao, entao o painel fica omitido ate promocao humana explicita.
          Nunca exibe pirataria, nota nem plataforma inventada. */}
      {watch !== null ? (
        <div className="container">
          <WatchAvailabilityPanel view={watch} />
        </div>
      ) : null}

      <RelatedNewsSection cards={relatedNews} />

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
