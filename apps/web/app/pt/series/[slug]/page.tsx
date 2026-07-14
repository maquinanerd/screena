import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import type { ReactNode } from "react";

import { buildSameAs } from "@screena/seo";

import { WatchAvailabilityPanel } from "../../../_components/watch-availability-panel";
import { EntityExternalIds } from "../../../_components/entity-external-ids";
import { canonicalRedirectPath } from "../../../../src/lib/canonical-redirect";
import type { CastMemberView } from "../../../../src/lib/cast-presenter";
import { buildExternalLinks } from "../../../../src/lib/external-links";
import type { NewsCardView } from "../../../../src/lib/news-presenter";
import type { SeriesEpisodeView, SeriesSeasonView } from "../../../../src/lib/series-presenter";
import { SITE_URL } from "../../../../src/lib/site";
import { getSeriesPageData } from "../../../../src/server/series-page";
import styles from "./series-canonical.module.css";

/**
 * Detalhe público de série — porte da tela canônica 07, com a linguagem
 * responsiva da tela 08. O componente continua server-only: o único dado
 * exibido vem do snapshot PostgreSQL montado por `getSeriesPageData`.
 *
 * Partes do protótipo sem presenter real (nota, trailer, prêmios, gênero,
 * classificação e recomendações) não entram no DOM. Isso preserva o contrato
 * anti-mock sem converter um backdrop em trailer ou uma identidade externa em
 * rating. Temporadas, episódios, elenco, editorial, notícias e disponibilidade
 * legal também somem integralmente quando seus respectivos arrays/views estão
 * vazios.
 */

export const revalidate = 3600;

const SERIES_INDEX_PATH = "/pt/series/";
const REVIEW_BLOCK_TYPE = "review_summary";
const WORK_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "editorial_intro",
  "summary_without_spoilers",
  "franchise_context",
]);
const EPISODE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "season_guide",
  "episode_context",
]);

interface SeriesPageParams {
  slug: string;
}

interface SeriesPageSearchParams {
  temporada?: string | string[];
}

interface SeriesFact {
  label: string;
  value: string;
}

function seasonNumberFromQuery(value: string | string[] | undefined): number | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === undefined || !/^\d+$/.test(candidate)) return null;
  const seasonNumber = Number(candidate);
  return Number.isSafeInteger(seasonNumber) ? seasonNumber : null;
}

function ArrowIcon(): ReactNode {
  const icon = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
  return icon;
}

function initialsFor(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toLocaleUpperCase("pt-BR");
}

function CastCard({ member }: { member: CastMemberView }): ReactNode {
  const content = (
    <>
      <span className={styles.castMedia}>
        {member.profile !== null ? (
          <img
            src={member.profile.src}
            alt={`Retrato de ${member.name}`}
            width={member.profile.width}
            height={member.profile.height}
            className={styles.castImage}
            loading="lazy"
          />
        ) : (
          <span className={styles.castFallback} aria-hidden="true">
            {initialsFor(member.name)}
          </span>
        )}
      </span>
      <span className={styles.castBody}>
        <h3 className={styles.castName}>{member.name}</h3>
        {member.character !== null ? (
          <span className={styles.castRole}>{member.character}</span>
        ) : null}
      </span>
    </>
  );

  return member.href !== null ? (
    <a className={styles.castCard} href={member.href}>
      {content}
    </a>
  ) : (
    <div className={styles.castCard}>{content}</div>
  );
}

function EpisodeRow({
  episode,
  seasonNumber,
}: {
  episode: SeriesEpisodeView;
  seasonNumber: number;
}): ReactNode {
  const episodeMeta = [
    episode.airYear !== null ? String(episode.airYear) : null,
    episode.runtimeLabel,
  ].filter((item): item is string => item !== null);

  const row = (
    <li className={styles.episodeItem}>
      <article className={styles.episode}>
        <div className={styles.episodeMedia}>
          {episode.still !== null ? (
            <img
              src={episode.still.src}
              alt={`Cena do episódio ${episode.episodeNumber}`}
              width={episode.still.width}
              height={episode.still.height}
              className={styles.episodeImage}
              loading="lazy"
            />
          ) : (
            <span className={styles.episodeFallback} aria-hidden="true" />
          )}
          <span className={styles.episodeNumber}>
            T{seasonNumber} · E{episode.episodeNumber}
          </span>
        </div>
        <div className={styles.episodeBody}>
          <h4 className={styles.episodeTitle}>
            <span className={styles.episodeMobileNumber}>
              T{seasonNumber} · E{episode.episodeNumber}
            </span>
            {episode.title ?? `Episódio ${episode.episodeNumber}`}
          </h4>
          {episode.overview !== null ? (
            <p className={styles.episodeOverview}>{episode.overview}</p>
          ) : null}
          {episodeMeta.length > 0 ? (
            <p className={styles.episodeMeta}>{episodeMeta.join(" · ")}</p>
          ) : null}
        </div>
      </article>
    </li>
  );
  return row;
}

function SeasonGroup({ season }: { season: SeriesSeasonView }): ReactNode {
  const seasonMeta = [
    season.episodeCountLabel,
    season.airYear !== null ? String(season.airYear) : null,
  ].filter((item): item is string => item !== null);

  const group = (
    <section
      className={styles.seasonGroup}
      id={`temporada-${season.seasonNumber}`}
      aria-labelledby={`temporada-${season.seasonNumber}-titulo`}
    >
      <div className={styles.seasonSummary}>
        <h3 id={`temporada-${season.seasonNumber}-titulo`} className={styles.seasonTitle}>
          {season.title}
        </h3>
        {seasonMeta.length > 0 ? (
          <p className={styles.seasonMeta}>{seasonMeta.join(" · ")}</p>
        ) : null}
      </div>
      {season.overview !== null ? <p className={styles.seasonOverview}>{season.overview}</p> : null}
      {season.episodes.length > 0 ? (
        <ol className={styles.episodeList}>
          {season.episodes.map((episode) => (
            <EpisodeRow
              key={episode.episodeNumber}
              episode={episode}
              seasonNumber={season.seasonNumber}
            />
          ))}
        </ol>
      ) : null}
    </section>
  );
  return group;
}

function RelatedNewsCard({ card }: { card: NewsCardView }): ReactNode {
  const meta = [card.author, card.readTimeLabel].filter((item): item is string => item !== null);

  const article = (
    <article className={styles.newsCard}>
      <a className={styles.newsLink} href={card.href}>
        <span className={styles.newsMedia}>
          {card.image !== null ? (
            <img
              src={card.image.src}
              alt=""
              width={card.image.width}
              height={card.image.height}
              className={styles.newsImage}
              loading="lazy"
            />
          ) : (
            <span className={styles.newsFallback} aria-hidden="true" />
          )}
        </span>
        {card.category !== null ? (
          <span className={styles.newsCategory}>{card.category}</span>
        ) : null}
        <h3 className={styles.newsTitle}>{card.title}</h3>
        {meta.length > 0 ? <span className={styles.newsMeta}>{meta.join(" · ")}</span> : null}
      </a>
    </article>
  );
  return article;
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
  if (view.metaDescription !== null) metadata.description = view.metaDescription;
  return metadata;
}

export default async function SeriesPage({
  params,
  searchParams,
}: {
  params: Promise<SeriesPageParams>;
  searchParams: Promise<SeriesPageSearchParams>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const data = await getSeriesPageData(slug);
  if (data === null) notFound();

  const redirectPath = canonicalRedirectPath(SERIES_INDEX_PATH, slug, data.canonicalSlug);
  if (redirectPath !== null) permanentRedirect(redirectPath);

  const { view, indexability, canonicalUrl, relatedNews, cast, watch, externalIds } = data;
  const isUnderReview = indexability.decision !== "index";

  const heroMeta = [view.periodLabel, view.seasonsCountLabel, view.episodesCountLabel].filter(
    (item): item is string => item !== null,
  );
  const facts: SeriesFact[] = [
    { label: "Período", value: view.periodLabel ?? "—" },
    { label: "Situação", value: view.statusLabel ?? "—" },
    { label: "Temporadas", value: view.seasonsCountLabel ?? "—" },
    { label: "Episódios", value: view.episodesCountLabel ?? "—" },
    { label: "Idioma original", value: view.originalLanguageLabel ?? "—" },
  ];
  const externalLinks = buildExternalLinks(externalIds, "tv");
  const critiqueBlock =
    view.blocks.find((block) => block.blockType === REVIEW_BLOCK_TYPE) ?? null;
  const editorialBlocks = view.blocks.filter((block) =>
    WORK_BLOCK_TYPES.has(block.blockType),
  );
  const episodeContextBlocks = view.blocks.filter((block) =>
    EPISODE_BLOCK_TYPES.has(block.blockType),
  );
  const watchContext =
    view.blocks.find((block) => block.blockType === "where_to_watch_text") ?? null;
  const castContext =
    view.blocks.find((block) => block.blockType === "cast_intro") ?? null;
  const newsContext =
    view.blocks.find((block) => block.blockType === "news_context") ?? null;
  const hasEditorial = editorialBlocks.length > 0;
  const hasSeasons = view.seasons.length > 0;
  const requestedSeasonNumber = seasonNumberFromQuery(query.temporada);
  const selectedSeason =
    view.seasons.find(
      (season) => season.seasonNumber === requestedSeasonNumber,
    ) ??
    view.seasons[0] ??
    null;
  const visibleCast = cast.slice(0, 6);
  const visibleNews = relatedNews.slice(0, 3);
  const mediaNews = visibleNews[0] ?? null;

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
  if (view.metaDescription !== null) seriesJsonLd.description = view.metaDescription;
  const sameAs = buildSameAs(externalIds, "tv");
  if (sameAs.length > 0) seriesJsonLd.sameAs = sameAs;

  return (
    <main className={styles.page} data-vertical="series" data-screen="series-detail">
      <section className={styles.hero} aria-labelledby="series-title">
        <div className={styles.breadcrumbRow}>
          <nav className={styles.breadcrumb} aria-label="Trilha de navegação">
            <ol>
              <li>
                <a href={SERIES_INDEX_PATH}>Séries</a>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page">{view.title}</li>
            </ol>
          </nav>
        </div>

        <div className={`${styles.heroInner}${watch === null ? ` ${styles.heroInnerSolo}` : ""}`}>
          <div className={styles.heroLead}>
            <div className={styles.identityRow}>
              <span className={styles.seriesBadge}>Série</span>
            </div>
            <h1 id="series-title" className={styles.title}>
              {view.title}
            </h1>
            {heroMeta.length > 0 ? <p className={styles.heroMeta}>{heroMeta.join(" · ")}</p> : null}
            {view.metaDescription !== null ? (
              <p className={styles.heroSynopsis}>{view.metaDescription}</p>
            ) : null}
          </div>

          {watch !== null ? (
            <aside className={styles.watchPanel} aria-label="Disponibilidade legal">
              <WatchAvailabilityPanel view={watch} />
              {watchContext !== null ? (
                <p
                  className={styles.watchContext}
                  data-block-type={watchContext.blockType}
                >
                  {watchContext.content}
                </p>
              ) : null}
            </aside>
          ) : null}
        </div>
      </section>

      <section
        className={`${styles.media}${
          view.media.backdrop !== null
            ? ` ${styles.mediaWithBackdrop}`
            : ` ${styles.mediaPosterOnly}`
        }`}
        aria-labelledby="series-media-title"
      >
        <h2 id="series-media-title" className={styles.visuallyHidden}>
          Mídia de {view.title}
        </h2>
        <div className={styles.mediaGrid}>
          <figure className={styles.posterFrame}>
            {view.media.poster !== null ? (
              <img
                src={view.media.poster.src}
                alt={`Pôster de ${view.title}`}
                width={view.media.poster.width}
                height={view.media.poster.height}
                className={styles.mediaImage}
              />
            ) : (
              <span className={styles.posterFallback} aria-hidden="true" />
            )}
          </figure>
          {view.media.backdrop !== null ? (
            <figure className={styles.backdropFrame}>
              <img
                src={view.media.backdrop.src}
                alt=""
                width={view.media.backdrop.width}
                height={view.media.backdrop.height}
                className={styles.mediaImage}
              />
            </figure>
          ) : null}
          {view.media.backdrop !== null ? (
            <div className={styles.mediaTiles}>
              <span className={styles.mediaTile} aria-hidden="true" />
              {mediaNews !== null ? (
                <a
                  className={styles.mediaNewsLink}
                  href={mediaNews.href}
                  aria-label={`Abrir notícia: ${mediaNews.title}`}
                >
                  {mediaNews.image !== null ? (
                    <img
                      src={mediaNews.image.src}
                      alt=""
                      width={mediaNews.image.width}
                      height={mediaNews.image.height}
                      className={styles.mediaImage}
                      loading="lazy"
                    />
                  ) : null}
                  <span className={styles.mediaTileLabel}>
                    Notícias e eventos
                  </span>
                </a>
              ) : (
                <span className={styles.mediaTile} aria-hidden="true" />
              )}
              <span className={styles.mediaTile} aria-hidden="true" />
            </div>
          ) : null}
        </div>
      </section>

      {hasEditorial ? (
        <section className={styles.work} aria-labelledby="series-work-title">
          <div className={styles.sectionKicker}>
            <span aria-hidden="true" />
            <h2 id="series-work-title">A obra</h2>
          </div>
          <div className={styles.editorialBody}>
            {editorialBlocks.map((block, index) => (
              <p
                key={block.blockType}
                className={index === 0 ? styles.editorialLead : styles.editorialParagraph}
                data-block-type={block.blockType}
              >
                {block.content}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      {critiqueBlock !== null ? (
        <section className={styles.critique} aria-labelledby="series-review-title">
          {view.media.backdrop !== null ? (
            <img
              src={view.media.backdrop.src}
              alt=""
              width={view.media.backdrop.width}
              height={view.media.backdrop.height}
              className={styles.critiqueImage}
              loading="lazy"
            />
          ) : null}
          <span className={styles.critiqueSideScrim} aria-hidden="true" />
          <span className={styles.critiqueBottomScrim} aria-hidden="true" />
          <div className={styles.critiqueFrame}>
            <div className={styles.critiqueContent}>
              <h2 id="series-review-title" className={styles.critiqueLabel}>
                Guia Screen · Crítica da redação
              </h2>
              <p
                className={styles.critiqueText}
                data-block-type={critiqueBlock.blockType}
              >
                {critiqueBlock.content}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {hasSeasons ? (
        <section
          className={styles.episodes}
          id="episodios"
          aria-labelledby="series-episodes-title"
        >
          <div className={styles.episodesHeading}>
            <div>
              <div className={styles.sectionKicker}>
                <span aria-hidden="true" />
                <p>Catálogo</p>
              </div>
              <h2 id="series-episodes-title" className={styles.sectionTitle}>
                Episódios
              </h2>
            </div>
            <nav className={styles.seasonNav} aria-label="Temporadas">
              {view.seasons.map((season) => (
                <a
                  key={season.seasonNumber}
                  className={
                    season.seasonNumber === selectedSeason?.seasonNumber
                      ? styles.seasonNavActive
                      : styles.seasonNavLink
                  }
                  href={`?temporada=${season.seasonNumber}#episodios`}
                  aria-current={
                    season.seasonNumber === selectedSeason?.seasonNumber
                      ? "page"
                      : undefined
                  }
                >
                  T{season.seasonNumber}
                </a>
              ))}
            </nav>
          </div>
          {episodeContextBlocks.length > 0 ? (
            <div className={styles.episodeContext}>
              {episodeContextBlocks.map((block) => (
                <p key={block.blockType} data-block-type={block.blockType}>
                  {block.content}
                </p>
              ))}
            </div>
          ) : null}
          <div className={styles.seasonsList}>
            {selectedSeason !== null ? (
              <SeasonGroup
                key={selectedSeason.seasonNumber}
                season={selectedSeason}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {visibleCast.length > 0 ? (
        <section className={styles.cast} aria-labelledby="series-cast-title">
          <div className={styles.castHeading}>
            <div>
              <div className={styles.sectionKicker}>
                <span aria-hidden="true" />
                <p>Elenco</p>
              </div>
              <h2 id="series-cast-title" className={styles.sectionTitle}>
                Elenco principal
              </h2>
            </div>
          </div>
          {castContext !== null ? (
            <p
              className={styles.sectionContext}
              data-block-type={castContext.blockType}
            >
              {castContext.content}
            </p>
          ) : null}
          <ul
            className={styles.castGrid}
            aria-label="Elenco principal; use as setas para percorrer"
            tabIndex={0}
          >
            {visibleCast.map((member, index) => (
              <li key={`${member.name}-${index}`}>
                <CastCard member={member} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {visibleNews.length > 0 ? (
        <section className={styles.news} aria-labelledby="series-news-title">
          <div className={styles.newsHeading}>
            <div>
              <div className={styles.sectionKicker}>
                <span aria-hidden="true" />
                <p>Editorial</p>
              </div>
              <h2 id="series-news-title" className={styles.sectionTitle}>
                Notícias e bastidores
              </h2>
              <p className={styles.newsDeck} data-block-type={newsContext?.blockType}>
                {newsContext?.content ??
                  "Contexto, entrevistas e cobertura da série."}
              </p>
            </div>
            <a className={styles.allNewsLink} href="/pt/noticias/">
              Ver tudo <ArrowIcon />
            </a>
          </div>
          <div className={styles.newsGrid}>
            {visibleNews.map((card) => (
              <RelatedNewsCard key={card.href} card={card} />
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.details} aria-labelledby="series-details-title">
        <div className={styles.detailsColumn}>
          <div className={styles.sectionKicker}>
            <span aria-hidden="true" />
            <h2 id="series-details-title">Ficha técnica</h2>
          </div>
          <dl className={styles.facts}>
            {facts.map((fact) => (
              <div key={fact.label} className={styles.factRow}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
          {externalLinks.length > 0 ? (
            <div className={styles.externalLinks}>
              <EntityExternalIds links={externalLinks} />
            </div>
          ) : null}
        </div>
      </section>

      {isUnderReview ? (
        <div className={styles.reviewWrap}>
          <p className={styles.reviewNotice} data-editorial-state="in-review">
            Esta página ainda está em revisão editorial.
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
