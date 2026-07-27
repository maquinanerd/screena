/**
 * editorial-workflow.ts — Visao operacional do trabalho editorial. SERVER-ONLY,
 * SOMENTE LEITURA.
 *
 * Le apenas o PostgreSQL local via @screena/db (Prisma): `count` + `findMany`
 * limitados e com ordenacao determinista. NUNCA escreve, NUNCA publica, NUNCA
 * chama API externa. A prontidao vem dos helpers PUROS de `../lib/public-readiness`
 * (que espelham o app publico). As ACOES em lote sao delegadas as Server Actions
 * allowlisted (`editorial-actions.ts`) — este helper so monta o read model.
 *
 * Baldes:
 *   - "Revisar agora": artigos com review pendente         -> bulk review_status;
 *   - "Prontos para indexar": exibiveis, corpo ok, index!=index -> bulk index_status;
 *   - "Visiveis, mas noindex": exibiveis, corpo insuficiente    -> read-only (precisa corpo);
 *   - "Blocos pendentes": content blocks com review pendente -> bulk review_status;
 *   - "Blocos aprovados": content blocks publicaveis          -> read-only.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  DISPLAYABLE_LICENSE_STATUSES,
  PENDING_REVIEW_STATUSES,
  PUBLISHABLE_REVIEW_STATUSES,
} from "../lib/editorial-status";
import { INDEX_DECISIONS, REVIEW_STATUSES } from "../lib/editorial-action-policy";
import {
  articleReadinessLabel,
  contentBlockReadinessLabel,
  evaluateArticlePublicReadiness,
  evaluateContentBlockPublicReadiness,
  readinessBadgeVariant,
  type ReadinessBadgeVariant,
} from "../lib/public-readiness";

/** Itens exibidos por seccao (bounded). */
export const WORKFLOW_SECTION_LIMIT = 15;
/** Janela de candidatos exibiveis lida para bucketizar por prontidao. */
const DISPLAY_CANDIDATE_WINDOW = 60;

const pendingReviews = [...PENDING_REVIEW_STATUSES];
const publishableReviews = [...PUBLISHABLE_REVIEW_STATUSES];
const displayableLicenses = [...DISPLAYABLE_LICENSE_STATUSES];

export interface WorkflowItem {
  id: string;
  kind: "article" | "content_block";
  label: string;
  statusLabel: string;
  badgeVariant: ReadinessBadgeVariant;
  primaryIssue: string | null;
  href: string;
}

/** Config de acao em lote de uma seccao (null = seccao read-only). */
export interface WorkflowBulkConfig {
  model: "article" | "contentBlock";
  field: "reviewStatus" | "indexStatus";
  valueOptions: readonly string[];
  suggestedValue: string;
}

export interface WorkflowSection {
  key: string;
  title: string;
  description: string;
  items: WorkflowItem[];
  shown: number;
  capped: boolean;
  /** Config de lote, ou null quando a seccao e read-only. */
  bulk: WorkflowBulkConfig | null;
}

export interface WorkflowData {
  sections: WorkflowSection[];
  limit: number;
}

const ORDER = [{ updatedAt: "desc" as const }, { id: "desc" as const }];

function articleLabel(title: string, id: string): string {
  const trimmed = title.trim();
  return trimmed !== "" ? trimmed : `artigo #${id}`;
}

type ArticleRow = {
  id: bigint;
  languageCode: string;
  slug: string;
  title: string;
  body: string | null;
  reviewStatus: unknown;
  indexStatus: unknown;
  publishedAt: Date | null;
  article: { licenseStatus: unknown; displayAllowed: boolean; publishedAt: Date | null };
};

function readinessOf(row: ArticleRow): ReturnType<typeof evaluateArticlePublicReadiness> {
  const publishedAtIso = (row.publishedAt ?? row.article.publishedAt)?.toISOString() ?? null;
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

function articleItem(row: ArticleRow): WorkflowItem {
  const id = row.id.toString();
  const readiness = readinessOf(row);
  return {
    id,
    kind: "article",
    label: articleLabel(row.title, id),
    statusLabel: articleReadinessLabel(readiness.level),
    badgeVariant: readinessBadgeVariant(readiness.level),
    primaryIssue: readiness.primaryIssue,
    href: `/articles/${id}`,
  };
}

export const getEditorialWorkflowData = cache(async (): Promise<WorkflowData> => {
  const prisma = getPrismaClient();

  // Candidatos exibiveis (publicaveis pt-BR com licenca/display) para bucketizar.
  const displayCandidateWhere = {
    reviewStatus: { in: publishableReviews },
    languageCode: "pt-BR",
    article: { licenseStatus: { in: displayableLicenses }, displayAllowed: true },
  };

  const [
    needsReviewRows,
    needsReviewCount,
    displayCandidateRows,
    displayCandidateCount,
    blocksPendingRows,
    blocksPendingCount,
    blocksApprovedRows,
    blocksApprovedCount,
  ] = await Promise.all([
    prisma.articleTranslation.findMany({
      where: { reviewStatus: { in: pendingReviews } },
      take: WORKFLOW_SECTION_LIMIT,
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
        article: { select: { licenseStatus: true, displayAllowed: true, publishedAt: true } },
      },
    }),
    prisma.articleTranslation.count({ where: { reviewStatus: { in: pendingReviews } } }),
    prisma.articleTranslation.findMany({
      where: displayCandidateWhere,
      take: DISPLAY_CANDIDATE_WINDOW,
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
        article: { select: { licenseStatus: true, displayAllowed: true, publishedAt: true } },
      },
    }),
    prisma.articleTranslation.count({ where: displayCandidateWhere }),
    prisma.contentBlock.findMany({
      where: { reviewStatus: { in: pendingReviews } },
      take: WORKFLOW_SECTION_LIMIT,
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
    prisma.contentBlock.count({ where: { reviewStatus: { in: pendingReviews } } }),
    prisma.contentBlock.findMany({
      where: { reviewStatus: { in: publishableReviews } },
      take: WORKFLOW_SECTION_LIMIT,
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
  ]);

  // Bucketiza os candidatos exibiveis pela prontidao real (corpo checado em JS).
  const readyToIndex: WorkflowItem[] = [];
  const visibleNoindex: WorkflowItem[] = [];
  for (const row of displayCandidateRows) {
    const readiness = readinessOf(row);
    if (!readiness.canDisplay) continue; // ex.: sem publishedAt -> nao exibivel
    if (readiness.canIndex) continue; // ja indexavel (index_status=index + corpo ok)
    const bodyOk = (row.body ?? "").trim().length >= 200;
    const item = articleItem(row);
    if (bodyOk) readyToIndex.push(item);
    else visibleNoindex.push(item);
  }

  function blockItem(row: (typeof blocksPendingRows)[number]): WorkflowItem {
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
      statusLabel: contentBlockReadinessLabel(readiness.level),
      badgeVariant: readinessBadgeVariant(readiness.level),
      primaryIssue: readiness.primaryIssue,
      href: `/content-blocks/${id}`,
    };
  }

  const sections: WorkflowSection[] = [
    {
      key: "needs_review",
      title: "Revisar agora",
      description: "Artigos com review pendente. Marque em lote como revisado.",
      items: needsReviewRows.map(articleItem),
      shown: needsReviewRows.length,
      capped: needsReviewCount > needsReviewRows.length,
      bulk: {
        model: "article",
        field: "reviewStatus",
        valueOptions: REVIEW_STATUSES,
        suggestedValue: "human_reviewed",
      },
    },
    {
      key: "ready_to_index",
      title: "Prontos para indexar",
      description: "Exibiveis com corpo suficiente, mas index_status != index.",
      items: readyToIndex.slice(0, WORKFLOW_SECTION_LIMIT),
      shown: Math.min(readyToIndex.length, WORKFLOW_SECTION_LIMIT),
      capped: displayCandidateCount > displayCandidateRows.length,
      bulk: {
        model: "article",
        field: "indexStatus",
        valueOptions: INDEX_DECISIONS,
        suggestedValue: "index",
      },
    },
    {
      key: "visible_noindex",
      title: "Visiveis, mas noindex",
      description: "Exibiveis, mas com corpo insuficiente — precisam de corpo, nao de lote.",
      items: visibleNoindex.slice(0, WORKFLOW_SECTION_LIMIT),
      shown: Math.min(visibleNoindex.length, WORKFLOW_SECTION_LIMIT),
      capped: displayCandidateCount > displayCandidateRows.length,
      bulk: null,
    },
    {
      key: "blocks_pending",
      title: "Blocos pendentes",
      description: "Content blocks com review pendente. Marque em lote.",
      items: blocksPendingRows.map(blockItem),
      shown: blocksPendingRows.length,
      capped: blocksPendingCount > blocksPendingRows.length,
      bulk: {
        model: "contentBlock",
        field: "reviewStatus",
        valueOptions: REVIEW_STATUSES,
        suggestedValue: "human_reviewed",
      },
    },
    {
      key: "blocks_approved",
      title: "Blocos aprovados",
      description: "Content blocks ja publicaveis (referencia).",
      items: blocksApprovedRows.map(blockItem),
      shown: blocksApprovedRows.length,
      capped: blocksApprovedCount > blocksApprovedRows.length,
      bulk: null,
    },
  ];

  return { sections, limit: WORKFLOW_SECTION_LIMIT };
});
