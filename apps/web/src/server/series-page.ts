/**
 * series-page.ts - Camada de dados SERVER-ONLY da pagina publica de serie.
 *
 * Invariantes 3 e 4:
 *  - Le somente PostgreSQL local via @screena/db (Prisma).
 *  - Nao chama TMDB, Gemini, ratings, streaming ou qualquer API externa.
 *  - Nao escreve no banco; apenas monta snapshot para render.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import { SITE_URL } from "../lib/site";
import {
  buildSeriesPageView,
  evaluateSeriesIndexability,
  SERIES_RENDERABLE_REVIEW_STATUSES,
  type SeriesContentBlockInput,
  type SeriesPageView,
  type SeriesSeasonInput,
} from "../lib/series-presenter";
import { resolveEntityPageSeo } from "./seo/indexability-decision";
import { getRelatedNewsForEntity } from "./related-news";
import { getCastForEntity } from "./entity-cast";
import { getWatchAvailabilityForEntity } from "./entity-watch";
import type { NewsCardView } from "../lib/news-presenter";
import type { CastMemberView } from "../lib/cast-presenter";
import type { WatchAvailabilityView } from "../lib/watch-availability-presenter";
import type { IndexabilityResult, PageSeoResolution } from "@screena/seo";

const LANGUAGE_CODE = "pt-BR";
const ENTITY_TYPE = "tv";
const SERIES_INDEX_PATH = "/pt/series/";

export interface SeriesPageData {
  view: SeriesPageView;
  indexability: IndexabilityResult;
  /** Resolucao FINAL de SEO (Fase 3): fatos vivos + decisao vigente persistida. */
  seo: PageSeoResolution;
  canonicalSlug: string;
  canonicalUrl: string;
  /** Noticias relacionadas publicaveis (EntityNewsLink); [] quando nao houver. */
  relatedNews: NewsCardView[];
  /** Elenco principal (cast_members/people); [] quando nao houver. */
  cast: CastMemberView[];
  /** Disponibilidade no Brasil (watch_availability licenciado); `null` omite o painel. */
  watch: WatchAvailabilityView | null;
  /** IDs externos reais (imdb/tmdb/...) para montar `sameAs` no JSON-LD. */
  externalIds: { source: string; externalId: string }[];
}

function seriesCanonicalUrl(slug: string): string {
  return `${SITE_URL}${SERIES_INDEX_PATH}${slug}/`;
}

function yearFromDate(date: Date | null): number | null {
  return date === null ? null : date.getUTCFullYear();
}

export const getSeriesPageData = cache(
  async (slug: string): Promise<SeriesPageData | null> => {
    const prisma = getPrismaClient();

    const slugRow = await prisma.slug.findFirst({
      where: { entityType: ENTITY_TYPE, languageCode: LANGUAGE_CODE, slug },
      select: { entityId: true },
    });
    if (slugRow === null) return null;

    const entityId = slugRow.entityId;

    const [series, canonicalSlugRow, translation, contentBlocks, seasons, relatedNews, cast, watch, externalIds] =
      await Promise.all([
        prisma.tvShow.findUnique({
          where: { id: entityId },
          select: {
            nameOriginal: true,
            firstAirDate: true,
            lastAirDate: true,
            numberOfSeasons: true,
            numberOfEpisodes: true,
            posterPath: true,
            backdropPath: true,
            status: true,
            originalLanguage: true,
          },
        }),
        prisma.slug.findFirst({
          where: {
            entityType: ENTITY_TYPE,
            entityId,
            languageCode: LANGUAGE_CODE,
            isCanonical: true,
          },
          select: { slug: true },
        }),
        prisma.entityTranslation.findFirst({
          where: {
            entityType: ENTITY_TYPE,
            entityId,
            languageCode: LANGUAGE_CODE,
          },
          select: {
            title: true,
            metaTitle: true,
            metaDescription: true,
            summary: true,
          },
        }),
        prisma.contentBlock.findMany({
          where: {
            entityType: ENTITY_TYPE,
            entityId,
            languageCode: LANGUAGE_CODE,
            reviewStatus: { in: [...SERIES_RENDERABLE_REVIEW_STATUSES] },
          },
          select: { blockType: true, content: true, reviewStatus: true },
        }),
        prisma.season.findMany({
          where: { tvShowId: entityId },
          orderBy: { seasonNumber: "asc" },
          select: {
            seasonNumber: true,
            name: true,
            overview: true,
            airDate: true,
            episodeCount: true,
            posterPath: true,
            episodes: {
              orderBy: { episodeNumber: "asc" },
              select: {
                episodeNumber: true,
                name: true,
                overview: true,
                airDate: true,
                runtimeMinutes: true,
                stillPath: true,
              },
            },
          },
        }),
        getRelatedNewsForEntity(prisma, ENTITY_TYPE, entityId),
        getCastForEntity(prisma, ENTITY_TYPE, entityId),
        getWatchAvailabilityForEntity(prisma, ENTITY_TYPE, entityId),
        prisma.entityExternalId.findMany({
          where: { entityType: ENTITY_TYPE, entityId },
          select: { source: true, externalId: true },
        }),
      ]);

    if (series === null) return null;

    const blocks: SeriesContentBlockInput[] = contentBlocks.map((block) => ({
      blockType: String(block.blockType),
      content: block.content,
      reviewStatus: String(block.reviewStatus),
    }));

    const seasonInputs: SeriesSeasonInput[] = seasons.map((season) => ({
      seasonNumber: season.seasonNumber,
      name: season.name,
      overview: season.overview,
      airYear: yearFromDate(season.airDate),
      episodeCount: season.episodeCount,
      posterPath: season.posterPath,
      episodes: season.episodes.map((episode) => ({
        episodeNumber: episode.episodeNumber,
        name: episode.name,
        overview: episode.overview,
        airYear: yearFromDate(episode.airDate),
        runtimeMinutes: episode.runtimeMinutes,
        stillPath: episode.stillPath,
      })),
    }));

    const view = buildSeriesPageView({
      record: {
        nameOriginal: series.nameOriginal,
        firstAirYear: yearFromDate(series.firstAirDate),
        lastAirYear: yearFromDate(series.lastAirDate),
        numberOfSeasons: series.numberOfSeasons,
        numberOfEpisodes: series.numberOfEpisodes,
        posterPath: series.posterPath,
        backdropPath: series.backdropPath,
        status: series.status,
        originalLanguage: series.originalLanguage,
      },
      translation,
      blocks,
      seasons: seasonInputs,
    });

    const indexability = evaluateSeriesIndexability({
      renderableBlockCount: view.renderableBlockCount,
    });
    const canonicalSlug = canonicalSlugRow?.slug ?? slug;
    const canonicalUrl = seriesCanonicalUrl(canonicalSlug);

    // Fonte unica da Fase 3: fatos vivos + decisao vigente persistida (fail-closed).
    const seo = await resolveEntityPageSeo(
      { entityType: ENTITY_TYPE, entityId, languageCode: LANGUAGE_CODE },
      {
        language: LANGUAGE_CODE,
        hasReliableStructuredData: true,
        displayedRatings: [],
        canonicalUrl,
        valueBlocksCount: view.renderableBlockCount,
      },
      prisma,
    );

    return {
      view,
      indexability,
      seo,
      canonicalSlug,
      canonicalUrl,
      relatedNews,
      cast,
      watch,
      externalIds,
    };
  },
);
