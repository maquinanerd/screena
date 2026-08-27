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

import { resolveEditorialScoreSources } from "./editorial-score";
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
import { findManyInChunks } from "../lib/prisma-in-chunks";
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

/**
 * Converte um `Decimal` do Prisma (ou number) em `number` seguro. Qualquer valor
 * nao finito vira `null` (fallback seguro — nunca NaN cruza para o presenter).
 * Mesma normalizacao usada no loader do hero (`home-hero.ts`).
 */
function decimalToNumber(
  value: { toString(): string } | number | null,
): number | null {
  if (value == null) return null;
  const num = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(num) ? num : null;
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
  // `ids` e a listagem INTEIRA daquele tipo. Acima de ~32.7 mil ids a consulta
  // nao cabe no protocolo do PostgreSQL. Ver `../lib/prisma-in-chunks`.
  const rows = await findManyInChunks(ids, (chunk) =>
    prisma.entityTranslation.findMany({
      where: { entityType, entityId: { in: chunk }, languageCode: LANGUAGE_CODE },
      select: { entityId: true, title: true },
    }),
  );
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
      findManyInChunks(ids, (chunk) =>
        prisma.movie.findMany({
          where: { id: { in: chunk } },
          select: {
            id: true,
            titleOriginal: true,
            releaseDate: true,
            posterPath: true,
            screenScore: true,
            screenScoreScale: true,
            screenScoreDisplay: true,
          },
        }),
      ),
      translationTitlesByEntity(prisma, "movie", ids),
    ]);
    // Procedencia do Cinerie Score em LOTE (ver `editorial-score`).
    const scoreSources = await resolveEditorialScoreSources(
      prisma,
      "movie",
      movies.map((movie) => ({
        entityId: movie.id,
        screenScore: decimalToNumber(movie.screenScore),
        screenScoreScale: movie.screenScoreScale,
      })),
    );
    items = movies.map((movie) => {
      const key = movie.id.toString();
      return {
        id: movie.id.toString(),
      titleOriginal: movie.titleOriginal,
        translationTitle: titleByEntity.get(key) ?? null,
        slug: slugByEntity.get(key) ?? null,
        year: yearFromDate(movie.releaseDate),
        posterPath: movie.posterPath,
        screenScore: decimalToNumber(movie.screenScore),
        screenScoreScale: movie.screenScoreScale,
        screenScoreDisplay: movie.screenScoreDisplay,
        screenScoreSource: scoreSources.get(key) ?? null,
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
      findManyInChunks(ids, (chunk) =>
        prisma.tvShow.findMany({
          where: { id: { in: chunk } },
          select: {
            id: true,
            nameOriginal: true,
            firstAirDate: true,
            lastAirDate: true,
            posterPath: true,
            screenScore: true,
            screenScoreScale: true,
            screenScoreDisplay: true,
          },
        }),
      ),
      translationTitlesByEntity(prisma, "tv", ids),
    ]);
    // Procedencia do Cinerie Score em LOTE (ver `editorial-score`).
    const scoreSources = await resolveEditorialScoreSources(
      prisma,
      "tv",
      shows.map((show) => ({
        entityId: show.id,
        screenScore: decimalToNumber(show.screenScore),
        screenScoreScale: show.screenScoreScale,
      })),
    );
    items = shows.map((show) => {
      const key = show.id.toString();
      return {
        id: show.id.toString(),
      nameOriginal: show.nameOriginal,
        translationTitle: titleByEntity.get(key) ?? null,
        slug: slugByEntity.get(key) ?? null,
        firstAirYear: yearFromDate(show.firstAirDate),
        lastAirYear: yearFromDate(show.lastAirDate),
        posterPath: show.posterPath,
        screenScore: decimalToNumber(show.screenScore),
        screenScoreScale: show.screenScoreScale,
        screenScoreDisplay: show.screenScoreDisplay,
        screenScoreSource: scoreSources.get(key) ?? null,
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
      findManyInChunks(ids, (chunk) =>
        prisma.person.findMany({
          where: { id: { in: chunk } },
          select: { id: true, name: true, knownForDepartment: true, profilePath: true },
        }),
      ),
      translationTitlesByEntity(prisma, "person", ids),
    ]);
    items = people.map((person) => {
      const key = person.id.toString();
      return {
        id: person.id.toString(),
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
