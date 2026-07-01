/**
 * related-news.ts - Helper SERVER-ONLY: dado uma entidade (filme|serie|pessoa),
 * traz as noticias relacionadas publicaveis via `EntityNewsLink`.
 *
 * Invariantes 3 e 4:
 *  - Le somente PostgreSQL local via @screena/db (Prisma).
 *  - Nao chama TMDB, Gemini, WordPress, MN26 ou qualquer API externa.
 *  - Read-only.
 *
 * Direcao inversa da pagina de noticia: aqui partimos da entidade para os artigos
 * (EntityNewsLink.entity_type + entity_id), aplicando o MESMO gate de publicacao
 * das paginas de noticias (traducao pt-BR + review + slug/titulo + publishedAt +
 * licenca/display), reusando `buildNewsCard` no presenter.
 */

import { getPrismaClient } from "@screena/db/server";

import {
  NEWS_RENDERABLE_REVIEW_STATUSES,
  type NewsCardView,
  type NewsListItemInput,
} from "../lib/news-presenter";
import { buildRelatedNewsCards } from "../lib/related-news-presenter";

const LANGUAGE_CODE = "pt-BR";

/** Entidades que podem ter noticias relacionadas (subset de EntityType). */
export type RelatedNewsEntityType = "movie" | "tv" | "person";

type PrismaClient = ReturnType<typeof getPrismaClient>;

function isoDate(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

/**
 * Retorna os cards de noticias relacionadas (ja publicaveis, ordenados e
 * limitados) de uma entidade. Sem vinculos ou sem artigo publicavel -> [].
 */
export async function getRelatedNewsForEntity(
  prisma: PrismaClient,
  entityType: RelatedNewsEntityType,
  entityId: bigint,
): Promise<NewsCardView[]> {
  const links = await prisma.entityNewsLink.findMany({
    where: { entityType, entityId },
    select: { articleId: true },
  });
  if (links.length === 0) return [];

  const articleIds = [...new Set(links.map((link) => link.articleId.toString()))].map(
    (id) => BigInt(id),
  );

  const rows = await prisma.articleTranslation.findMany({
    where: {
      articleId: { in: articleIds },
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
    slug: row.slug,
    title: row.title,
    deck: row.deck,
    reviewStatus: String(row.reviewStatus),
    translationPublishedAtIso: isoDate(row.publishedAt),
  }));

  return buildRelatedNewsCards(items);
}
