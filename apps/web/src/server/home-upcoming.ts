/**
 * home-upcoming.ts — Camada de dados SERVER-ONLY da seção "Em breve" da home:
 * filmes com estreia FUTURA já ingeridos do TMDB (offline) no PostgreSQL.
 *
 * Invariantes 3 e 4:
 *  - Lê somente PostgreSQL local via @screena/db (Prisma). Zero API externa,
 *    zero TMDB, zero Gemini no caminho de render.
 *  - Não escreve no banco; apenas monta um snapshot serializável para a home.
 *
 * A descoberta/ingestão de upcoming acontece OFFLINE no worker
 * (services/ingestion/bin/ingest-public-catalog.ts --include-upcoming). Aqui só
 * lemos o resultado já persistido (Movie.releaseDate futura + slug pt-BR).
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  buildUpcomingMovies,
  HOME_UPCOMING_LIMIT,
  type HomeUpcomingMovie,
  type UpcomingMovieInput,
} from "../lib/home-upcoming-presenter";

const LANGUAGE_CODE = "pt-BR";

/** Início do dia UTC de `now` (cutoff de "estreia futura" para o filtro no banco). */
function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Filmes "Em breve" (estreia futura) para a home, em ordem de estreia asc, com
 * slug canônico pt-BR. Retorna `[]` quando não há nenhum e a home oculta a seção.
 */
export const getHomeUpcomingMovies = cache(
  async (options?: { limit?: number }): Promise<HomeUpcomingMovie[]> => {
    const prisma = getPrismaClient();
    const now = new Date();
    const cutoff = startOfUtcDay(now);

    const slugRows = await prisma.slug.findMany({
      where: { entityType: "movie", languageCode: LANGUAGE_CODE, isCanonical: true },
      select: { entityId: true, slug: true },
    });
    if (slugRows.length === 0) return [];

    const slugByEntity = new Map<string, string>();
    const ids: bigint[] = [];
    for (const row of slugRows) {
      slugByEntity.set(row.entityId.toString(), row.slug);
      ids.push(row.entityId);
    }

    const [movies, translations] = await Promise.all([
      prisma.movie.findMany({
        where: { id: { in: ids }, releaseDate: { gt: cutoff } },
        select: {
          id: true,
          titleOriginal: true,
          releaseDate: true,
          backdropPath: true,
          posterPath: true,
        },
        orderBy: { releaseDate: "asc" },
      }),
      prisma.entityTranslation.findMany({
        where: { entityType: "movie", entityId: { in: ids }, languageCode: LANGUAGE_CODE },
        select: { entityId: true, title: true },
      }),
    ]);

    const titleByEntity = new Map<string, string | null>();
    for (const row of translations) {
      titleByEntity.set(row.entityId.toString(), row.title);
    }

    const inputs: UpcomingMovieInput[] = movies.map((movie) => {
      const key = movie.id.toString();
      return {
        titleOriginal: movie.titleOriginal,
        translationTitle: titleByEntity.get(key) ?? null,
        slug: slugByEntity.get(key) ?? null,
        releaseDate: movie.releaseDate,
        backdropPath: movie.backdropPath,
        posterPath: movie.posterPath,
      };
    });

    return buildUpcomingMovies(inputs, now, options?.limit ?? HOME_UPCOMING_LIMIT);
  },
);
