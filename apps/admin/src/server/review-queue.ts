/**
 * review-queue.ts — Fila editorial pratica. SERVER-ONLY, SOMENTE LEITURA.
 *
 * Le apenas o PostgreSQL local via @screena/db (Prisma): `count` + `findMany`
 * limitados e com ordenacao determinista. NUNCA escreve, NUNCA publica, NUNCA
 * chama API externa/TMDB/Gemini. A prontidao de cada item vem dos helpers PUROS
 * de `../lib/public-readiness` (que espelham o app publico).
 *
 * Seccoes:
 *   1. Artigos bloqueados;
 *   2. Artigos prontos para revisao (review pendente);
 *   3. Artigos prontos para indexar (canIndex real);
 *   4. Content blocks pendentes;
 *   5. Content blocks aprovados.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  BLOCKED_REVIEW_STATUSES,
  DISPLAYABLE_LICENSE_STATUSES,
  PENDING_REVIEW_STATUSES,
  PUBLISHABLE_REVIEW_STATUSES,
} from "../lib/editorial-status";
import {
  articleReadinessLabel,
  contentBlockReadinessLabel,
  evaluateArticlePublicReadiness,
  evaluateContentBlockPublicReadiness,
  readinessBadgeVariant,
  type PublicReadiness,
  type ReadinessBadgeVariant,
} from "../lib/public-readiness";

/** Itens exibidos por seccao (bounded — nunca leitura ilimitada). */
export const REVIEW_QUEUE_SECTION_LIMIT = 20;

/** Janela de candidatos para a seccao "prontos para indexar" (corpo checado em JS). */
export const INDEX_CANDIDATE_WINDOW = 40;

const pendingReviews = [...PENDING_REVIEW_STATUSES];
const publishableReviews = [...PUBLISHABLE_REVIEW_STATUSES];
const blockedReviews = [...BLOCKED_REVIEW_STATUSES];
const displayableLicenses = [...DISPLAYABLE_LICENSE_STATUSES];

export interface QueueItem {
  id: string;
  kind: "article" | "content_block";
  label: string;
  levelLabel: string;
  badgeVariant: ReadinessBadgeVariant;
  primaryIssue: string | null;
  href: string;
}

export interface QueueSection {
  key: string;
  title: string;
  /** Total de itens exibidos nesta seccao (apos filtro de prontidao quando aplica). */
  shown: number;
  /** `true` quando ha mais itens do que a janela lida (mostra so os mais recentes). */
  capped: boolean;
  items: QueueItem[];
}

export interface ReviewQueueData {
  sections: QueueSection[];
  limit: number;
}

const ORDER = [{ updatedAt: "desc" as const }, { id: "desc" as const }];

function articleLabel(title: string | null, id: string): string {
  const trimmed = (title ?? "").trim();
  return trimmed !== "" ? trimmed : `artigo #${id}`;
}

function toArticleReadiness(row: {
  languageCode: string;
  slug: string;
  title: string;
  body: string | null;
  reviewStatus: unknown;
  indexStatus: unknown;
  publishedAt: Date | null;
  article: { licenseStatus: unknown; displayAllowed: boolean; publishedAt: Date | null };
}): PublicReadiness {
  const publishedAtIso =
    (row.publishedAt ?? row.article.publishedAt)?.toISOString() ?? null;
  return evaluateArticlePublicReadiness({
    reviewStatus: String(row.reviewStatus),
    licenseStatus: String(row.article.licenseStatus),
    displayAllowed: row.article.displayAllowed,
    slug: row.slug,
    title: row.title,
    publishedAtIso,
    bodyChars: (row.body ?? "").trim().length,
    indexStatus: String(row.indexStatus),
    languageCode: row.languageCode,
  }, new Date().toISOString());
}

export const getReviewQueueData = cache(async (): Promise<ReviewQueueData> => {
  const prisma = getPrismaClient();

  const blockedWhere = {
    OR: [
      { article: { licenseStatus: { notIn: displayableLicenses } } },
      { article: { displayAllowed: false } },
      { indexStatus: "blocked" as const },
      { reviewStatus: { in: blockedReviews } },
    ],
  };
  const indexCandidateWhere = {
    reviewStatus: { in: publishableReviews },
    indexStatus: "index" as const,
    article: { licenseStatus: { in: displayableLicenses }, displayAllowed: true },
  };

  const [
    blockedCount,
    blockedRows,
    pendingCount,
    pendingRows,
    indexCandidateCount,
    indexCandidateRows,
    blocksPendingCount,
    blocksPendingRows,
    blocksApprovedCount,
    blocksApprovedRows,
  ] = await Promise.all([
    prisma.articleTranslation.count({ where: blockedWhere }),
    prisma.articleTranslation.findMany({
      where: blockedWhere,
      take: REVIEW_QUEUE_SECTION_LIMIT,
      orderBy: ORDER,
      select: {
        id: true,
        languageCode: true,
        slug: true,
        title: true,
        body: true,
        reviewStatus: true,
        indexStatus: true,
        publishedAt: true,
        article: {
          select: { licenseStatus: true, displayAllowed: true, publishedAt: true },
        },
      },
    }),
    prisma.articleTranslation.count({ where: { reviewStatus: { in: pendingReviews } } }),
    prisma.articleTranslation.findMany({
      where: { reviewStatus: { in: pendingReviews } },
      take: REVIEW_QUEUE_SECTION_LIMIT,
      orderBy: ORDER,
      select: {
        id: true,
        languageCode: true,
        slug: true,
        title: true,
        body: true,
        reviewStatus: true,
        indexStatus: true,
        publishedAt: true,
        article: {
          select: { licenseStatus: true, displayAllowed: true, publishedAt: true },
        },
      },
    }),
    prisma.articleTranslation.count({ where: indexCandidateWhere }),
    prisma.articleTranslation.findMany({
      where: indexCandidateWhere,
      take: INDEX_CANDIDATE_WINDOW,
      orderBy: ORDER,
      select: {
        id: true,
        languageCode: true,
        slug: true,
        title: true,
        body: true,
        reviewStatus: true,
        indexStatus: true,
        publishedAt: true,
        article: {
          select: { licenseStatus: true, displayAllowed: true, publishedAt: true },
        },
      },
    }),
    prisma.contentBlock.count({ where: { reviewStatus: { in: pendingReviews } } }),
    prisma.contentBlock.findMany({
      where: { reviewStatus: { in: pendingReviews } },
      take: REVIEW_QUEUE_SECTION_LIMIT,
      orderBy: ORDER,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        languageCode: true,
        blockType: true,
        reviewStatus: true,
        content: true,
      },
    }),
    prisma.contentBlock.count({ where: { reviewStatus: { in: publishableReviews } } }),
    prisma.contentBlock.findMany({
      where: { reviewStatus: { in: publishableReviews } },
      take: REVIEW_QUEUE_SECTION_LIMIT,
      orderBy: ORDER,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        languageCode: true,
        blockType: true,
        reviewStatus: true,
        content: true,
      },
    }),
  ]);

  function articleItem(row: (typeof blockedRows)[number]): QueueItem {
    const id = row.id.toString();
    const readiness = toArticleReadiness(row);
    return {
      id,
      kind: "article",
      label: articleLabel(row.title, id),
      levelLabel: articleReadinessLabel(readiness.level),
      badgeVariant: readinessBadgeVariant(readiness.level),
      primaryIssue: readiness.primaryIssue,
      href: `/articles/${id}`,
    };
  }

  function blockItem(row: (typeof blocksPendingRows)[number]): QueueItem {
    const id = row.id.toString();
    const readiness = evaluateContentBlockPublicReadiness({
      reviewStatus: String(row.reviewStatus),
      contentChars: (row.content ?? "").length,
      languageCode: row.languageCode,
    });
    return {
      id,
      kind: "content_block",
      label: `${String(row.entityType)}:${row.entityId.toString()} · ${String(row.blockType)}`,
      levelLabel: contentBlockReadinessLabel(readiness.level),
      badgeVariant: readinessBadgeVariant(readiness.level),
      primaryIssue: readiness.primaryIssue,
      href: `/content-blocks/${id}`,
    };
  }

  // "Prontos para indexar": filtra os candidatos que realmente cumprem canIndex
  // (corpo suficiente + slug/titulo/publishedAt + pt-BR), dentro da janela lida.
  const indexReadyItems = indexCandidateRows
    .filter((row) => toArticleReadiness(row).canIndex)
    .slice(0, REVIEW_QUEUE_SECTION_LIMIT)
    .map(articleItem);

  const sections: QueueSection[] = [
    {
      key: "articles_blocked",
      title: "Artigos bloqueados",
      shown: blockedRows.length,
      capped: blockedCount > blockedRows.length,
      items: blockedRows.map(articleItem),
    },
    {
      key: "articles_pending",
      title: "Artigos prontos para revisao",
      shown: pendingRows.length,
      capped: pendingCount > pendingRows.length,
      items: pendingRows.map(articleItem),
    },
    {
      key: "articles_index_ready",
      title: "Artigos prontos para indexar",
      shown: indexReadyItems.length,
      capped: indexCandidateCount > indexCandidateRows.length,
      items: indexReadyItems,
    },
    {
      key: "blocks_pending",
      title: "Content blocks pendentes",
      shown: blocksPendingRows.length,
      capped: blocksPendingCount > blocksPendingRows.length,
      items: blocksPendingRows.map(blockItem),
    },
    {
      key: "blocks_approved",
      title: "Content blocks aprovados",
      shown: blocksApprovedRows.length,
      capped: blocksApprovedCount > blocksApprovedRows.length,
      items: blocksApprovedRows.map(blockItem),
    },
  ];

  return { sections, limit: REVIEW_QUEUE_SECTION_LIMIT };
});
