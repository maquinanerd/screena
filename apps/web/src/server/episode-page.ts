/**
 * episode-page.ts — Camada de dados SERVER-ONLY da pagina publica de episodio.
 *
 * Invariantes 3/4: le SOMENTE PostgreSQL local via @screena/db (Prisma); nunca
 * chama TMDB, Gemini ou qualquer host externo; read-only.
 *
 * O episodio NAO tem slug proprio: a URL usa o slug canonico da SERIE + numero
 * da temporada + numero do episodio. `notFound()` (retorno null) quando qualquer
 * elo da cadeia serie->temporada->episodio nao existe ou nao e coerente (os
 * filtros por `tvShowId`/`seasonId` garantem a relacao correta).
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";
import type { PageSeoResolution } from "@screena/seo";

import {
  buildEpisodePageView,
  type EpisodePageView,
} from "../lib/season-episode-presenter";
import { buildImagesGallery, type ImagesGalleryView } from "../lib/gallery-presenter";
import {
  episodeCanonicalUrl,
  seasonCanonicalUrl,
  seriesCanonicalUrl,
} from "../lib/site";
import { getEpisodeCredits, type EpisodeCredits } from "./episode-credits";
import { getImagesForEntity } from "./entity-gallery";
import { getImageDisplayAuthorization } from "./image-license";
import { resolveEntityPageSeo } from "./seo/indexability-decision";
import { applyPageSuspension } from "./seo/suspended-pages";

const LANGUAGE_CODE = "pt-BR";
const SERIES_ENTITY_TYPE = "tv";

export interface EpisodePageData {
  view: EpisodePageView;
  /** Elenco convidado, elenco regular e equipe. Vazio quando não há crédito. */
  credits: EpisodeCredits;
  /**
   * As imagens do episódio (`tmdb_images` com `entity_type='episode'`), já
   * gateadas pela licença de imagem e ordenadas pelo presenter da galeria.
   *
   * É a MESMA view da galeria de título: a página de episódio mostra as
   * primeiras e a sub-página `/imagens/` mostra todas. Duas montagens da mesma
   * lista divergiriam no primeiro conserto aplicado a uma só.
   */
  images: ImagesGalleryView;
  /** Resolucao FINAL de SEO do episodio (fatos vivos + decisao vigente). */
  seo: PageSeoResolution;
  canonicalSlug: string;
  /** URL canonica absoluta do episodio. */
  canonicalUrl: string;
  /** URL canonica absoluta da temporada (breadcrumb + partOfSeason). */
  seasonUrl: string;
  /** URL canonica absoluta da serie (breadcrumb + partOfSeries). */
  seriesUrl: string;
}

function isoDate(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}

function prevNext(
  numbers: number[],
  current: number,
): { prev: number | null; next: number | null } {
  const sorted = [...numbers].filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
  const index = sorted.indexOf(current);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: index > 0 ? (sorted[index - 1] ?? null) : null,
    next: index < sorted.length - 1 ? (sorted[index + 1] ?? null) : null,
  };
}

export const getEpisodePageData = cache(
  async (
    seriesSlug: string,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<EpisodePageData | null> => {
    if (
      !Number.isInteger(seasonNumber) ||
      seasonNumber < 1 ||
      !Number.isInteger(episodeNumber) ||
      episodeNumber < 1
    ) {
      return null;
    }
    const prisma = getPrismaClient();

    const slugRow = await prisma.slug.findFirst({
      where: { entityType: SERIES_ENTITY_TYPE, languageCode: LANGUAGE_CODE, slug: seriesSlug },
      select: { entityId: true },
    });
    if (slugRow === null) return null;
    const seriesId = slugRow.entityId;

    const [series, canonicalSlugRow, seriesTranslation, season] = await Promise.all([
      prisma.tvShow.findUnique({ where: { id: seriesId }, select: { nameOriginal: true } }),
      prisma.slug.findFirst({
        where: {
          entityType: SERIES_ENTITY_TYPE,
          entityId: seriesId,
          languageCode: LANGUAGE_CODE,
          isCanonical: true,
        },
        select: { slug: true },
      }),
      prisma.entityTranslation.findFirst({
        where: { entityType: SERIES_ENTITY_TYPE, entityId: seriesId, languageCode: LANGUAGE_CODE },
        select: { title: true },
      }),
      prisma.season.findFirst({
        where: { tvShowId: seriesId, seasonNumber },
        select: { id: true, seasonNumber: true, name: true },
      }),
    ]);

    if (series === null || season === null) return null;

    const [episode, episodeNumbers] = await Promise.all([
      prisma.episode.findFirst({
        where: { seasonId: season.id, episodeNumber },
        select: {
          id: true,
          // A CHAVE da mídia. `tmdb_images` guarda o still pelo id PRÓPRIO do
          // episódio, nunca pelo da série — ver `buildMediaTarget`.
          tmdbId: true,
          episodeNumber: true,
          name: true,
          overview: true,
          airDate: true,
          runtimeMinutes: true,
          stillPath: true,
        },
      }),
      prisma.episode.findMany({
        where: { seasonId: season.id },
        select: { episodeNumber: true },
        orderBy: { episodeNumber: "asc" },
      }),
    ]);

    if (episode === null) return null;

    const canonicalSlug = canonicalSlugRow?.slug ?? seriesSlug;
    const canonicalUrl = episodeCanonicalUrl(canonicalSlug, season.seasonNumber, episode.episodeNumber);
    const seasonUrl = seasonCanonicalUrl(canonicalSlug, season.seasonNumber);
    const seriesUrl = seriesCanonicalUrl(canonicalSlug);
    if (canonicalUrl === null || seasonUrl === null || seriesUrl === null) return null;

    const seriesTitle = seriesTranslation?.title?.trim() || series.nameOriginal;
    const { prev, next } = prevNext(
      episodeNumbers.map((row) => row.episodeNumber),
      episode.episodeNumber,
    );

    const view = buildEpisodePageView({
      seriesTitle,
      seriesSlug: canonicalSlug,
      seasonNumber: season.seasonNumber,
      seasonName: season.name,
      episodeNumber: episode.episodeNumber,
      name: episode.name,
      overview: episode.overview,
      airDateIso: isoDate(episode.airDate),
      runtimeMinutes: episode.runtimeMinutes,
      stillPath: episode.stillPath,
      prevEpisodeNumber: prev,
      nextEpisodeNumber: next,
    });

    /**
     * Créditos e imagens em PARALELO com o SEO: são três leituras
     * independentes do mesmo PostgreSQL, e encadeá-las somaria três idas ao
     * banco no tempo de resposta de uma página que já é servida com ISR.
     */
    const [credits, imageRows, authorization] = await Promise.all([
      getEpisodeCredits(prisma, episode.id),
      // Sem `tmdb_id` próprio não há chave de mídia: a lista sai vazia e a
      // página omite o bloco. Nunca cai para o id da série — isso mostraria as
      // imagens de OUTRO episódio.
      episode.tmdbId === null
        ? Promise.resolve([] as const)
        : getImagesForEntity(prisma, "episode", episode.tmdbId),
      getImageDisplayAuthorization(prisma),
    ]);

    const resolved = await resolveEntityPageSeo(
      { entityType: "episode", entityId: episode.id, languageCode: LANGUAGE_CODE },
      {
        language: LANGUAGE_CODE,
        hasReliableStructuredData: true,
        displayedRatings: [],
        canonicalUrl,
      },
      prisma,
    );
    // VALVULA 2026-08-27: o par obrigatorio da saida do sitemap.
    // Sair do sitemap nao desindexa; a meta tag desindexa.
    const seo = applyPageSuspension("episode", resolved);

    return {
      view,
      credits,
      images: buildImagesGallery(imageRows, view.episodeTitle, authorization),
      seo,
      canonicalSlug,
      canonicalUrl,
      seasonUrl,
      seriesUrl,
    };
  },
);
