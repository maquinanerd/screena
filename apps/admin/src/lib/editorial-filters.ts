/**
 * editorial-filters.ts — Parse PURO de filtros de listagem (search params).
 *
 * Sem rede, sem DB, sem IO: recebe os `searchParams` crus (Record de string/array)
 * e devolve um objeto de filtro NORMALIZADO, contendo apenas primitivos/uniao de
 * enums reais. A camada server-only mapeia esse objeto para um `where` do Prisma
 * campo-a-campo — NUNCA repassa chaves arbitrarias nem JSON livre. Valor de filtro
 * desconhecido e simplesmente ignorado (vira "sem filtro"), nunca vira query bruta.
 *
 * Os "baldes" de status reusam as constantes de revisao ja confiaveis de
 * `editorial-status.ts` (single source of truth), entao dashboard, filtro e
 * classificacao nunca divergem.
 */

import {
  BLOCKED_REVIEW_STATUSES,
  PENDING_REVIEW_STATUSES,
  PUBLISHABLE_REVIEW_STATUSES,
} from "./editorial-status";
import {
  INDEX_DECISIONS,
  type IndexStatusValue,
  type ReviewStatusValue,
} from "./editorial-action-policy";

/* ------------------------------------------------------------------ */
/* Enums de filtro (espelham packages/db/prisma/schema.prisma)         */
/* ------------------------------------------------------------------ */

/** EntityType (enum do schema) — usado no filtro de content_blocks. */
export const ENTITY_TYPES = ["movie", "tv", "season", "episode", "person"] as const;
export type EntityTypeValue = (typeof ENTITY_TYPES)[number];

/** ContentBlockType (enum do schema) — filtro opcional de content_blocks. */
export const CONTENT_BLOCK_TYPES = [
  "editorial_intro",
  "summary_without_spoilers",
  "ratings_explanation",
  "where_to_watch_text",
  "cast_intro",
  "similar_titles_intro",
  "franchise_context",
  "season_guide",
  "episode_context",
  "faq",
  "news_context",
  "review_summary",
] as const;
export type ContentBlockTypeValue = (typeof CONTENT_BLOCK_TYPES)[number];

/**
 * Idiomas aceitos como filtro (BCP-47 do projeto). Allowlist fechado para evitar
 * valor arbitrario virar `languageCode` no `where`.
 */
export const FILTER_LANGUAGES = ["pt-BR", "pt", "en", "es"] as const;
export type FilterLanguage = (typeof FILTER_LANGUAGES)[number];

/**
 * Balde de status de revisao para o filtro `?status=`. `pending`/`approved`/
 * `blocked` mapeiam para os conjuntos reais de `ReviewStatus`.
 */
export const REVIEW_BUCKETS = ["pending", "approved", "blocked"] as const;
export type ReviewBucket = (typeof REVIEW_BUCKETS)[number];

/** Valor cru de search param: string, lista de strings ou ausente. */
export type RawParamValue = string | string[] | undefined;
/** Formato dos `searchParams` do App Router. */
export type RawSearchParams = Record<string, RawParamValue>;

/* ------------------------------------------------------------------ */
/* Helpers puros                                                       */
/* ------------------------------------------------------------------ */

/** Primeiro valor de um search param (string) ou `undefined`. */
export function firstValue(value: RawParamValue): string | undefined {
  if (Array.isArray(value)) return value.length > 0 ? value[0] : undefined;
  return value;
}

function isMember<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** `pending|approved|blocked` ou `null`. */
export function parseReviewBucket(value: RawParamValue): ReviewBucket | null {
  const v = firstValue(value);
  return isMember(REVIEW_BUCKETS, v) ? v : null;
}

/** Conjunto de `ReviewStatus` reais correspondente a um balde. */
export function reviewStatusesForBucket(bucket: ReviewBucket): readonly ReviewStatusValue[] {
  switch (bucket) {
    case "pending":
      return PENDING_REVIEW_STATUSES;
    case "approved":
      return PUBLISHABLE_REVIEW_STATUSES;
    case "blocked":
      return BLOCKED_REVIEW_STATUSES;
  }
}

/** Idioma do allowlist ou `null`. */
export function parseLanguageFilter(value: RawParamValue): FilterLanguage | null {
  const v = firstValue(value);
  return isMember(FILTER_LANGUAGES, v) ? v : null;
}

/** `IndexDecision` real ou `null`. */
export function parseIndexStatusFilter(value: RawParamValue): IndexStatusValue | null {
  const v = firstValue(value);
  return isMember(INDEX_DECISIONS, v) ? v : null;
}

/** `EntityType` real ou `null`. */
export function parseEntityTypeFilter(value: RawParamValue): EntityTypeValue | null {
  const v = firstValue(value);
  return isMember(ENTITY_TYPES, v) ? v : null;
}

/** `ContentBlockType` real ou `null`. */
export function parseBlockTypeFilter(value: RawParamValue): ContentBlockTypeValue | null {
  const v = firstValue(value);
  return isMember(CONTENT_BLOCK_TYPES, v) ? v : null;
}

/* ------------------------------------------------------------------ */
/* Objetos de filtro normalizados                                      */
/* ------------------------------------------------------------------ */

/** Filtros validados de listagem de artigos. So campos conhecidos e tipados. */
export interface ArticleFilters {
  readonly statusBucket: ReviewBucket | null;
  readonly language: FilterLanguage | null;
  readonly indexStatus: IndexStatusValue | null;
}

/** Filtros validados de listagem de content_blocks. */
export interface ContentBlockFilters {
  readonly statusBucket: ReviewBucket | null;
  readonly language: FilterLanguage | null;
  readonly entityType: EntityTypeValue | null;
  readonly blockType: ContentBlockTypeValue | null;
}

/** `true` se ao menos um filtro de artigo esta ativo. */
export function hasArticleFilters(filters: ArticleFilters): boolean {
  return filters.statusBucket !== null || filters.language !== null || filters.indexStatus !== null;
}

/** `true` se ao menos um filtro de content_block esta ativo. */
export function hasContentBlockFilters(filters: ContentBlockFilters): boolean {
  return (
    filters.statusBucket !== null ||
    filters.language !== null ||
    filters.entityType !== null ||
    filters.blockType !== null
  );
}

/** Normaliza os search params crus em filtros de artigo (ignora o desconhecido). */
export function parseArticleFilters(params: RawSearchParams | undefined): ArticleFilters {
  const p = params ?? {};
  return {
    statusBucket: parseReviewBucket(p.status),
    language: parseLanguageFilter(p.language),
    indexStatus: parseIndexStatusFilter(p.indexStatus),
  };
}

/** Normaliza os search params crus em filtros de content_block. */
export function parseContentBlockFilters(
  params: RawSearchParams | undefined,
): ContentBlockFilters {
  const p = params ?? {};
  return {
    statusBucket: parseReviewBucket(p.status),
    language: parseLanguageFilter(p.language),
    entityType: parseEntityTypeFilter(p.entityType),
    blockType: parseBlockTypeFilter(p.blockType),
  };
}

/**
 * Rotulo pt-BR de um balde de status (para chips/estado vazio). Fora do allowlist
 * -> "Todos".
 */
export function reviewBucketLabel(bucket: ReviewBucket | null): string {
  switch (bucket) {
    case "pending":
      return "Pendentes de revisao";
    case "approved":
      return "Aprovados";
    case "blocked":
      return "Bloqueados";
    default:
      return "Todos";
  }
}
