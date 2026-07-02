/**
 * sitemap-entries.ts — Camada de dados SERVER-ONLY do sitemap publico.
 *
 * Invariantes 3 e 4:
 *  - Le somente PostgreSQL local via @screena/db (Prisma).
 *  - Nao chama TMDB, Gemini, WordPress, MN26, RSSPRIME ou qualquer API externa.
 *  - Nao escreve no banco; apenas monta o snapshot para o presenter puro
 *    `src/lib/sitemap-presenter` decidir o que entra (mesmos gates das paginas).
 *
 * Comportamento sem banco (documentado e testado no presenter): o build local
 * roda sem DATABASE_URL e a rota do sitemap e dinamica; se ainda assim o
 * PostgreSQL estiver indisponivel no request, cai para as rotas estaticas
 * publicas via `buildStaticSitemapEntries()` com log explicito do erro —
 * nada de engolir falha silenciosamente, e o meta robots por pagina segue
 * sendo a fonte de verdade para o crawler.
 */

import { getPrismaClient } from "@screena/db/server";

import {
  buildSitemapEntries,
  buildStaticSitemapEntries,
  type SitemapDataInput,
  type SitemapEntityCandidate,
  type SitemapEntryView,
  type SitemapNewsCandidate,
} from "../../lib/sitemap-presenter";
import { RENDERABLE_REVIEW_STATUSES } from "../../lib/movie-indexability";
import { NEWS_RENDERABLE_REVIEW_STATUSES } from "../../lib/news-presenter";

const LANGUAGE_CODE = "pt-BR";

type EntityType = "movie" | "tv" | "person";

type PrismaClient = ReturnType<typeof getPrismaClient>;

function isoOrNull(date: Date | null | undefined): string | null {
  return date == null ? null : date.toISOString();
}

/** Slugs canonicos pt-BR de um tipo, por entityId (string). */
async function canonicalSlugs(
  prisma: PrismaClient,
  entityType: EntityType,
): Promise<Map<string, string>> {
  const rows = await prisma.slug.findMany({
    where: { entityType, languageCode: LANGUAGE_CODE, isCanonical: true },
    select: { entityId: true, slug: true },
  });
  const out = new Map<string, string>();
  for (const row of rows) out.set(row.entityId.toString(), row.slug);
  return out;
}

/** Titulos traduzidos pt-BR de um tipo, por entityId (string). */
async function translatedTitles(
  prisma: PrismaClient,
  entityType: EntityType,
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

/** Contagem de content_blocks publicaveis pt-BR de um tipo, por entityId. */
async function renderableBlockCounts(
  prisma: PrismaClient,
  entityType: EntityType,
  ids: bigint[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.contentBlock.groupBy({
    by: ["entityId"],
    where: {
      entityType,
      entityId: { in: ids },
      languageCode: LANGUAGE_CODE,
      reviewStatus: { in: [...RENDERABLE_REVIEW_STATUSES] },
    },
    _count: { _all: true },
  });
  const out = new Map<string, number>();
  for (const row of rows) out.set(row.entityId.toString(), row._count._all);
  return out;
}

interface EntityRecordFacts {
  id: bigint;
  title: string | null;
  updatedAt: Date;
}

function toCandidates(
  records: EntityRecordFacts[],
  slugByEntity: Map<string, string>,
  titleByEntity: Map<string, string | null>,
  blockCountByEntity: Map<string, number>,
): SitemapEntityCandidate[] {
  return records.map((record) => {
    const key = record.id.toString();
    return {
      slug: slugByEntity.get(key) ?? null,
      title: titleByEntity.get(key) ?? record.title,
      renderableBlockCount: blockCountByEntity.get(key) ?? 0,
      updatedAtIso: isoOrNull(record.updatedAt),
    };
  });
}

async function movieCandidates(
  prisma: PrismaClient,
): Promise<SitemapEntityCandidate[]> {
  const slugByEntity = await canonicalSlugs(prisma, "movie");
  const ids = [...slugByEntity.keys()].map((key) => BigInt(key));
  if (ids.length === 0) return [];
  const [movies, titles, blocks] = await Promise.all([
    prisma.movie.findMany({
      where: { id: { in: ids } },
      select: { id: true, titleOriginal: true, updatedAt: true },
    }),
    translatedTitles(prisma, "movie", ids),
    renderableBlockCounts(prisma, "movie", ids),
  ]);
  return toCandidates(
    movies.map((movie) => ({
      id: movie.id,
      title: movie.titleOriginal,
      updatedAt: movie.updatedAt,
    })),
    slugByEntity,
    titles,
    blocks,
  );
}

async function seriesCandidates(
  prisma: PrismaClient,
): Promise<SitemapEntityCandidate[]> {
  const slugByEntity = await canonicalSlugs(prisma, "tv");
  const ids = [...slugByEntity.keys()].map((key) => BigInt(key));
  if (ids.length === 0) return [];
  const [shows, titles, blocks] = await Promise.all([
    prisma.tvShow.findMany({
      where: { id: { in: ids } },
      select: { id: true, nameOriginal: true, updatedAt: true },
    }),
    translatedTitles(prisma, "tv", ids),
    renderableBlockCounts(prisma, "tv", ids),
  ]);
  return toCandidates(
    shows.map((show) => ({
      id: show.id,
      title: show.nameOriginal,
      updatedAt: show.updatedAt,
    })),
    slugByEntity,
    titles,
    blocks,
  );
}

async function personCandidates(
  prisma: PrismaClient,
): Promise<SitemapEntityCandidate[]> {
  const slugByEntity = await canonicalSlugs(prisma, "person");
  const ids = [...slugByEntity.keys()].map((key) => BigInt(key));
  if (ids.length === 0) return [];
  const [people, titles, blocks] = await Promise.all([
    prisma.person.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, updatedAt: true },
    }),
    translatedTitles(prisma, "person", ids),
    renderableBlockCounts(prisma, "person", ids),
  ]);
  return toCandidates(
    people.map((person) => ({
      id: person.id,
      title: person.name,
      updatedAt: person.updatedAt,
    })),
    slugByEntity,
    titles,
    blocks,
  );
}

async function newsCandidates(
  prisma: PrismaClient,
): Promise<SitemapNewsCandidate[]> {
  const rows = await prisma.articleTranslation.findMany({
    where: {
      languageCode: LANGUAGE_CODE,
      reviewStatus: { in: [...NEWS_RENDERABLE_REVIEW_STATUSES] },
    },
    select: {
      slug: true,
      title: true,
      body: true,
      reviewStatus: true,
      indexStatus: true,
      publishedAt: true,
      updatedAt: true,
      article: {
        select: {
          publishedAt: true,
          licenseStatus: true,
          displayAllowed: true,
        },
      },
    },
  });
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    reviewStatus: String(row.reviewStatus),
    licenseStatus: String(row.article.licenseStatus),
    displayAllowed: row.article.displayAllowed,
    indexStatus: String(row.indexStatus),
    body: row.body,
    translationPublishedAtIso: isoOrNull(row.publishedAt),
    articlePublishedAtIso: isoOrNull(row.article.publishedAt),
    updatedAtIso: isoOrNull(row.updatedAt),
  }));
}

/**
 * Le o snapshot do banco e monta as entradas do sitemap pelos gates puros.
 * Com PostgreSQL indisponivel, loga o erro e devolve apenas rotas estaticas.
 */
export async function getSitemapEntries(): Promise<SitemapEntryView[]> {
  try {
    const prisma = getPrismaClient();
    const [movies, series, people, news] = await Promise.all([
      movieCandidates(prisma),
      seriesCandidates(prisma),
      personCandidates(prisma),
      newsCandidates(prisma),
    ]);
    const input: SitemapDataInput = { movies, series, people, news };
    return buildSitemapEntries(input);
  } catch (error) {
    // Falha de banco nao pode derrubar o sitemap inteiro; o fallback estatico
    // e explicito e logado (nunca mascarado como sucesso completo).
    console.error("[sitemap] PostgreSQL indisponivel; usando fallback estatico:", error);
    return buildStaticSitemapEntries();
  }
}
