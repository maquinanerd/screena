/**
 * series-page.ts - Camada de dados SERVER-ONLY da pagina publica de serie.
 *
 * Invariantes 3 e 4:
 *  - Le somente PostgreSQL local via @screena/db (Prisma).
 *  - Nao chama TMDB, Gemini nem qualquer API externa. Ratings e disponibilidade
 *    de streaming sao LIDOS do PostgreSQL (ja ingeridos offline por worker e
 *    filtrados por licenca), nunca buscados ao vivo em RapidAPI/IMDb/RT.
 *  - Nao escreve no banco; apenas monta snapshot para render.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import { SITE_URL } from "../lib/site";
import {
  isPublishedLocale,
  publishedLocaleRank,
} from "../lib/synopsis-language";
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
import { getWatchAvailabilityForEntity, watchAbsenceReason } from "./entity-watch";
import type { SectionAbsenceReason } from "../lib/section-absence";
import {
  awardsAbsenceReason,
  getAwardsForEntity,
  type AwardsPanelView,
} from "./entity-awards";
import { getRatingsForEntity } from "./entity-ratings";
import { buildRatingsView, type RatingsPanelView } from "../lib/ratings-presenter";
import type { NewsCardView } from "../lib/news-presenter";
import type { CastMemberView } from "../lib/cast-presenter";
import type { WatchAvailabilityView } from "../lib/watch-availability-presenter";
import type { IndexabilityResult, PageSeoResolution } from "@screena/seo";

const LANGUAGE_CODE = "pt-BR";
const ENTITY_TYPE = "tv";
const SERIES_INDEX_PATH = "/pt/series/";

export interface SeriesPageData {
  view: SeriesPageView;
  /** C8: id INTERNO do catalogo, serializado, para o botao de biblioteca. */
  entityId: string;
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
  /**
   * Por que o painel de "Onde assistir" nao renderizou. Derivado do ESTADO do
   * catalogo (ver `watchAbsenceReason`), nunca fixo na pagina. `null` quando
   * `watch` existe: nao ha ausencia para justificar.
   */
  watchAbsence: SectionAbsenceReason | null;
  /** Faixa de premios licenciada e creditada; `null` omite a faixa. */
  awards: AwardsPanelView | null;
  /**
   * Por que a faixa de premios nao renderizou. Derivado do ESTADO do catalogo
   * (ver `awardsAbsenceReason`), nunca fixo na pagina. `null` quando `awards`
   * existe: nao ha ausencia para justificar.
   */
  awardsAbsence: SectionAbsenceReason | null;
  /** Notas externas licenciadas e creditadas; `null` omite o painel. */
  ratings: RatingsPanelView | null;
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

    const [series, canonicalSlugRow, translations, contentBlocks, seasons, relatedNews, cast, watch, externalIds] =
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
        // TODAS as traducoes (ver a mesma nota em `movie-page.ts`): a escolha
        // da sinopse virou codigo puro testado, nao o WHERE.
        prisma.entityTranslation.findMany({
          where: {
            entityType: ENTITY_TYPE,
            entityId,
          },
          select: {
            languageCode: true,
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

    // Locale publicado: unica fonte de titulo/metadados (ver `movie-page.ts`).
    const translation =
      translations
        .filter((row) => isPublishedLocale(row.languageCode))
        .sort(
          (a, b) =>
            publishedLocaleRank(a.languageCode) -
            publishedLocaleRank(b.languageCode),
        )[0] ?? null;

    const view = buildSeriesPageView({
      translations,
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

    // Ver movie-page.ts: ratings vem depois da Promise.all (o `EntityRef` precisa
    // de titulo + URL canonica) e alimentam o gate de licenca do SEO abaixo, que
    // antes recebia `[]` fixo — gate cego da invariante 6.
    const ratingsPayload = await getRatingsForEntity(prisma, ENTITY_TYPE, entityId, {
      kind: "tv",
      id: String(entityId),
      title: view.title,
      canonicalUrl,
    });
    const ratings = buildRatingsView(ratingsPayload);

    // Fonte unica da Fase 3: fatos vivos + decisao vigente persistida (fail-closed).
    const seo = await resolveEntityPageSeo(
      { entityType: ENTITY_TYPE, entityId, languageCode: LANGUAGE_CODE },
      {
        language: LANGUAGE_CODE,
        hasReliableStructuredData: true,
        // Exatamente as notas RENDERIZADAS (ver movie-page.ts).
        displayedRatings: (ratings?.items ?? []).map(() => ({
          licenseDisplayAllowed: true,
        })),
        canonicalUrl,
        valueBlocksCount: view.renderableBlockCount,
      },
      prisma,
    );

    // O motivo da AUSENCIA do painel de streaming e derivado do estado, nunca
    // fixo. So consulta quando nao ha painel — quem tem oferta nao paga a sonda.
    const watchAbsence = watch === null ? await watchAbsenceReason(prisma) : null;

    // Premiacao: o FATO ("Venceu 4 Oscars"), nunca uma nota. Mesma disciplina
    // do painel de streaming — o motivo da ausencia e derivado do estado do
    // catalogo, e a sonda so roda quando nao ha faixa.
    const awards = await getAwardsForEntity(prisma, ENTITY_TYPE, entityId);
    const awardsAbsence = awards === null ? await awardsAbsenceReason(prisma) : null;

    return {
      view,
      // C8: id INTERNO do catalogo, serializado — o botao de biblioteca o usa
      // para referenciar a entidade canonica (nunca o slug).
      entityId: String(entityId),
      indexability,
      seo,
      canonicalSlug,
      canonicalUrl,
      relatedNews,
      cast,
      watch,
      watchAbsence,
      awards,
      awardsAbsence,
      ratings,
      externalIds,
    };
  },
);
