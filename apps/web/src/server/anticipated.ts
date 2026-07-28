/**
 * anticipated.ts — Camada de dados SERVER-ONLY da tela 12 (Mais Aguardados).
 *
 * Invariantes 3/4: lê SOMENTE PostgreSQL local via @screena/db (Prisma); zero
 * API externa e zero Gemini no render. A ingestão de upcoming acontece offline
 * no worker; aqui apenas montamos um snapshot serializável.
 *
 * Cobertura REAL (nunca inventada):
 *  - filmes com estreia futura (Movie.releaseDate > hoje);
 *  - filmes anunciados SEM data (status pré-lançamento) — pílula âmbar;
 *  - séries com estreia futura (TvShow.firstAirDate > hoje) e anunciadas sem data;
 *  - temporadas futuras de séries já conhecidas (Season.airDate > hoje);
 *  - próximo episódio futuro por série já em exibição (1 por série).
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  buildAnticipatedEpisodeCard,
  buildAnticipatedMovieCard,
  buildAnticipatedSeasonCard,
  buildAnticipatedShowCard,
  type AnticipatedCard,
} from "../lib/anticipated-presenter";

const LANGUAGE_CODE = "pt-BR";
const TAKE_PER_KIND = 24;
const TAKE_UNDATED = 12;

/** Status TMDB que significam "anunciado/pré-lançamento" (sem data ainda). */
const MOVIE_PRE_RELEASE_STATUSES = ["Planned", "In Production", "Post Production"];
const TV_PRE_RELEASE_STATUSES = ["Planned", "In Production"];

export interface AnticipatedData {
  cards: AnticipatedCard[];
  total: number;
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export const getAnticipatedData = cache(async (): Promise<AnticipatedData> => {
  const prisma = getPrismaClient();
  const cutoff = startOfUtcDay(new Date());

  const [datedMovies, undatedMovies, datedShows, undatedShows, futureSeasons, futureEpisodes] =
    await Promise.all([
      prisma.movie.findMany({
        where: { releaseDate: { gt: cutoff } },
        select: {
          id: true,
          titleOriginal: true,
          releaseDate: true,
          runtimeMinutes: true,
          posterPath: true,
          createdAt: true,
        },
        orderBy: { releaseDate: "asc" },
        take: TAKE_PER_KIND,
      }),
      prisma.movie.findMany({
        where: { releaseDate: null, status: { in: MOVIE_PRE_RELEASE_STATUSES } },
        select: {
          id: true,
          titleOriginal: true,
          releaseDate: true,
          runtimeMinutes: true,
          posterPath: true,
          createdAt: true,
        },
        orderBy: { popularity: "desc" },
        take: TAKE_UNDATED,
      }),
      prisma.tvShow.findMany({
        where: { firstAirDate: { gt: cutoff } },
        select: {
          id: true,
          nameOriginal: true,
          firstAirDate: true,
          numberOfEpisodes: true,
          posterPath: true,
          createdAt: true,
        },
        orderBy: { firstAirDate: "asc" },
        take: TAKE_PER_KIND,
      }),
      prisma.tvShow.findMany({
        where: { firstAirDate: null, status: { in: TV_PRE_RELEASE_STATUSES } },
        select: {
          id: true,
          nameOriginal: true,
          firstAirDate: true,
          numberOfEpisodes: true,
          posterPath: true,
          createdAt: true,
        },
        orderBy: { popularity: "desc" },
        take: TAKE_UNDATED,
      }),
      prisma.season.findMany({
        where: { airDate: { gt: cutoff } },
        select: {
          tvShowId: true,
          seasonNumber: true,
          airDate: true,
          episodeCount: true,
          posterPath: true,
          createdAt: true,
          tvShow: {
            select: { nameOriginal: true, firstAirDate: true, posterPath: true },
          },
        },
        orderBy: { airDate: "asc" },
        take: TAKE_PER_KIND * 2,
      }),
      prisma.episode.findMany({
        where: { airDate: { gt: cutoff } },
        select: {
          tvShowId: true,
          episodeNumber: true,
          name: true,
          airDate: true,
          createdAt: true,
          season: {
            select: {
              seasonNumber: true,
              tvShow: { select: { nameOriginal: true, firstAirDate: true, posterPath: true } },
            },
          },
        },
        orderBy: { airDate: "asc" },
        take: 200,
      }),
    ]);

  // Temporada 1 de série que AINDA vai estrear é coberta pelo card da série.
  const seasons = futureSeasons
    .filter(
      (season) =>
        !(
          season.seasonNumber === 1 &&
          season.tvShow.firstAirDate !== null &&
          season.tvShow.firstAirDate > cutoff
        ),
    )
    .slice(0, TAKE_PER_KIND);

  // Episódios: apenas séries JÁ em exibição, 1 (o próximo) por série.
  const nextEpisodeByShow = new Map<string, (typeof futureEpisodes)[number]>();
  for (const episode of futureEpisodes) {
    const firstAir = episode.season.tvShow.firstAirDate;
    if (firstAir === null || firstAir > cutoff) continue;
    const key = episode.tvShowId.toString();
    if (!nextEpisodeByShow.has(key)) nextEpisodeByShow.set(key, episode);
  }
  const episodes = [...nextEpisodeByShow.values()].slice(0, TAKE_PER_KIND);

  const movieIds = [...datedMovies, ...undatedMovies].map((movie) => movie.id);
  const showIds = new Set<bigint>([
    ...datedShows.map((show) => show.id),
    ...undatedShows.map((show) => show.id),
    ...seasons.map((season) => season.tvShowId),
    ...episodes.map((episode) => episode.tvShowId),
  ]);

  const [translations, slugs] = await Promise.all([
    prisma.entityTranslation.findMany({
      where: {
        OR: [
          { entityType: "movie", entityId: { in: movieIds } },
          { entityType: "tv", entityId: { in: [...showIds] } },
        ],
        languageCode: LANGUAGE_CODE,
      },
      select: { entityType: true, entityId: true, title: true },
    }),
    prisma.slug.findMany({
      where: {
        OR: [
          { entityType: "movie", entityId: { in: movieIds } },
          { entityType: "tv", entityId: { in: [...showIds] } },
        ],
        languageCode: LANGUAGE_CODE,
        isCanonical: true,
      },
      select: { entityType: true, entityId: true, slug: true },
    }),
  ]);

  const titleByKey = new Map<string, string | null>();
  for (const row of translations) {
    titleByKey.set(`${row.entityType}:${row.entityId}`, row.title);
  }
  const slugByKey = new Map<string, string>();
  for (const row of slugs) slugByKey.set(`${row.entityType}:${row.entityId}`, row.slug);

  const cards: AnticipatedCard[] = [];

  for (const movie of [...datedMovies, ...undatedMovies]) {
    const key = `movie:${movie.id}`;
    const card = buildAnticipatedMovieCard({
      id: movie.id.toString(),
      titleOriginal: movie.titleOriginal,
      translationTitle: titleByKey.get(key) ?? null,
      slug: slugByKey.get(key) ?? null,
      releaseDate: movie.releaseDate,
      runtimeMinutes: movie.runtimeMinutes,
      posterPath: movie.posterPath,
      createdAt: movie.createdAt,
    });
    if (card !== null) cards.push(card);
  }

  for (const show of [...datedShows, ...undatedShows]) {
    const key = `tv:${show.id}`;
    const card = buildAnticipatedShowCard({
      id: show.id.toString(),
      nameOriginal: show.nameOriginal,
      translationTitle: titleByKey.get(key) ?? null,
      slug: slugByKey.get(key) ?? null,
      firstAirDate: show.firstAirDate,
      numberOfEpisodes: show.numberOfEpisodes,
      posterPath: show.posterPath,
      createdAt: show.createdAt,
    });
    if (card !== null) cards.push(card);
  }

  for (const season of seasons) {
    const key = `tv:${season.tvShowId}`;
    const card = buildAnticipatedSeasonCard({
      tvShowId: season.tvShowId.toString(),
      seasonNumber: season.seasonNumber,
      airDate: season.airDate,
      episodeCount: season.episodeCount,
      posterPath: season.posterPath,
      createdAt: season.createdAt,
      showNameOriginal: season.tvShow.nameOriginal,
      showTranslationTitle: titleByKey.get(key) ?? null,
      showSlug: slugByKey.get(key) ?? null,
      showPosterPath: season.tvShow.posterPath,
    });
    if (card !== null) cards.push(card);
  }

  for (const episode of episodes) {
    const key = `tv:${episode.tvShowId}`;
    const card = buildAnticipatedEpisodeCard({
      tvShowId: episode.tvShowId.toString(),
      seasonNumber: episode.season.seasonNumber,
      episodeNumber: episode.episodeNumber,
      name: episode.name,
      airDate: episode.airDate,
      createdAt: episode.createdAt,
      showNameOriginal: episode.season.tvShow.nameOriginal,
      showTranslationTitle: titleByKey.get(key) ?? null,
      showSlug: slugByKey.get(key) ?? null,
      showPosterPath: episode.season.tvShow.posterPath,
    });
    if (card !== null) cards.push(card);
  }

  return { cards, total: cards.length };
});
