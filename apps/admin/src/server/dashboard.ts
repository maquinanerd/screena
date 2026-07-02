/**
 * dashboard.ts — Contagens do dashboard editorial. SERVER-ONLY, SOMENTE LEITURA.
 *
 * Le apenas o PostgreSQL local via @screena/db (Prisma) com `count`/`groupBy`
 * (agregacoes — nao transfere linhas). NUNCA escreve, NUNCA publica, NUNCA chama
 * API externa/TMDB/Gemini. Os numeros sao REAIS (contagem do banco); banco vazio
 * -> zeros, sem inventar dado.
 *
 * As faixas de bucket derivam das MESMAS constantes puras de
 * `../lib/editorial-status`, entao o dashboard, a listagem e os testes nao
 * divergem.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  BLOCKED_REVIEW_STATUSES,
  DISPLAYABLE_LICENSE_STATUSES,
  PUBLISHABLE_REVIEW_STATUSES,
  aggregateContentBlockGroups,
  type ArticleCounts,
  type ContentBlockCounts,
} from "../lib/editorial-status";

export interface DashboardData {
  /** Registros de artigo (fatos, independentes de idioma). */
  articleRecords: number;
  /** Versoes de artigo por idioma (article_translations), particionadas. */
  articles: ArticleCounts;
  /** content_blocks particionados por review_status. */
  contentBlocks: ContentBlockCounts;
}

// Derivado das constantes puras (single source of truth com a classificacao).
const displayableLicenses = [...DISPLAYABLE_LICENSE_STATUSES];
const blockedReviews = [...BLOCKED_REVIEW_STATUSES];
const publishableReviews = [...PUBLISHABLE_REVIEW_STATUSES];

export const getDashboardData = cache(async (): Promise<DashboardData> => {
  const prisma = getPrismaClient();

  const [articleRecords, total, blocked, publishable, blockGroups] = await Promise.all([
    prisma.article.count(),
    prisma.articleTranslation.count(),
    // BLOQUEADA: licenca nao exibivel, display negado, index=blocked ou review travada.
    prisma.articleTranslation.count({
      where: {
        OR: [
          { article: { licenseStatus: { notIn: displayableLicenses } } },
          { article: { displayAllowed: false } },
          { indexStatus: "blocked" },
          { reviewStatus: { in: blockedReviews } },
        ],
      },
    }),
    // PUBLICAVEL: review apto + index=index + licenca exibivel + display permitido.
    prisma.articleTranslation.count({
      where: {
        reviewStatus: { in: publishableReviews },
        indexStatus: "index",
        article: { licenseStatus: { in: displayableLicenses }, displayAllowed: true },
      },
    }),
    prisma.contentBlock.groupBy({ by: ["reviewStatus"], _count: { _all: true } }),
  ]);

  const noindex = Math.max(0, total - blocked - publishable);

  const contentBlocks: ContentBlockCounts = aggregateContentBlockGroups(
    blockGroups.map((group: { reviewStatus: unknown; _count: { _all: number } }) => ({
      reviewStatus: String(group.reviewStatus),
      count: group._count._all,
    })),
  );

  return {
    articleRecords,
    articles: { total, publishable, noindex, blocked },
    contentBlocks,
  };
});
