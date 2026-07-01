/**
 * entity-indexes.ts - Camada de dados SERVER-ONLY das listagens publicas
 * (portas de entrada) de filmes, series e pessoas.
 *
 * Invariantes 3 e 4:
 *  - Le somente PostgreSQL local via @screena/db (Prisma).
 *  - Nao chama TMDB, Gemini, ratings, streaming ou qualquer API externa.
 *  - Nao escreve no banco; apenas monta snapshot para render.
 *
 * So entram na listagem entidades com slug canonico pt-BR e titulo/nome valido;
 * a ordenacao/cap/gate anti-thin vivem no presenter puro `entity-index-presenter`.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import { SITE_URL } from "../lib/site";
import {
  buildMovieIndexView,
  buildPersonIndexView,
  buildSeriesIndexView,
  evaluateEntityIndexIndexability,
  type EntityIndexView,
  type MovieListItemInput,
  type PersonListItemInput,
  type SeriesListItemInput,
} from "../lib/entity-index-presenter";
import type { IndexabilityResult } from "@screena/seo";

const LANGUAGE_CODE = "pt-BR";
const MOVIE_INDEX_PATH = "/pt/filmes/";
const SERIES_INDEX_PATH = "/pt/series/";
const PERSON_INDEX_PATH = "/pt/pessoas/";

/** Tipos de entidade polimorfica usados nas listagens (subset de EntityType). */
type IndexEntityType = "movie" | "tv" | "person";

export interface EntityIndexData {
  view: EntityIndexView;
  indexability: IndexabilityResult;
  canonicalUrl: string;
}

function yearFromDate(date: Date | null): number | null {
  return date === null ? null : date.getUTCFullYear();
}

/** Slugs canonicos pt-BR de um tipo, indexados por entityId (string). */
async function canonicalSlugsByEntity(
  prisma: ReturnType<typeof getPrismaClient>,
  entityType: IndexEntityType,
): Promise<{ ids: bigint[]; slugByEntity: Map<string, string> }> {
  const rows = await prisma.slug.findMany({
    where: { entityType, languageCode: LANGUAGE_CODE, isCanonical: true },
    select: { entityId: true, slug: true },
  });
  const slugByEntity = new Map<string, string>();
  const ids: bigint[] = [];
  for (const row of rows) {
    slugByEntity.set(row.entityId.toString(), row.slug);
    ids.push(row.entityId);
  }
  return { ids, slugByEntity };
}

async function translationTitlesByEntity(
  prisma: ReturnType<typeof getPrismaClient>,
  entityType: IndexEntityType,
  ids: bigint[],
): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.entityTranslation.findMany({
    where: { entityType, entityId: { in: ids }, languageCode: LANGUAGE_CODE },
    select: { entityId: true, title: true },
  });
  const out = new Map<string, string | null>();
  for (const row of rows) out.set(row.entityId.toString(), row.title);
  return out;
}

export const getMovieIndexData = cache(async (): Promise<EntityIndexData> => {
  const prisma = getPrismaClient();
  const { ids, slugByEntity } = await canonicalSlugsByEntity(prisma, "movie");

  let items: MovieListItemInput[] = [];
  if (ids.length > 0) {
    const [movies, titleByEntity] = await Promise.all([
      prisma.movie.findMany({
        where: { id: { in: ids } },
        select: { id: true, titleOriginal: true, releaseDate: true, posterPath: true },
      }),
      translationTitlesByEntity(prisma, "movie", ids),
    ]);
    items = movies.map((movie) => {
      const key = movie.id.toString();
      return {
        titleOriginal: movie.titleOriginal,
        translationTitle: titleByEntity.get(key) ?? null,
        slug: slugByEntity.get(key) ?? null,
        year: yearFromDate(movie.releaseDate),
        posterPath: movie.posterPath,
      };
    });
  }

  const view = buildMovieIndexView(items);
  return {
    view,
    indexability: evaluateEntityIndexIndexability({ itemCount: view.totalCount }),
    canonicalUrl: `${SITE_URL}${MOVIE_INDEX_PATH}`,
  };
});

export const getSeriesIndexData = cache(async (): Promise<EntityIndexData> => {
  const prisma = getPrismaClient();
  const { ids, slugByEntity } = await canonicalSlugsByEntity(prisma, "tv");

  let items: SeriesListItemInput[] = [];
  if (ids.length > 0) {
    const [shows, titleByEntity] = await Promise.all([
      prisma.tvShow.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          nameOriginal: true,
          firstAirDate: true,
          lastAirDate: true,
          posterPath: true,
        },
      }),
      translationTitlesByEntity(prisma, "tv", ids),
    ]);
    items = shows.map((show) => {
      const key = show.id.toString();
      return {
        nameOriginal: show.nameOriginal,
        translationTitle: titleByEntity.get(key) ?? null,
        slug: slugByEntity.get(key) ?? null,
        firstAirYear: yearFromDate(show.firstAirDate),
        lastAirYear: yearFromDate(show.lastAirDate),
        posterPath: show.posterPath,
      };
    });
  }

  const view = buildSeriesIndexView(items);
  return {
    view,
    indexability: evaluateEntityIndexIndexability({ itemCount: view.totalCount }),
    canonicalUrl: `${SITE_URL}${SERIES_INDEX_PATH}`,
  };
});

export const getPersonIndexData = cache(async (): Promise<EntityIndexData> => {
  const prisma = getPrismaClient();
  const { ids, slugByEntity } = await canonicalSlugsByEntity(prisma, "person");

  let items: PersonListItemInput[] = [];
  if (ids.length > 0) {
    const [people, titleByEntity] = await Promise.all([
      prisma.person.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, knownForDepartment: true, profilePath: true },
      }),
      translationTitlesByEntity(prisma, "person", ids),
    ]);
    items = people.map((person) => {
      const key = person.id.toString();
      return {
        name: person.name,
        translationTitle: titleByEntity.get(key) ?? null,
        slug: slugByEntity.get(key) ?? null,
        knownForDepartment: person.knownForDepartment,
        profilePath: person.profilePath,
      };
    });
  }

  const view = buildPersonIndexView(items);
  return {
    view,
    indexability: evaluateEntityIndexIndexability({ itemCount: view.totalCount }),
    canonicalUrl: `${SITE_URL}${PERSON_INDEX_PATH}`,
  };
});
