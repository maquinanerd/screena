/**
 * inspect-entity-writer.ts — Camada PURA de inspecao read-only do Entity Writer.
 *
 * Responde, sem efeito colateral, ao estado operacional do writer: quantos jobs
 * por status/tipo, quantos content_blocks por review_status/tipo/origem, quais
 * entidades tem blocos, falhas/logs recentes e se ha fila acumulada.
 *
 * Esta camada NAO toca o banco: depende apenas de um `InspectStorePort` (o
 * adapter Prisma read-only vive em ../persistence/inspect-store). Assim ela e
 * 100% testavel com fakes em memoria. NUNCA escreve,
 * NUNCA chama Gemini, NUNCA chama API externa.
 *
 * A saida (`InspectionReport`) e estrutural e JSON-safe (so string/number/
 * boolean/array/null): ids vem como string, datas como ISO, e mensagens de erro
 * ja chegam RESUMIDAS (1a linha, truncada) — nunca stack trace longo nem segredo.
 */

import type { EntityType } from "../types.js";

/** Ordem canonica de exibicao dos status de job (espelha o enum JobStatus). */
export const JOB_STATUS_ORDER = [
  "queued",
  "claimed",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
] as const;

/** Ordem canonica de exibicao dos review_status (espelha o enum ReviewStatus). */
export const REVIEW_STATUS_ORDER = [
  "draft",
  "ai_generated",
  "needs_review",
  "human_reviewed",
  "published",
  "needs_update",
  "blocked",
  "archived",
] as const;

/** Tamanho maximo de uma mensagem de erro exibida (resumo seguro). */
export const ERROR_SUMMARY_MAX = 200;

/** Filtro/consulta da inspecao. `limit` ja vem validado (inteiro positivo). */
export interface InspectQuery {
  /** Maximo de itens nas listas "recentes" e em "entidades com blocos". */
  readonly limit: number;
  /** Filtro opcional por tipo de entidade. */
  readonly entityType?: EntityType;
  /** Idioma do recorte (default pt-BR resolvido no CLI). */
  readonly languageCode: string;
}

/** Contagem de uma categoria (ex.: status='queued' -> 5). */
export interface CountBucket {
  readonly key: string;
  readonly count: number;
}

/** Job recente que falhou/bloqueou (subconjunto seguro de entity_writer_jobs). */
export interface RecentFailedJob {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly languageCode: string;
  readonly status: string;
  readonly attempts: number;
  /** Mensagem de erro JA resumida (1a linha truncada) ou null. */
  readonly lastError: string | null;
  readonly updatedAt: string | null;
}

/** Log recente com erro (subconjunto seguro de entity_writer_logs). */
export interface RecentLogError {
  readonly id: string;
  readonly jobId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly validationStatus: string | null;
  /** Mensagem de erro JA resumida (1a linha truncada) ou null. */
  readonly errorMessage: string | null;
  readonly createdAt: string | null;
}

/** Job concluido recentemente (subconjunto seguro de entity_writer_jobs). */
export interface RecentCompletedJob {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly languageCode: string;
  readonly jobType: string;
  readonly resultBlockId: string | null;
  readonly completedAt: string | null;
}

/** Entidade que possui content_blocks (agrupada por alvo + idioma). */
export interface EntityBlockGroup {
  readonly entityType: string;
  readonly entityId: string;
  readonly languageCode: string;
  readonly blockCount: number;
}

/**
 * Dado CRU coletado do banco pelo adapter. Mensagens de erro vem completas; a
 * camada pura as resume. As listas "recentes" ja vem limitadas pelo adapter,
 * mas a camada pura reaplica o `limit` como rede de seguranca.
 */
export interface InspectionData {
  readonly jobsByStatus: readonly CountBucket[];
  readonly jobsByType: readonly CountBucket[];
  readonly jobsByEntityType: readonly CountBucket[];
  readonly blocksByReviewStatus: readonly CountBucket[];
  readonly blocksByBlockType: readonly CountBucket[];
  readonly blocksBySourceType: readonly CountBucket[];
  readonly recentFailedJobs: readonly RecentFailedJob[];
  readonly recentLogErrors: readonly RecentLogError[];
  readonly recentCompletedJobs: readonly RecentCompletedJob[];
  readonly entitiesWithBlocks: readonly EntityBlockGroup[];
}

/**
 * Porta de LEITURA da inspecao. O adapter real (Prisma) so faz reads (groupBy/
 * count/findMany), nunca escreve, nunca chama Gemini. A camada pura depende SO
 * desta interface.
 */
export interface InspectStorePort {
  collect(query: InspectQuery): Promise<InspectionData>;
}

/** Visao de jobs com contagens derivadas + flag de fila acumulada. */
export interface JobsView {
  readonly byStatus: readonly CountBucket[];
  readonly byType: readonly CountBucket[];
  readonly byEntityType: readonly CountBucket[];
  readonly queued: number;
  readonly claimed: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly blocked: number;
  readonly cancelled: number;
  /** Jobs ainda em voo: queued + claimed + running. */
  readonly active: number;
  readonly total: number;
  /** Ha fila acumulada (algum job aguardando claim). */
  readonly hasBacklog: boolean;
}

/** Visao de content_blocks com contagens derivadas por review_status. */
export interface BlocksView {
  readonly byReviewStatus: readonly CountBucket[];
  readonly byBlockType: readonly CountBucket[];
  readonly bySourceType: readonly CountBucket[];
  readonly draft: number;
  readonly aiGenerated: number;
  readonly needsReview: number;
  readonly humanReviewed: number;
  readonly published: number;
  readonly needsUpdate: number;
  readonly blocked: number;
  readonly archived: number;
  readonly total: number;
}

/** Relatorio final de inspecao (estrutural, JSON-safe). */
export interface InspectionReport {
  readonly filter: {
    readonly entityType: string | null;
    readonly languageCode: string;
    readonly limit: number;
  };
  readonly jobs: JobsView;
  readonly blocks: BlocksView;
  readonly recentFailedJobs: readonly RecentFailedJob[];
  readonly recentLogErrors: readonly RecentLogError[];
  readonly recentCompletedJobs: readonly RecentCompletedJob[];
  readonly entitiesWithBlocks: readonly EntityBlockGroup[];
}

/** Soma a contagem de uma chave em uma lista de buckets (0 se ausente). */
function bucketValue(buckets: readonly CountBucket[], key: string): number {
  let total = 0;
  for (const bucket of buckets) {
    if (bucket.key === key) total += bucket.count;
  }
  return total;
}

/** Soma total de uma lista de buckets. */
function bucketTotal(buckets: readonly CountBucket[]): number {
  let total = 0;
  for (const bucket of buckets) total += bucket.count;
  return total;
}

/** Ordena buckets por uma ordem canonica (chaves desconhecidas vao para o fim). */
function orderBuckets(buckets: readonly CountBucket[], order: readonly string[]): CountBucket[] {
  const rank = new Map(order.map((key, i) => [key, i]));
  return [...buckets].sort((a, b) => {
    const ra = rank.get(a.key) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.key) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Resume uma mensagem de erro para exibicao segura: pega a 1a linha (descarta
 * stack trace), normaliza espacos e trunca em `ERROR_SUMMARY_MAX`. Nunca expoe
 * o texto completo (que pode conter stack/segredo). null -> null.
 */
export function summarizeError(message: string | null | undefined): string | null {
  if (message === null || message === undefined) return null;
  const firstLine = message.split(/\r?\n/, 1)[0] ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  if (collapsed.length <= ERROR_SUMMARY_MAX) return collapsed;
  return `${collapsed.slice(0, ERROR_SUMMARY_MAX - 1)}…`;
}

/**
 * Monta o relatorio final a partir do dado cru e da consulta. PURA: deriva
 * contagens, resume mensagens de erro e reaplica `limit` nas listas (rede de
 * seguranca, mesmo que o adapter ja limite).
 */
export function buildInspectionReport(data: InspectionData, query: InspectQuery): InspectionReport {
  const limit = query.limit;

  const byStatus = orderBuckets(data.jobsByStatus, JOB_STATUS_ORDER);
  const jobs: JobsView = {
    byStatus,
    byType: [...data.jobsByType],
    byEntityType: [...data.jobsByEntityType],
    queued: bucketValue(byStatus, "queued"),
    claimed: bucketValue(byStatus, "claimed"),
    running: bucketValue(byStatus, "running"),
    completed: bucketValue(byStatus, "completed"),
    failed: bucketValue(byStatus, "failed"),
    blocked: bucketValue(byStatus, "blocked"),
    cancelled: bucketValue(byStatus, "cancelled"),
    active:
      bucketValue(byStatus, "queued") +
      bucketValue(byStatus, "claimed") +
      bucketValue(byStatus, "running"),
    total: bucketTotal(byStatus),
    hasBacklog: bucketValue(byStatus, "queued") > 0,
  };

  const byReviewStatus = orderBuckets(data.blocksByReviewStatus, REVIEW_STATUS_ORDER);
  const blocks: BlocksView = {
    byReviewStatus,
    byBlockType: [...data.blocksByBlockType],
    bySourceType: [...data.blocksBySourceType],
    draft: bucketValue(byReviewStatus, "draft"),
    aiGenerated: bucketValue(byReviewStatus, "ai_generated"),
    needsReview: bucketValue(byReviewStatus, "needs_review"),
    humanReviewed: bucketValue(byReviewStatus, "human_reviewed"),
    published: bucketValue(byReviewStatus, "published"),
    needsUpdate: bucketValue(byReviewStatus, "needs_update"),
    blocked: bucketValue(byReviewStatus, "blocked"),
    archived: bucketValue(byReviewStatus, "archived"),
    total: bucketTotal(byReviewStatus),
  };

  return {
    filter: {
      entityType: query.entityType ?? null,
      languageCode: query.languageCode,
      limit,
    },
    jobs,
    blocks,
    recentFailedJobs: data.recentFailedJobs
      .slice(0, limit)
      .map((job) => ({ ...job, lastError: summarizeError(job.lastError) })),
    recentLogErrors: data.recentLogErrors
      .slice(0, limit)
      .map((log) => ({ ...log, errorMessage: summarizeError(log.errorMessage) })),
    recentCompletedJobs: data.recentCompletedJobs.slice(0, limit),
    entitiesWithBlocks: data.entitiesWithBlocks.slice(0, limit),
  };
}

/**
 * Inspeciona o Entity Writer via a porta read-only. Apenas le e monta o
 * relatorio — sem escrita, sem Gemini, sem rede.
 */
export async function inspectEntityWriter(
  store: InspectStorePort,
  query: InspectQuery,
): Promise<InspectionReport> {
  const data = await store.collect(query);
  return buildInspectionReport(data, query);
}
