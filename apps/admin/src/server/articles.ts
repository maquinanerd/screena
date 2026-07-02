/**
 * articles.ts — Leitura de versoes de artigo (listagem + detalhe). SERVER-ONLY,
 * SOMENTE LEITURA.
 *
 * Le apenas o PostgreSQL local via @screena/db (Prisma): `count` + `findMany`
 * (listagem, com filtros validados) e `findUnique` (detalhe). NUNCA escreve, NUNCA
 * publica, NUNCA chama API externa/TMDB/Gemini — a escrita editorial vive
 * exclusivamente em `editorial-actions.ts`. A classificacao usa os helpers puros
 * de `../lib/editorial-status`; os filtros vem normalizados de
 * `../lib/editorial-filters` (so enums reais, nunca chave arbitraria).
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  ADMIN_LIST_LIMIT,
  classifyArticle,
  type ArticleAdminStatus,
} from "../lib/editorial-status";
import type { IndexStatusValue, ReviewStatusValue } from "../lib/editorial-action-policy";
import { isValidRecordId } from "../lib/editorial-action-policy";
import {
  reviewStatusesForBucket,
  type ArticleFilters,
} from "../lib/editorial-filters";

/** Origem publica canonica (para montar o link publico pt-BR). */
const PUBLIC_SITE_ORIGIN = "https://thescreen.media";

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
  /** Total que casa com o filtro aplicado (nao o total absoluto). */
  total: number;
  shown: number;
  limit: number;
}

/** Detalhe de UMA versao de artigo (para a pagina de revisao). */
export interface ArticleDetail {
  id: string;
  languageCode: string;
  slug: string;
  title: string;
  deck: string | null;
  reviewStatus: string;
  indexStatus: string;
  licenseStatus: string;
  displayAllowed: boolean;
  publishedAtIso: string | null;
  updatedAtIso: string | null;
  status: ArticleAdminStatus;
  issues: string[];
  /** Numero de caracteres do corpo (o corpo em si NAO e exibido/editado). */
  bodyChars: number;
  /** URL publica (so pt-BR/pt com slug); `null` caso contrario. */
  publicUrl: string | null;
}

/** Forma minima do `where` de artigo — so campos validados, nunca arbitrario. */
interface ArticleWhere {
  reviewStatus?: { in: ReviewStatusValue[] };
  languageCode?: string;
  indexStatus?: IndexStatusValue;
}

function isoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

/** Monta o `where` do Prisma a partir dos filtros normalizados (campo-a-campo). */
function buildArticleWhere(filters: ArticleFilters): ArticleWhere {
  const where: ArticleWhere = {};
  if (filters.statusBucket !== null) {
    where.reviewStatus = { in: [...reviewStatusesForBucket(filters.statusBucket)] };
  }
  if (filters.language !== null) where.languageCode = filters.language;
  if (filters.indexStatus !== null) where.indexStatus = filters.indexStatus;
  return where;
}

/** Link publico pt-BR (`/pt/noticias/{slug}`); `null` para outros idiomas/sem slug. */
function publicArticleUrl(languageCode: string, slug: string): string | null {
  const isPt = languageCode === "pt-BR" || languageCode === "pt";
  const trimmed = slug.trim();
  return isPt && trimmed !== "" ? `${PUBLIC_SITE_ORIGIN}/pt/noticias/${trimmed}` : null;
}

export const getArticleListData = cache(
  async (filters: ArticleFilters): Promise<ArticleListData> => {
    const prisma = getPrismaClient();
    const where = buildArticleWhere(filters);

    const [total, translations] = await Promise.all([
      prisma.articleTranslation.count({ where }),
      prisma.articleTranslation.findMany({
        where,
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
  },
);

/**
 * Detalhe de UMA versao de artigo por id. Retorna `null` se o id for invalido ou
 * o registro nao existir. SOMENTE LEITURA (`findUnique`).
 */
export const getArticleDetail = cache(async (id: string): Promise<ArticleDetail | null> => {
  if (!isValidRecordId(id)) return null;
  const prisma = getPrismaClient();

  const row = await prisma.articleTranslation.findUnique({
    where: { id: BigInt(id) },
    select: {
      id: true,
      languageCode: true,
      slug: true,
      title: true,
      deck: true,
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
  });

  if (row === null) return null;

  const reviewStatus = String(row.reviewStatus);
  const indexStatus = String(row.indexStatus);
  const licenseStatus = String(row.article.licenseStatus);
  const publishedAtIso = isoOrNull(row.publishedAt) ?? isoOrNull(row.article.publishedAt);
  const body = row.body ?? "";

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
    deck: row.deck,
    reviewStatus,
    indexStatus,
    licenseStatus,
    displayAllowed: row.article.displayAllowed,
    publishedAtIso,
    updatedAtIso: isoOrNull(row.updatedAt),
    status: classification.status,
    issues: classification.issues,
    bodyChars: body.trim().length,
    publicUrl: publicArticleUrl(row.languageCode, row.slug),
  };
});
