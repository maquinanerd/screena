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
import { relevanceSql } from "./showcase-relevance";

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

/**
 * "Mais aguardados" indexa quando ha ao menos uma estreia anunciada. A PAGINA e o
 * SITEMAP perguntam por esta funcao, e nao por copias da regra (auditoria de SEO,
 * 11/09/2026, secao 3.7: o hub era `index` na pagina e ficava fora do sitemap).
 */
export function anticipatedIndexable(data: Pick<AnticipatedData, "total">): boolean {
  return data.total > 0;
}

/** `YYYY-MM-DD` em UTC: a coluna e `date`, e o fuso da sessao nao pode deslocar o dia. */
function dayIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type PrismaClient = ReturnType<typeof getPrismaClient>;

interface MovieRow {
  id: bigint;
  titleOriginal: string;
  releaseDate: Date | null;
  runtimeMinutes: number | null;
  posterPath: string | null;
  createdAt: Date;
}

interface ShowRow {
  id: bigint;
  nameOriginal: string;
  firstAirDate: Date | null;
  numberOfEpisodes: number | null;
  posterPath: string | null;
  createdAt: Date;
}

interface ParentShow {
  nameOriginal: string;
  firstAirDate: Date | null;
  posterPath: string | null;
}

interface SeasonRow {
  tvShowId: bigint;
  seasonNumber: number;
  airDate: Date | null;
  episodeCount: number | null;
  posterPath: string | null;
  createdAt: Date;
  tvShow: ParentShow;
}

interface EpisodeRow {
  tvShowId: bigint;
  episodeNumber: number;
  name: string | null;
  airDate: Date | null;
  createdAt: Date;
  season: { seasonNumber: number; tvShow: ParentShow };
}

/**
 * ============================================================================
 * SO TITULO QUE ESTA NO INDICE (decisao do dono, 13/10/2026)
 * ============================================================================
 * Medido no ar em 13/10/2026: "Mais aguardados" de `/pt/explorar` abria com Le
 * corset, Cosmogonie, End of the Wall, KDE: The Documentary — a estreia mais
 * proxima do catalogo inteiro, quase sempre um titulo que responde `noindex,
 * follow` pelo portao de relevancia de 24/09. Esta pagina (`/pt/em-breve/`) e o
 * "Ver todos" daquela vitrine, entao as duas leem o mesmo getter e a mesma regra.
 *
 * O portao entra NO SQL, antes do `LIMIT`: filtrar depois esvaziaria a lista,
 * porque os primeiros 24 por data sao justamente a cauda. Temporada e episodio
 * seguem a SERIE dona. O predicado e o de `./showcase-relevance`, com os numeros
 * de `@screena/config`; a chave `CINERIE_RELEVANCE_GATE=off` tambem vale aqui.
 */
async function loadMovies(
  prisma: PrismaClient,
  where: string,
  orderBy: string,
  params: unknown[],
  limit: number,
): Promise<MovieRow[]> {
  const relevance = relevanceSql("movie", "m", params);
  params.push(limit);
  const rows = await prisma.$queryRawUnsafe<
    {
      id: bigint;
      title_original: string;
      release_date: Date | null;
      runtime_minutes: number | null;
      poster_path: string | null;
      created_at: Date;
    }[]
  >(
    `SELECT m.id, m.title_original, m.release_date, m.runtime_minutes, m.poster_path, m.created_at
       FROM movies m
      WHERE ${where}
        AND ${relevance}
      ORDER BY ${orderBy}
      LIMIT $${params.length}`,
    ...params,
  );
  return rows.map((row) => ({
    id: row.id,
    titleOriginal: row.title_original,
    releaseDate: row.release_date,
    runtimeMinutes: row.runtime_minutes,
    posterPath: row.poster_path,
    createdAt: row.created_at,
  }));
}

async function loadShows(
  prisma: PrismaClient,
  where: string,
  orderBy: string,
  params: unknown[],
  limit: number,
): Promise<ShowRow[]> {
  const relevance = relevanceSql("tv", "t", params);
  params.push(limit);
  const rows = await prisma.$queryRawUnsafe<
    {
      id: bigint;
      name_original: string;
      first_air_date: Date | null;
      number_of_episodes: number | null;
      poster_path: string | null;
      created_at: Date;
    }[]
  >(
    `SELECT t.id, t.name_original, t.first_air_date, t.number_of_episodes, t.poster_path, t.created_at
       FROM tv_shows t
      WHERE ${where}
        AND ${relevance}
      ORDER BY ${orderBy}
      LIMIT $${params.length}`,
    ...params,
  );
  return rows.map((row) => ({
    id: row.id,
    nameOriginal: row.name_original,
    firstAirDate: row.first_air_date,
    numberOfEpisodes: row.number_of_episodes,
    posterPath: row.poster_path,
    createdAt: row.created_at,
  }));
}

async function loadFutureSeasons(
  prisma: PrismaClient,
  cutoff: Date,
  limit: number,
): Promise<SeasonRow[]> {
  const params: unknown[] = [dayIso(cutoff)];
  const relevance = relevanceSql("tv", "t", params);
  params.push(limit);
  const rows = await prisma.$queryRawUnsafe<
    {
      tv_show_id: bigint;
      season_number: number;
      air_date: Date | null;
      episode_count: number | null;
      poster_path: string | null;
      created_at: Date;
      name_original: string;
      first_air_date: Date | null;
      show_poster_path: string | null;
    }[]
  >(
    `SELECT s.tv_show_id, s.season_number, s.air_date, s.episode_count, s.poster_path, s.created_at,
            t.name_original, t.first_air_date, t.poster_path AS show_poster_path
       FROM seasons s
       JOIN tv_shows t ON t.id = s.tv_show_id
      WHERE s.air_date > $1::date
        AND ${relevance}
      ORDER BY s.air_date ASC, s.tv_show_id ASC, s.season_number ASC
      LIMIT $${params.length}`,
    ...params,
  );
  return rows.map((row) => ({
    tvShowId: row.tv_show_id,
    seasonNumber: row.season_number,
    airDate: row.air_date,
    episodeCount: row.episode_count,
    posterPath: row.poster_path,
    createdAt: row.created_at,
    tvShow: {
      nameOriginal: row.name_original,
      firstAirDate: row.first_air_date,
      posterPath: row.show_poster_path,
    },
  }));
}

async function loadFutureEpisodes(
  prisma: PrismaClient,
  cutoff: Date,
  limit: number,
): Promise<EpisodeRow[]> {
  const params: unknown[] = [dayIso(cutoff)];
  const relevance = relevanceSql("tv", "t", params);
  params.push(limit);
  const rows = await prisma.$queryRawUnsafe<
    {
      tv_show_id: bigint;
      episode_number: number;
      name: string | null;
      air_date: Date | null;
      created_at: Date;
      season_number: number;
      name_original: string;
      first_air_date: Date | null;
      show_poster_path: string | null;
    }[]
  >(
    `SELECT e.tv_show_id, e.episode_number, e.name, e.air_date, e.created_at, s.season_number,
            t.name_original, t.first_air_date, t.poster_path AS show_poster_path
       FROM episodes e
       JOIN seasons s ON s.id = e.season_id
       JOIN tv_shows t ON t.id = e.tv_show_id
      WHERE e.air_date > $1::date
        AND ${relevance}
      ORDER BY e.air_date ASC, e.tv_show_id ASC, e.episode_number ASC
      LIMIT $${params.length}`,
    ...params,
  );
  return rows.map((row) => ({
    tvShowId: row.tv_show_id,
    episodeNumber: row.episode_number,
    name: row.name,
    airDate: row.air_date,
    createdAt: row.created_at,
    season: {
      seasonNumber: row.season_number,
      tvShow: {
        nameOriginal: row.name_original,
        firstAirDate: row.first_air_date,
        posterPath: row.show_poster_path,
      },
    },
  }));
}

export const getAnticipatedData = cache(async (): Promise<AnticipatedData> => {
  const prisma = getPrismaClient();
  const cutoff = startOfUtcDay(new Date());

  const hoje = dayIso(cutoff);
  const [datedMovies, undatedMovies, datedShows, undatedShows, futureSeasons, futureEpisodes] =
    await Promise.all([
      loadMovies(
        prisma,
        "m.release_date > $1::date",
        "m.release_date ASC, m.id ASC",
        [hoje],
        TAKE_PER_KIND,
      ),
      loadMovies(
        prisma,
        "m.release_date IS NULL AND m.status = ANY($1)",
        "m.popularity DESC, m.id ASC",
        [MOVIE_PRE_RELEASE_STATUSES],
        TAKE_UNDATED,
      ),
      loadShows(
        prisma,
        "t.first_air_date > $1::date",
        "t.first_air_date ASC, t.id ASC",
        [hoje],
        TAKE_PER_KIND,
      ),
      loadShows(
        prisma,
        "t.first_air_date IS NULL AND t.status = ANY($1)",
        "t.popularity DESC, t.id ASC",
        [TV_PRE_RELEASE_STATUSES],
        TAKE_UNDATED,
      ),
      loadFutureSeasons(prisma, cutoff, TAKE_PER_KIND * 2),
      loadFutureEpisodes(prisma, cutoff, 200),
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
