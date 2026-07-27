/**
 * news-pages.ts - Camada de dados SERVER-ONLY das paginas publicas de noticias.
 *
 * Invariantes 3 e 4:
 *  - Le somente PostgreSQL local via @screena/db (Prisma).
 *  - Nao chama TMDB, Gemini, WordPress, MN26 ou qualquer API externa.
 *  - Nao escreve no banco; apenas monta snapshot para render.
 *
 * So promove artigo publicavel (traducao pt-BR + review publicavel + slug/titulo
 * + publishedAt + licenca clara + display permitido). Relacionados (EntityNewsLink)
 * so viram link quando o alvo movie|tv|person tem titulo publico e slug canonico.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import { SITE_URL } from "../lib/site";
import {
  buildNewsArticleView,
  buildNewsIndexView,
  evaluateArticleIndexability,
  evaluateNewsIndexIndexability,
  isNewsAttributionSatisfied,
  isPublishableArticle,
  isSufficientBody,
  NEWS_RENDERABLE_REVIEW_STATUSES,
  resolvePublishedIso,
  type NewsArticleView,
  type NewsIndexView,
  type NewsListItemInput,
  type NewsRelatedEntityInput,
  type NewsRelatedEntityType,
} from "../lib/news-presenter";
import type { IndexabilityResult } from "@screena/seo";

const LANGUAGE_CODE = "pt-BR";
const NEWS_INDEX_PATH = "/pt/noticias/";

export interface NewsIndexData {
  view: NewsIndexView;
  indexability: IndexabilityResult;
  canonicalUrl: string;
}

export interface NewsArticleData {
  view: NewsArticleView;
  indexability: IndexabilityResult;
  canonicalSlug: string;
  canonicalUrl: string;
}

function isoDate(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

function newsCanonicalUrl(slug: string): string {
  return `${SITE_URL}${NEWS_INDEX_PATH}${slug}/`;
}

export const getNewsIndexData = cache(async (): Promise<NewsIndexData> => {
  const prisma = getPrismaClient();

  const rows = await prisma.articleTranslation.findMany({
    where: {
      languageCode: LANGUAGE_CODE,
      reviewStatus: { in: [...NEWS_RENDERABLE_REVIEW_STATUSES] },
    },
    select: {
      slug: true,
      title: true,
      deck: true,
      reviewStatus: true,
      publishedAt: true,
      article: {
        select: {
          authorName: true,
          category: true,
          heroImagePath: true,
          publishedAt: true,
          readTimeMinutes: true,
          licenseStatus: true,
          displayAllowed: true,
          requiresAttribution: true,
          requiresLinkback: true,
          sourceName: true,
          sourceUrl: true,
        },
      },
    },
  });

  const items: NewsListItemInput[] = rows.map((row) => ({
    authorName: row.article.authorName,
    category: row.article.category,
    heroImagePath: row.article.heroImagePath,
    articlePublishedAtIso: isoDate(row.article.publishedAt),
    readTimeMinutes: row.article.readTimeMinutes,
    licenseStatus: String(row.article.licenseStatus),
    displayAllowed: row.article.displayAllowed,
    requiresAttribution: row.article.requiresAttribution,
    requiresLinkback: row.article.requiresLinkback,
    sourceName: row.article.sourceName,
    sourceUrl: row.article.sourceUrl,
    slug: row.slug,
    title: row.title,
    deck: row.deck,
    reviewStatus: String(row.reviewStatus),
    translationPublishedAtIso: isoDate(row.publishedAt),
  }));

  // Instante da avaliacao: mantem materia agendada (published_at futuro) fora
  // da listagem. Capturado UMA vez para que todos os cards do mesmo request
  // sejam avaliados contra o mesmo relogio.
  const view = buildNewsIndexView(items, new Date().toISOString());
  return {
    view,
    indexability: evaluateNewsIndexIndexability({ itemCount: view.totalCount }),
    canonicalUrl: `${SITE_URL}${NEWS_INDEX_PATH}`,
  };
});

export const getNewsArticleData = cache(
  async (slug: string): Promise<NewsArticleData | null> => {
    const prisma = getPrismaClient();

    const translation = await prisma.articleTranslation.findFirst({
      where: { languageCode: LANGUAGE_CODE, slug },
      select: {
        articleId: true,
        slug: true,
        title: true,
        deck: true,
        body: true,
        metaTitle: true,
        metaDescription: true,
        reviewStatus: true,
        indexStatus: true,
        publishedAt: true,
        article: {
          select: {
            authorName: true,
            category: true,
            heroImagePath: true,
            publishedAt: true,
            readTimeMinutes: true,
            aiAssisted: true,
            sourceName: true,
            sourceUrl: true,
            licenseStatus: true,
            displayAllowed: true,
            requiresAttribution: true,
            requiresLinkback: true,
          },
        },
      },
    });
    if (translation === null) return null;

    const publishedIso = resolvePublishedIso(
      isoDate(translation.publishedAt),
      isoDate(translation.article.publishedAt),
    );
    const reviewStatus = String(translation.reviewStatus);
    if (
      !isPublishableArticle(
        {
          reviewStatus,
          licenseStatus: String(translation.article.licenseStatus),
          displayAllowed: translation.article.displayAllowed,
          slug: translation.slug,
          title: translation.title,
          publishedAtIso: publishedIso,
        },
        new Date().toISOString(),
      ) ||
      !isNewsAttributionSatisfied({
        requiresAttribution: translation.article.requiresAttribution,
        requiresLinkback: translation.article.requiresLinkback,
        sourceName: translation.article.sourceName,
        sourceUrl: translation.article.sourceUrl,
      })
    ) {
      // Nao publicavel (rascunho, agendada para o futuro, licenca/display/
      // atribuicao bloqueados) -> 404.
      return null;
    }

    const related = await resolveRelated(prisma, translation.articleId);

    const view = buildNewsArticleView({
      facts: {
        authorName: translation.article.authorName,
        category: translation.article.category,
        heroImagePath: translation.article.heroImagePath,
        articlePublishedAtIso: isoDate(translation.article.publishedAt),
        readTimeMinutes: translation.article.readTimeMinutes,
        aiAssisted: translation.article.aiAssisted,
        sourceName: translation.article.sourceName,
        sourceUrl: translation.article.sourceUrl,
        licenseStatus: String(translation.article.licenseStatus),
        displayAllowed: translation.article.displayAllowed,
        requiresAttribution: translation.article.requiresAttribution,
        requiresLinkback: translation.article.requiresLinkback,
      },
      translation: {
        slug: translation.slug,
        title: translation.title,
        deck: translation.deck,
        body: translation.body,
        metaTitle: translation.metaTitle,
        metaDescription: translation.metaDescription,
        reviewStatus,
        indexStatus: String(translation.indexStatus),
        translationPublishedAtIso: isoDate(translation.publishedAt),
      },
      related,
    });

    const indexability = evaluateArticleIndexability({
      indexStatus: String(translation.indexStatus),
      bodySufficient: isSufficientBody(translation.body),
      reviewStatusOk: true,
    });

    return {
      view,
      indexability,
      canonicalSlug: translation.slug,
      canonicalUrl: newsCanonicalUrl(translation.slug),
    };
  },
);

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Resolve os EntityNewsLink em relacionados com titulo + slug canonico reais. */
async function resolveRelated(
  prisma: PrismaClient,
  articleId: bigint,
): Promise<NewsRelatedEntityInput[]> {
  const links = await prisma.entityNewsLink.findMany({
    where: { articleId },
    select: { entityType: true, entityId: true },
  });
  if (links.length === 0) return [];

  const movieIds = new Set<bigint>();
  const tvIds = new Set<bigint>();
  const personIds = new Set<bigint>();
  for (const link of links) {
    if (link.entityType === "movie") movieIds.add(link.entityId);
    else if (link.entityType === "tv") tvIds.add(link.entityId);
    else if (link.entityType === "person") personIds.add(link.entityId);
  }

  const resolved = new Map<string, { title: string; slug: string | null }>();
  await Promise.all([
    resolveTargets(prisma, "movie", [...movieIds], resolved),
    resolveTargets(prisma, "tv", [...tvIds], resolved),
    resolveTargets(prisma, "person", [...personIds], resolved),
  ]);

  const out: NewsRelatedEntityInput[] = [];
  for (const link of links) {
    const type = link.entityType;
    if (type !== "movie" && type !== "tv" && type !== "person") continue;
    const target = resolved.get(`${type}:${link.entityId.toString()}`);
    if (target === undefined) continue;
    out.push({
      entityType: type as NewsRelatedEntityType,
      title: target.title,
      slug: target.slug,
    });
  }
  return out;
}

async function resolveTargets(
  prisma: PrismaClient,
  entityType: NewsRelatedEntityType,
  ids: bigint[],
  out: Map<string, { title: string; slug: string | null }>,
): Promise<void> {
  if (ids.length === 0) return;

  const [translations, slugs] = await Promise.all([
    prisma.entityTranslation.findMany({
      where: { entityType, entityId: { in: ids }, languageCode: LANGUAGE_CODE },
      select: { entityId: true, title: true },
    }),
    prisma.slug.findMany({
      where: { entityType, entityId: { in: ids }, languageCode: LANGUAGE_CODE, isCanonical: true },
      select: { entityId: true, slug: true },
    }),
  ]);

  const translatedTitle = new Map<string, string>();
  for (const row of translations) {
    const title = row.title?.trim();
    if (title) translatedTitle.set(row.entityId.toString(), title);
  }
  const canonicalSlug = new Map<string, string>();
  for (const row of slugs) canonicalSlug.set(row.entityId.toString(), row.slug);

  if (entityType === "movie") {
    const movies = await prisma.movie.findMany({
      where: { id: { in: ids } },
      select: { id: true, titleOriginal: true },
    });
    for (const movie of movies) {
      const key = movie.id.toString();
      out.set(`movie:${key}`, {
        title: translatedTitle.get(key) ?? movie.titleOriginal,
        slug: canonicalSlug.get(key) ?? null,
      });
    }
  } else if (entityType === "tv") {
    const shows = await prisma.tvShow.findMany({
      where: { id: { in: ids } },
      select: { id: true, nameOriginal: true },
    });
    for (const show of shows) {
      const key = show.id.toString();
      out.set(`tv:${key}`, {
        title: translatedTitle.get(key) ?? show.nameOriginal,
        slug: canonicalSlug.get(key) ?? null,
      });
    }
  } else {
    const people = await prisma.person.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    for (const person of people) {
      const key = person.id.toString();
      out.set(`person:${key}`, {
        title: translatedTitle.get(key) ?? person.name,
        slug: canonicalSlug.get(key) ?? null,
      });
    }
  }
}
