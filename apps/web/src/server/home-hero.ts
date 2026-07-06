/**
 * home-hero.ts — Camada de dados SERVER-ONLY do hero-carousel da home publica.
 *
 * Invariantes 3 e 4:
 *  - Le somente PostgreSQL local via @screena/db (Prisma). Zero API externa,
 *    zero Gemini, zero TMDB no caminho de render.
 *  - Nao escreve no banco; apenas monta um snapshot serializavel para o client.
 *
 * Fronteira de serializacao: converte `Decimal`/`BigInt`/Date do Prisma em
 * primitivos e delega a montagem/validacao ao presenter PURO
 * `home-hero-presenter`. O client component so recebe `HeroSlide[]` plano.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import { getCastForEntity } from "./entity-cast";
import {
  buildHeroSlides,
  type HeroSlide,
  type HeroSlideInput,
} from "../lib/home-hero-presenter";

const LANGUAGE_CODE = "pt-BR";

/** Quantos slides o carousel exibe no maximo. */
export const HOME_HERO_SLIDE_LIMIT = 5;

type PrismaClient = ReturnType<typeof getPrismaClient>;
type HeroEntityType = "movie" | "tv";

/** Ano UTC de uma data (ou null). */
function yearFromDate(date: Date | null): number | null {
  return date === null ? null : date.getUTCFullYear();
}

/**
 * Converte um `Decimal` do Prisma (ou number) em `number` seguro. Qualquer valor
 * nao finito vira null (fallback seguro — nunca NaN cruza para o presenter).
 */
function decimalToNumber(value: { toString(): string } | number | null): number | null {
  if (value == null) return null;
  const num = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(num) ? num : null;
}

/** Slugs canonicos pt-BR de um tipo, indexados por entityId (string). */
async function canonicalSlugsByEntity(
  prisma: PrismaClient,
  entityType: HeroEntityType,
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

/** Titulo + resumo editorial pt-BR por entityId (string). */
async function translationsByEntity(
  prisma: PrismaClient,
  entityType: HeroEntityType,
  ids: bigint[],
): Promise<Map<string, { title: string | null; summary: string | null }>> {
  const out = new Map<string, { title: string | null; summary: string | null }>();
  if (ids.length === 0) return out;
  const rows = await prisma.entityTranslation.findMany({
    where: { entityType, entityId: { in: ids }, languageCode: LANGUAGE_CODE },
    select: { entityId: true, title: true, summary: true },
  });
  for (const row of rows) {
    out.set(row.entityId.toString(), { title: row.title, summary: row.summary });
  }
  return out;
}

/** Nome do DIRETOR (crew) de um titulo, ou null quando nao ha crew de direcao. */
async function directorNameForEntity(
  prisma: PrismaClient,
  entityType: HeroEntityType,
  entityId: bigint,
): Promise<string | null> {
  const row = await prisma.crewMember.findFirst({
    where: {
      entityType,
      entityId,
      OR: [{ job: "Director" }, { department: "Directing" }],
    },
    orderBy: { id: "asc" },
    select: { person: { select: { name: true } } },
  });
  return row?.person.name ?? null;
}

/** Candidato leve antes de resolver creditos (crew/cast). */
interface HeroCandidate {
  kind: "movie" | "series";
  entityType: HeroEntityType;
  entityId: bigint;
  input: Omit<HeroSlideInput, "director" | "cast">;
  /** Chave de ordenacao (ano desc; sem ano vai ao fim). */
  year: number | null;
}

/** Monta os candidatos de FILME (sem crew/cast ainda). */
async function movieCandidates(prisma: PrismaClient): Promise<HeroCandidate[]> {
  const { ids, slugByEntity } = await canonicalSlugsByEntity(prisma, "movie");
  if (ids.length === 0) return [];
  const [movies, translations] = await Promise.all([
    prisma.movie.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        titleOriginal: true,
        releaseDate: true,
        certification: true,
        screenScore: true,
        screenScoreScale: true,
        screenScoreDisplay: true,
      },
    }),
    translationsByEntity(prisma, "movie", ids),
  ]);
  return movies.map((movie) => {
    const key = movie.id.toString();
    const translation = translations.get(key) ?? { title: null, summary: null };
    const year = yearFromDate(movie.releaseDate);
    return {
      kind: "movie" as const,
      entityType: "movie" as const,
      entityId: movie.id,
      year,
      input: {
        kind: "movie",
        title: translation.title ?? movie.titleOriginal,
        slug: slugByEntity.get(key) ?? null,
        year,
        seasonsCount: null,
        episodesCount: null,
        certification: movie.certification,
        screenScore: decimalToNumber(movie.screenScore),
        screenScoreScale: movie.screenScoreScale,
        screenScoreDisplay: movie.screenScoreDisplay,
        summary: translation.summary,
      },
    };
  });
}

/** Monta os candidatos de SERIE (sem crew/cast ainda). */
async function seriesCandidates(prisma: PrismaClient): Promise<HeroCandidate[]> {
  const { ids, slugByEntity } = await canonicalSlugsByEntity(prisma, "tv");
  if (ids.length === 0) return [];
  const [shows, translations] = await Promise.all([
    prisma.tvShow.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        nameOriginal: true,
        firstAirDate: true,
        numberOfSeasons: true,
        numberOfEpisodes: true,
        certification: true,
        screenScore: true,
        screenScoreScale: true,
        screenScoreDisplay: true,
      },
    }),
    translationsByEntity(prisma, "tv", ids),
  ]);
  return shows.map((show) => {
    const key = show.id.toString();
    const translation = translations.get(key) ?? { title: null, summary: null };
    const year = yearFromDate(show.firstAirDate);
    return {
      kind: "series" as const,
      entityType: "tv" as const,
      entityId: show.id,
      year,
      input: {
        kind: "series",
        title: translation.title ?? show.nameOriginal,
        slug: slugByEntity.get(key) ?? null,
        year,
        seasonsCount: show.numberOfSeasons,
        episodesCount: show.numberOfEpisodes,
        certification: show.certification,
        screenScore: decimalToNumber(show.screenScore),
        screenScoreScale: show.screenScoreScale,
        screenScoreDisplay: show.screenScoreDisplay,
        summary: translation.summary,
      },
    };
  });
}

/** Ordena por ano desc (sem ano ao fim), desempate estavel por titulo. */
function byYearDesc(a: HeroCandidate, b: HeroCandidate): number {
  const ay = a.year ?? Number.NEGATIVE_INFINITY;
  const by = b.year ?? Number.NEGATIVE_INFINITY;
  if (ay !== by) return by - ay;
  return (a.input.title ?? "").localeCompare(b.input.title ?? "");
}

/**
 * Monta os slides do hero-carousel: filmes (por ano desc) primeiro, depois
 * series, ate `HOME_HERO_SLIDE_LIMIT`. Resolve crew/cast so dos candidatos que
 * entram no carousel (evita N+1 no catalogo inteiro). Sem dado real -> [] e a
 * home cai para o fallback seguro (nunca o hero antigo com poster).
 */
export const getHomeHeroSlides = cache(async (): Promise<HeroSlide[]> => {
  const prisma = getPrismaClient();
  const [movies, series] = await Promise.all([
    movieCandidates(prisma),
    seriesCandidates(prisma),
  ]);
  movies.sort(byYearDesc);
  series.sort(byYearDesc);
  const selected = [...movies, ...series].slice(0, HOME_HERO_SLIDE_LIMIT);

  const inputs: HeroSlideInput[] = await Promise.all(
    selected.map(async (candidate): Promise<HeroSlideInput> => {
      const [director, cast] = await Promise.all([
        directorNameForEntity(prisma, candidate.entityType, candidate.entityId),
        getCastForEntity(prisma, candidate.entityType, candidate.entityId),
      ]);
      return {
        ...candidate.input,
        director,
        cast: cast.map((member) => member.name),
      };
    }),
  );

  return buildHeroSlides(inputs);
});
