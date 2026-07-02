/**
 * articles.ts — Listagem read-only de versoes de artigo. SERVER-ONLY.
 *
 * Le apenas o PostgreSQL local via @screena/db (Prisma), SOMENTE LEITURA
 * (`count` + `findMany` com `take`/ordenacao deterministica). NUNCA escreve,
 * NUNCA publica, NUNCA chama API externa/TMDB/Gemini. A classificacao usa os
 * helpers puros de `../lib/editorial-status` (mesmos baldes do dashboard).
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  ADMIN_LIST_LIMIT,
  classifyArticle,
  type ArticleAdminStatus,
} from "../lib/editorial-status";

export interface ArticleListRow {
  id: string;
  languageCode: string;
  slug: string;
  title: string;
  reviewStatus: string;
  indexStatus: string;
  licenseStatus: string;
  displayAllowed: boolean;
  publishedAtIso: string | null;
  updatedAtIso: string | null;
  status: ArticleAdminStatus;
  issues: string[];
}

export interface ArticleListData {
  rows: ArticleListRow[];
  total: number;
  shown: number;
  limit: number;
}

function isoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

export const getArticleListData = cache(async (): Promise<ArticleListData> => {
  const prisma = getPrismaClient();

  const [total, translations] = await Promise.all([
    prisma.articleTranslation.count(),
    prisma.articleTranslation.findMany({
      take: ADMIN_LIST_LIMIT,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        languageCode: true,
        slug: true,
        title: true,
        body: true,
        reviewStatus: true,
        indexStatus: true,
        publishedAt: true,
        updatedAt: true,
        article: {
          select: {
            licenseStatus: true,
            displayAllowed: true,
            publishedAt: true,
          },
        },
      },
    }),
  ]);

  const rows: ArticleListRow[] = translations.map((row) => {
    const reviewStatus = String(row.reviewStatus);
    const indexStatus = String(row.indexStatus);
    const licenseStatus = String(row.article.licenseStatus);
    const publishedAtIso = isoOrNull(row.publishedAt) ?? isoOrNull(row.article.publishedAt);

    const classification = classifyArticle({
      reviewStatus,
      indexStatus,
      licenseStatus,
      displayAllowed: row.article.displayAllowed,
      slug: row.slug,
      title: row.title,
      publishedAtIso,
      body: row.body,
    });

    return {
      id: row.id.toString(),
      languageCode: row.languageCode,
      slug: row.slug,
      title: row.title,
      reviewStatus,
      indexStatus,
      licenseStatus,
      displayAllowed: row.article.displayAllowed,
      publishedAtIso,
      updatedAtIso: isoOrNull(row.updatedAt),
      status: classification.status,
      issues: classification.issues,
    };
  });

  return { rows, total, shown: rows.length, limit: ADMIN_LIST_LIMIT };
});
