/**
 * Snapshot de catálogo para a faixa “Filmes em alta” da home canônica.
 *
 * Somente PostgreSQL local: a consulta não chama TMDB nem qualquer serviço no
 * render. `popularity` é o valor já ingerido offline; registros sem esse sinal
 * são omitidos para que a UI nunca rotule uma ordenação arbitrária como “em
 * alta”. O presenter puro preserva a ordem e nunca repete cards.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  buildTrendingMovieCards,
  HOME_TRENDING_CARD_LIMIT,
} from "../lib/home-catalog-presenter";
import type {
  EntityCard,
  MovieListItemInput,
} from "../lib/entity-index-presenter";

const LANGUAGE_CODE = "pt-BR";

function yearFromDate(date: Date | null): number | null {
  return date === null ? null : date.getUTCFullYear();
}

function decimalToNumber(
  value: { toString(): string } | number | null,
): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

async function canonicalIdentity(
  entityType: "movie",
): Promise<{
  ids: bigint[];
  slugById: Map<string, string>;
  titleById: Map<string, string | null>;
}> {
  const prisma = getPrismaClient();
  const slugs = await prisma.slug.findMany({
    where: { entityType, languageCode: LANGUAGE_CODE, isCanonical: true },
    select: { entityId: true, slug: true },
  });
  const ids = slugs.map((row) => row.entityId);
  const slugById = new Map(
    slugs.map((row) => [row.entityId.toString(), row.slug] as const),
  );
  if (ids.length === 0) return { ids, slugById, titleById: new Map() };

  const translations = await prisma.entityTranslation.findMany({
    where: { entityType, entityId: { in: ids }, languageCode: LANGUAGE_CODE },
    select: { entityId: true, title: true },
  });
  const titleById = new Map(
    translations.map((row) => [row.entityId.toString(), row.title] as const),
  );
  return { ids, slugById, titleById };
}

export interface HomeCatalogData {
  movies: EntityCard[];
}

export const getHomeCatalogData = cache(async (): Promise<HomeCatalogData> => {
  const prisma = getPrismaClient();
  const movieIdentity = await canonicalIdentity("movie");
  const movies =
    movieIdentity.ids.length === 0
      ? []
      : await prisma.movie.findMany({
          where: {
            id: { in: movieIdentity.ids },
            popularity: { not: null },
          },
          orderBy: [{ popularity: "desc" }, { id: "asc" }],
          take: HOME_TRENDING_CARD_LIMIT,
          select: {
            id: true,
            titleOriginal: true,
            releaseDate: true,
            posterPath: true,
            screenScore: true,
            screenScoreScale: true,
            screenScoreDisplay: true,
          },
        });

  const movieInputs: MovieListItemInput[] = movies.map((movie) => {
    const key = movie.id.toString();
    return {
      titleOriginal: movie.titleOriginal,
      translationTitle: movieIdentity.titleById.get(key) ?? null,
      slug: movieIdentity.slugById.get(key) ?? null,
      year: yearFromDate(movie.releaseDate),
      posterPath: movie.posterPath,
      screenScore: decimalToNumber(movie.screenScore),
      screenScoreScale: movie.screenScoreScale,
      screenScoreDisplay: movie.screenScoreDisplay,
    };
  });
  return {
    movies: buildTrendingMovieCards(movieInputs),
  };
});
