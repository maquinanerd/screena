/**
 * content-blocks.ts — Leitura de content_blocks (listagem + detalhe). SERVER-ONLY,
 * SOMENTE LEITURA.
 *
 * Le apenas o PostgreSQL local via @screena/db (Prisma): `count` + `findMany`
 * (listagem filtrada) e `findUnique` (detalhe, com preview curto e seguro do
 * conteudo proprio). NUNCA escreve, NUNCA publica, NUNCA chama API externa/TMDB/
 * Gemini — a escrita editorial vive so em `editorial-actions.ts`. Filtros vem
 * normalizados de `../lib/editorial-filters` (so enums reais).
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  ADMIN_LIST_LIMIT,
  classifyContentBlock,
  type ContentBlockAdminStatus,
} from "../lib/editorial-status";
import type { ReviewStatusValue } from "../lib/editorial-action-policy";
import { isValidRecordId } from "../lib/editorial-action-policy";
import {
  reviewStatusesForBucket,
  type ContentBlockFilters,
  type ContentBlockTypeValue,
  type EntityTypeValue,
} from "../lib/editorial-filters";

/** Tamanho maximo do preview textual do bloco (conteudo proprio, seguro). */
const PREVIEW_MAX_CHARS = 240;

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
  /** Total que casa com o filtro aplicado. */
  total: number;
  shown: number;
  limit: number;
}

/** Detalhe de UM content_block (para a pagina de revisao). */
export interface ContentBlockDetail {
  id: string;
  entityType: string;
  entityId: string;
  languageCode: string;
  blockType: string;
  reviewStatus: string;
  updatedAtIso: string | null;
  status: ContentBlockAdminStatus;
  /** Preview curto do conteudo proprio (nunca editado aqui). */
  preview: string;
  /** Tamanho total do conteudo em caracteres. */
  contentChars: number;
}

/** Forma minima do `where` — so campos validados, nunca arbitrario. */
interface ContentBlockWhere {
  reviewStatus?: { in: ReviewStatusValue[] };
  languageCode?: string;
  entityType?: EntityTypeValue;
  blockType?: ContentBlockTypeValue;
}

function isoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

/** Colapsa espacos e corta em `PREVIEW_MAX_CHARS` (com reticencias se cortou). */
function previewOf(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (collapsed.length <= PREVIEW_MAX_CHARS) return collapsed;
  return `${collapsed.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…`;
}

/** Monta o `where` do Prisma a partir dos filtros normalizados (campo-a-campo). */
function buildContentBlockWhere(filters: ContentBlockFilters): ContentBlockWhere {
  const where: ContentBlockWhere = {};
  if (filters.statusBucket !== null) {
    where.reviewStatus = { in: [...reviewStatusesForBucket(filters.statusBucket)] };
  }
  if (filters.language !== null) where.languageCode = filters.language;
  if (filters.entityType !== null) where.entityType = filters.entityType;
  if (filters.blockType !== null) where.blockType = filters.blockType;
  return where;
}

export const getContentBlockListData = cache(
  async (filters: ContentBlockFilters): Promise<ContentBlockListData> => {
    const prisma = getPrismaClient();
    const where = buildContentBlockWhere(filters);

    const [total, blocks] = await Promise.all([
      prisma.contentBlock.count({ where }),
      prisma.contentBlock.findMany({
        where,
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
  },
);

/**
 * Detalhe de UM content_block por id. Retorna `null` se o id for invalido ou o
 * registro nao existir. SOMENTE LEITURA (`findUnique`).
 */
export const getContentBlockDetail = cache(
  async (id: string): Promise<ContentBlockDetail | null> => {
    if (!isValidRecordId(id)) return null;
    const prisma = getPrismaClient();

    const row = await prisma.contentBlock.findUnique({
      where: { id: BigInt(id) },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        languageCode: true,
        blockType: true,
        reviewStatus: true,
        content: true,
        updatedAt: true,
      },
    });

    if (row === null) return null;

    const reviewStatus = String(row.reviewStatus);
    const content = row.content ?? "";

    return {
      id: row.id.toString(),
      entityType: String(row.entityType),
      entityId: row.entityId.toString(),
      languageCode: row.languageCode,
      blockType: String(row.blockType),
      reviewStatus,
      updatedAtIso: isoOrNull(row.updatedAt),
      status: classifyContentBlock(reviewStatus),
      preview: previewOf(content),
      contentChars: content.length,
    };
  },
);
