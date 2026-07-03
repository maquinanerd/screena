/**
 * editorial-bulk-policy.ts — Politica e validacao de ACOES EDITORIAIS EM LOTE.
 * PURO (sem rede/DB/IO/import de runtime). Fase 7C.
 *
 * Estende a politica unitaria da Fase 7A (`./editorial-action-policy`) para aplicar
 * UM campo/valor a um CONJUNTO pequeno e validado de ids. NAO amplia a allowlist:
 * os campos e valores permitidos sao exatamente os da Fase 7A
 * (`reviewStatus`/`indexStatus` para artigo; `reviewStatus` para content_block),
 * e todo valor e checado contra os enums REAIS do Prisma. A escrita continua
 * sendo `articleTranslation.update` / `contentBlock.update` (nunca updateMany).
 *
 * INVARIANTES DE LOTE:
 *  - limite 1..20 ids por acao; ids inteiros positivos seguros; duplicados removidos;
 *  - nada de campo/valor arbitrario; nada de "arbitrary Prisma data" nem JSON livre;
 *  - a flag `ADMIN_EDITORIAL_ACTIONS_ENABLED` gateia a escrita (mesmo gate da 7A);
 *  - o resultado carrega SO outcome + escopo + contagens inteiras — nunca segredo,
 *    payload cru, id individual, valor cru ou mensagem de erro.
 */

import {
  ARTICLE_ACTION_FIELDS,
  CONTENT_BLOCK_ACTION_FIELDS,
  isAllowedArticleReviewStatus,
  isAllowedContentBlockReviewStatus,
  isAllowedIndexStatus,
  isValidRecordId,
  type ActionFeedback,
  type IndexStatusValue,
  type ReviewStatusValue,
} from "./editorial-action-policy";

/* ------------------------------------------------------------------ */
/* Limites                                                            */
/* ------------------------------------------------------------------ */

/** Numero maximo de itens por acao em lote (pequeno e controlado). */
export const BULK_LIMIT = 20;
/** Numero minimo de itens por acao em lote. */
export const BULK_MIN = 1;
/**
 * Teto DURO de entradas cruas aceitas antes de validar (10x o limite). Barra
 * cedo um payload gigante/adulterado sem varrer milhares de elementos.
 */
const HARD_INPUT_CAP = BULK_LIMIT * 10;

/** Limite maximo de itens por acao em lote. */
export function getBulkLimit(): number {
  return BULK_LIMIT;
}

/* ------------------------------------------------------------------ */
/* Ids                                                                */
/* ------------------------------------------------------------------ */

/** Remove ids duplicados preservando a ordem. */
export function dedupeBulkIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** `true` se a quantidade de ids esta na faixa [BULK_MIN, limit]. */
export function enforceBulkLimit(ids: readonly string[], limit: number = BULK_LIMIT): boolean {
  return ids.length >= BULK_MIN && ids.length <= limit;
}

/** Motivo estavel de rejeicao (sem valor sensivel). */
export type BulkRejectReason =
  | "invalid_field"
  | "invalid_value"
  | "no_ids"
  | "too_many_ids"
  | "invalid_ids"
  | "malformed";

/** Resultado da validacao de ids. */
export type BulkIdsResult =
  | { readonly ok: true; readonly ids: string[] }
  | { readonly ok: false; readonly reason: Extract<BulkRejectReason, "no_ids" | "too_many_ids" | "invalid_ids" | "malformed"> };

/**
 * Valida a lista de ids: precisa ser array; cada item um id de registro valido
 * (inteiro positivo seguro); duplicados removidos; faixa [1, limit]. Barra cedo
 * entradas gigantes (teto duro) para limitar trabalho.
 */
export function validateBulkIds(raw: unknown, limit: number = BULK_LIMIT): BulkIdsResult {
  if (!Array.isArray(raw)) return { ok: false, reason: "malformed" };
  if (raw.length > HARD_INPUT_CAP) return { ok: false, reason: "too_many_ids" };

  const valid: string[] = [];
  for (const value of raw) {
    if (!isValidRecordId(value)) return { ok: false, reason: "invalid_ids" };
    valid.push(value);
  }

  const ids = dedupeBulkIds(valid);
  if (ids.length < BULK_MIN) return { ok: false, reason: "no_ids" };
  if (ids.length > limit) return { ok: false, reason: "too_many_ids" };
  return { ok: true, ids };
}

/* ------------------------------------------------------------------ */
/* Campos e valores permitidos (reusam a allowlist da Fase 7A)         */
/* ------------------------------------------------------------------ */

/** `true` se `field` e um campo de artigo editavel em lote (reviewStatus|indexStatus). */
export function isAllowedBulkArticleField(field: unknown): field is "reviewStatus" | "indexStatus" {
  return typeof field === "string" && (ARTICLE_ACTION_FIELDS as readonly string[]).includes(field);
}

/** `true` se `field` e um campo de content_block editavel em lote (reviewStatus). */
export function isAllowedBulkContentBlockField(field: unknown): field is "reviewStatus" {
  return (
    typeof field === "string" && (CONTENT_BLOCK_ACTION_FIELDS as readonly string[]).includes(field)
  );
}

/** `true` se `value` e permitido para o `field` de artigo (enum real por campo). */
export function isAllowedBulkArticleValue(field: string, value: unknown): boolean {
  if (field === "reviewStatus") return isAllowedArticleReviewStatus(value);
  if (field === "indexStatus") return isAllowedIndexStatus(value);
  return false;
}

/** `true` se `value` e permitido para o `field` de content_block (so reviewStatus). */
export function isAllowedBulkContentBlockValue(field: string, value: unknown): boolean {
  return field === "reviewStatus" && isAllowedContentBlockReviewStatus(value);
}

/* ------------------------------------------------------------------ */
/* Parse de input de lote (field + value + ids)                        */
/* ------------------------------------------------------------------ */

/** Input cru de uma acao em lote (do FormData): tudo `unknown`. */
export interface RawBulkInput {
  readonly field?: unknown;
  readonly value?: unknown;
  readonly ids?: unknown;
}

/** Parse de acao em lote de ARTIGO (discriminado; ja com valor tipado). */
export type BulkArticleParse =
  | { readonly ok: true; readonly field: "reviewStatus"; readonly value: ReviewStatusValue; readonly ids: string[] }
  | { readonly ok: true; readonly field: "indexStatus"; readonly value: IndexStatusValue; readonly ids: string[] }
  | { readonly ok: false; readonly reason: BulkRejectReason };

/** Parse de acao em lote de CONTENT_BLOCK. */
export type BulkContentBlockParse =
  | { readonly ok: true; readonly field: "reviewStatus"; readonly value: ReviewStatusValue; readonly ids: string[] }
  | { readonly ok: false; readonly reason: BulkRejectReason };

function isPlainInput(input: unknown): input is RawBulkInput {
  return typeof input === "object" && input !== null;
}

/**
 * Valida um input de acao em lote de ARTIGO: campo permitido, valor do enum real
 * do campo, ids validos (1..20, deduplicados). Ordem: forma -> campo -> ids ->
 * valor. Sem segredo, sem dado arbitrario.
 */
export function parseBulkArticleActionInput(input: unknown): BulkArticleParse {
  if (!isPlainInput(input)) return { ok: false, reason: "malformed" };
  if (!isAllowedBulkArticleField(input.field)) return { ok: false, reason: "invalid_field" };
  const field = input.field;

  const idsResult = validateBulkIds(input.ids);
  if (!idsResult.ok) return { ok: false, reason: idsResult.reason };

  if (field === "reviewStatus") {
    if (!isAllowedArticleReviewStatus(input.value)) return { ok: false, reason: "invalid_value" };
    return { ok: true, field, value: input.value, ids: idsResult.ids };
  }
  // field === "indexStatus"
  if (!isAllowedIndexStatus(input.value)) return { ok: false, reason: "invalid_value" };
  return { ok: true, field, value: input.value, ids: idsResult.ids };
}

/** Valida um input de acao em lote de CONTENT_BLOCK (so `reviewStatus`). */
export function parseBulkContentBlockActionInput(input: unknown): BulkContentBlockParse {
  if (!isPlainInput(input)) return { ok: false, reason: "malformed" };
  if (!isAllowedBulkContentBlockField(input.field)) return { ok: false, reason: "invalid_field" };

  const idsResult = validateBulkIds(input.ids);
  if (!idsResult.ok) return { ok: false, reason: idsResult.reason };

  if (!isAllowedContentBlockReviewStatus(input.value)) return { ok: false, reason: "invalid_value" };
  return { ok: true, field: "reviewStatus", value: input.value, ids: idsResult.ids };
}

/* ------------------------------------------------------------------ */
/* Resultado de lote (feedback SEM segredo)                            */
/* ------------------------------------------------------------------ */

/** Desfecho de uma acao em lote — enum estavel e seguro para query string. */
export type BulkActionOutcome =
  | "bulk_updated"
  | "bulk_actions_disabled"
  | "bulk_invalid_input"
  | "bulk_update_failed";

/** Escopo da acao em lote (allowlist — nunca valor arbitrario). */
export const BULK_SCOPES = [
  "article_reviewStatus",
  "article_indexStatus",
  "contentBlock_reviewStatus",
] as const;
export type BulkScope = (typeof BULK_SCOPES)[number];

/** Contagens inteiras seguras de um lote. */
export interface BulkCounts {
  readonly updated: number;
  readonly failed: number;
  readonly total: number;
}

/** Resultado seguro de uma acao em lote (so outcome + escopo + contagens). */
export interface BulkActionResult {
  readonly ok: boolean;
  readonly outcome: BulkActionOutcome;
  readonly scope?: BulkScope;
  readonly updated?: number;
  readonly failed?: number;
  readonly total?: number;
}

/** Escopo derivado de (modelo, campo) — allowlist fechada. */
export function bulkScopeFor(
  model: "article" | "contentBlock",
  field: "reviewStatus" | "indexStatus",
): BulkScope {
  if (model === "contentBlock") return "contentBlock_reviewStatus";
  return field === "indexStatus" ? "article_indexStatus" : "article_reviewStatus";
}

/**
 * Monta um `BulkActionResult`. Por construcao so aceita outcome do enum, um
 * escopo do allowlist e contagens INTEIRAS — impossivel embutir segredo, id,
 * valor cru ou mensagem de erro.
 */
export function buildBulkActionResult(
  outcome: BulkActionOutcome,
  scope?: BulkScope,
  counts?: BulkCounts,
): BulkActionResult {
  const ok = outcome === "bulk_updated";
  if (ok && scope !== undefined && counts !== undefined) {
    return {
      ok,
      outcome,
      scope,
      updated: safeCount(counts.updated),
      failed: safeCount(counts.failed),
      total: safeCount(counts.total),
    };
  }
  return { ok, outcome };
}

function safeCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * Serializa o resultado como a QUERY STRING de feedback do redirect. So tokens do
 * enum + contagens inteiras (`bulk_updated=<escopo>&ok=N&fail=M` ou
 * `error=<codigo>`). Sem segredo.
 */
export function bulkResultToQuery(result: BulkActionResult): string {
  if (result.ok && result.outcome === "bulk_updated" && result.scope !== undefined) {
    return `bulk_updated=${result.scope}&ok=${result.updated ?? 0}&fail=${result.failed ?? 0}`;
  }
  return `error=${result.outcome === "bulk_updated" ? "bulk_update_failed" : result.outcome}`;
}

/* ------------------------------------------------------------------ */
/* Feedback pos-acao (mensagem pt-BR fixa, sem payload)                */
/* ------------------------------------------------------------------ */

const SCOPE_LABELS: Record<BulkScope, string> = {
  article_reviewStatus: "artigo(s): review_status",
  article_indexStatus: "artigo(s): index_status",
  contentBlock_reviewStatus: "content block(s): review_status",
};

/** Converte uma contagem crua de query em inteiro seguro pequeno (so digitos). */
function toSafeCount(value: string | undefined): number {
  return typeof value === "string" && /^\d{1,4}$/.test(value) ? Number(value) : 0;
}

function isBulkScope(value: string | undefined): value is BulkScope {
  return value !== undefined && (BULK_SCOPES as readonly string[]).includes(value);
}

/**
 * Traduz os tokens de query em uma mensagem SEGURA de feedback de lote. So strings
 * fixas + contagens inteiras — nunca payload/id/valor. `null` se nada reconhecido.
 */
export function readBulkFeedback(params: {
  readonly bulk_updated?: string;
  readonly error?: string;
  readonly ok?: string;
  readonly fail?: string;
}): ActionFeedback | null {
  const { bulk_updated, error } = params;
  if (isBulkScope(bulk_updated)) {
    const updated = toSafeCount(params.ok);
    const failed = toSafeCount(params.fail);
    return {
      tone: updated > 0 ? "success" : "error",
      message: `${updated} ${SCOPE_LABELS[bulk_updated]} atualizado(s). ${failed} falha(s).`,
    };
  }
  if (error === "bulk_actions_disabled") {
    return { tone: "error", message: "Acoes em lote desativadas por ambiente." };
  }
  if (error === "bulk_invalid_input") {
    return { tone: "error", message: "Entrada invalida. Nada foi alterado em lote." };
  }
  if (error === "bulk_update_failed") {
    return { tone: "error", message: "Falha ao aplicar a acao em lote." };
  }
  return null;
}
