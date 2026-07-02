/**
 * content-blocks.ts — Listagem read-only de content_blocks. SERVER-ONLY.
 *
 * Le apenas o PostgreSQL local via @screena/db (Prisma), SOMENTE LEITURA
 * (`count` + `findMany` com `take`/ordenacao deterministica). NUNCA escreve,
 * NUNCA publica, NUNCA chama API externa/TMDB/Gemini. A classificacao usa o
 * helper puro `classifyContentBlock`.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  ADMIN_LIST_LIMIT,
  classifyContentBlock,
  type ContentBlockAdminStatus,
} from "../lib/editorial-status";

export interface ContentBlockListRow {
  id: string;
  entityType: string;
  entityId: string;
  languageCode: string;
  blockType: string;
  reviewStatus: string;
  updatedAtIso: string | null;
  status: ContentBlockAdminStatus;
}

export interface ContentBlockListData {
  rows: ContentBlockListRow[];
  total: number;
  shown: number;
  limit: number;
}

function isoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

export const getContentBlockListData = cache(async (): Promise<ContentBlockListData> => {
  const prisma = getPrismaClient();

  const [total, blocks] = await Promise.all([
    prisma.contentBlock.count(),
    prisma.contentBlock.findMany({
      take: ADMIN_LIST_LIMIT,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        entityType: true,
        entityId: true,
        languageCode: true,
        blockType: true,
        reviewStatus: true,
        updatedAt: true,
      },
    }),
  ]);

  const rows: ContentBlockListRow[] = blocks.map((row) => {
    const reviewStatus = String(row.reviewStatus);
    return {
      id: row.id.toString(),
      entityType: String(row.entityType),
      entityId: row.entityId.toString(),
      languageCode: row.languageCode,
      blockType: String(row.blockType),
      reviewStatus,
      updatedAtIso: isoOrNull(row.updatedAt),
      status: classifyContentBlock(reviewStatus),
    };
  });

  return { rows, total, shown: rows.length, limit: ADMIN_LIST_LIMIT };
});
