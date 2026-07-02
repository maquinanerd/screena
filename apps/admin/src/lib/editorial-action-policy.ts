/**
 * editorial-action-policy.ts — Politica e validacao de ACOES EDITORIAIS. PURO.
 *
 * Sem rede, sem DB, sem IO, sem import de runtime (next/react/prisma): recebe
 * input cru (do FormData/URL) e devolve, de forma DETERMINISTICA, se a acao pode
 * rodar e qual valor validado aplicar. E a primeira e unica fronteira de decisao
 * de escrita editorial do admin (Fase 7A): a camada server-only (`editorial-actions.ts`)
 * so persiste o que este modulo aprovou.
 *
 * INVARIANTES DE ESCOPO (Fase 7A):
 *  - So dois modelos podem ser escritos: `ArticleTranslation` e `ContentBlock`.
 *  - So campos EDITORIAIS ja existentes: `reviewStatus` (ambos) e `indexStatus`
 *    (so artigo). NUNCA titulo/slug/corpo/conteudo/publishedAt.
 *  - So valores dos enums REAIS do Prisma (ReviewStatus, IndexDecision). Valor
 *    fora do enum e rejeitado — nada de "arbitrary Prisma data".
 *  - Escrita so acontece se `ADMIN_EDITORIAL_ACTIONS_ENABLED === "true"` (feature
 *    flag operacional, alem do Basic Auth do middleware).
 *
 * Este modulo NAO le `process.env` diretamente: recebe o env como argumento
 * (testavel, sem efeito colateral). O resultado de acao (`EditorialActionResult`)
 * carrega SO um outcome enum + o nome do campo — nunca o payload, o valor cru, a
 * mensagem de erro ou qualquer segredo.
 */

/* ------------------------------------------------------------------ */
/* Enums reais do Prisma (espelham packages/db/prisma/schema.prisma)   */
/* ------------------------------------------------------------------ */

/**
 * ReviewStatus (enum do schema). Vale para `ArticleTranslation.reviewStatus` e
 * `ContentBlock.reviewStatus`. A lista DEVE ser identica ao enum do Prisma; se o
 * schema mudar, o admin typecheck quebra ao atribuir o valor (uniao estrutural).
 */
export const REVIEW_STATUSES = [
  "draft",
  "ai_generated",
  "needs_review",
  "human_reviewed",
  "published",
  "needs_update",
  "blocked",
  "archived",
] as const;

/** Um valor de `ReviewStatus` (estruturalmente igual ao enum gerado pelo Prisma). */
export type ReviewStatusValue = (typeof REVIEW_STATUSES)[number];

/**
 * IndexDecision (enum do schema). Vale para `ArticleTranslation.indexStatus`.
 * O pedido cita "index / noindex"; expomos o enum REAL completo porque todos sao
 * decisoes editoriais legitimas de um revisor humano (ex.: `blocked`, `stale`),
 * e a validacao continua restrita a valores reais do Prisma.
 */
export const INDEX_DECISIONS = ["index", "noindex", "draft", "stale", "blocked"] as const;

/** Um valor de `IndexDecision` (estruturalmente igual ao enum gerado pelo Prisma). */
export type IndexStatusValue = (typeof INDEX_DECISIONS)[number];

/* ------------------------------------------------------------------ */
/* Campos editoriais permitidos por modelo                             */
/* ------------------------------------------------------------------ */

/** Campos de `ArticleTranslation` que uma acao editorial pode alterar. */
export const ARTICLE_ACTION_FIELDS = ["reviewStatus", "indexStatus"] as const;
export type ArticleActionField = (typeof ARTICLE_ACTION_FIELDS)[number];

/** Campos de `ContentBlock` que uma acao editorial pode alterar. */
export const CONTENT_BLOCK_ACTION_FIELDS = ["reviewStatus"] as const;
export type ContentBlockActionField = (typeof CONTENT_BLOCK_ACTION_FIELDS)[number];

/* ------------------------------------------------------------------ */
/* Feature flag (ADMIN_EDITORIAL_ACTIONS_ENABLED)                      */
/* ------------------------------------------------------------------ */

/** Nome da env que habilita a escrita editorial. So o NOME — nunca um valor. */
export const EDITORIAL_ACTIONS_ENV_KEY = "ADMIN_EDITORIAL_ACTIONS_ENABLED" as const;

/**
 * Subconjunto tipado do ambiente lido por esta politica. Estruturalmente
 * compativel com `process.env` (chave `string | undefined`).
 */
export interface EditorialActionsEnv {
  readonly ADMIN_EDITORIAL_ACTIONS_ENABLED?: string;
}

/**
 * `true` se, e SOMENTE se, a flag for exatamente a string `"true"`. Qualquer
 * outro valor (ausente, `"false"`, `"1"`, vazio, `"TRUE"`) NAO habilita escrita.
 * Espelha a rigidez de `ADMIN_PROTECTION_ENABLED` (fail closed por padrao).
 */
export function isEditorialActionsEnabled(env: EditorialActionsEnv): boolean {
  return env.ADMIN_EDITORIAL_ACTIONS_ENABLED === "true";
}

/**
 * Portao de decisao que a camada server-only chama antes de qualquer escrita.
 * Hoje equivale a flag habilitada; existe como ponto de decisao nomeado (o Basic
 * Auth de ACESSO ja e exigido separadamente no middleware, inclusive em
 * production-like). Sem a flag, o admin permanece navegavel/somente-leitura.
 */
export function canRunEditorialAction(env: EditorialActionsEnv): boolean {
  return isEditorialActionsEnabled(env);
}

/* ------------------------------------------------------------------ */
/* Validacao de ID e de valores de enum                                */
/* ------------------------------------------------------------------ */

/**
 * `true` se `value` e um ID de registro plausivel: string de digitos, positiva,
 * sem zero a esquerda, ate 19 digitos (cabe em BigInt/int64). Rejeita vazio,
 * `"0"`, negativos, decimais, notacao e qualquer nao-digito. A conversao para
 * BigInt fica na camada server-only; aqui so validamos a forma.
 */
export function isValidRecordId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value);
}

/** Normaliza um ID valido para string; retorna `null` se invalido. */
export function parseRecordId(value: unknown): string | null {
  return isValidRecordId(value) ? value : null;
}

/** Membro de um allowlist de strings (com narrowing para o tipo do allowlist). */
function isMember<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** `true` se `value` e um `ReviewStatus` permitido para artigo. */
export function isAllowedArticleReviewStatus(
  value: unknown,
  allowed: readonly ReviewStatusValue[] = REVIEW_STATUSES,
): value is ReviewStatusValue {
  return isMember(allowed, value);
}

/** `true` se `value` e um `ReviewStatus` permitido para content_block. */
export function isAllowedContentBlockReviewStatus(
  value: unknown,
  allowed: readonly ReviewStatusValue[] = REVIEW_STATUSES,
): value is ReviewStatusValue {
  return isMember(allowed, value);
}

/** `true` se `value` e um `IndexDecision` permitido. */
export function isAllowedIndexStatus(
  value: unknown,
  allowed: readonly IndexStatusValue[] = INDEX_DECISIONS,
): value is IndexStatusValue {
  return isMember(allowed, value);
}

/* ------------------------------------------------------------------ */
/* Parse de input de acao (id + field + value)                         */
/* ------------------------------------------------------------------ */

/** Input cru de uma acao (vindo de FormData/URL): tudo `unknown`. */
export interface RawActionInput {
  readonly id?: unknown;
  readonly field?: unknown;
  readonly value?: unknown;
}

/** Motivo estavel de rejeicao (sem valor sensivel). */
export type ActionRejectReason = "invalid_id" | "invalid_field" | "invalid_value" | "malformed";

/** Resultado do parse de uma acao de artigo (discriminado, ja com valor tipado). */
export type ArticleActionParse =
  | { readonly ok: true; readonly id: string; readonly field: "reviewStatus"; readonly value: ReviewStatusValue }
  | { readonly ok: true; readonly id: string; readonly field: "indexStatus"; readonly value: IndexStatusValue }
  | { readonly ok: false; readonly reason: ActionRejectReason };

/** Resultado do parse de uma acao de content_block (discriminado). */
export type ContentBlockActionParse =
  | { readonly ok: true; readonly id: string; readonly field: "reviewStatus"; readonly value: ReviewStatusValue }
  | { readonly ok: false; readonly reason: ActionRejectReason };

/** `true` se o input tem, no minimo, o formato de objeto esperado. */
function isPlainInput(input: unknown): input is RawActionInput {
  return typeof input === "object" && input !== null;
}

/**
 * Valida um input de acao de ARTIGO. Aceita SO os campos permitidos
 * (`reviewStatus`, `indexStatus`) e SO valores dos enums reais. Ordem de
 * checagem: forma -> id -> field -> value, com motivo preciso e sem vazar o valor.
 */
export function parseArticleActionInput(input: unknown): ArticleActionParse {
  if (!isPlainInput(input)) return { ok: false, reason: "malformed" };

  const id = parseRecordId(input.id);
  if (id === null) return { ok: false, reason: "invalid_id" };

  const field = input.field;
  if (!isMember(ARTICLE_ACTION_FIELDS, field)) return { ok: false, reason: "invalid_field" };

  if (field === "reviewStatus") {
    if (!isAllowedArticleReviewStatus(input.value)) return { ok: false, reason: "invalid_value" };
    return { ok: true, id, field, value: input.value };
  }
  // field === "indexStatus"
  if (!isAllowedIndexStatus(input.value)) return { ok: false, reason: "invalid_value" };
  return { ok: true, id, field, value: input.value };
}

/**
 * Valida um input de acao de CONTENT_BLOCK. So o campo `reviewStatus` e permitido
 * (o conteudo do bloco NUNCA e editado nesta fase) e so valores do enum real.
 */
export function parseContentBlockActionInput(input: unknown): ContentBlockActionParse {
  if (!isPlainInput(input)) return { ok: false, reason: "malformed" };

  const id = parseRecordId(input.id);
  if (id === null) return { ok: false, reason: "invalid_id" };

  const field = input.field;
  if (!isMember(CONTENT_BLOCK_ACTION_FIELDS, field)) return { ok: false, reason: "invalid_field" };

  if (!isAllowedContentBlockReviewStatus(input.value)) return { ok: false, reason: "invalid_value" };
  return { ok: true, id, field: "reviewStatus", value: input.value };
}

/* ------------------------------------------------------------------ */
/* Resultado de acao (feedback SEM segredo)                            */
/* ------------------------------------------------------------------ */

/**
 * Desfecho de uma acao — enum estavel e SEGURO para virar query string de
 * feedback. NUNCA contem payload, valor cru, stack trace nem segredo.
 *  - `updated`          — escrita aplicada com sucesso.
 *  - `actions_disabled` — flag desligada: escrita negada no servidor.
 *  - `invalid_input`    — id/campo/valor invalido.
 *  - `update_failed`    — a escrita falhou no banco (rotulo generico).
 */
export type EditorialActionOutcome =
  | "updated"
  | "actions_disabled"
  | "invalid_input"
  | "update_failed";

/** Campos que podem aparecer no feedback (allowlist — nunca valor arbitrario). */
export const FEEDBACK_FIELDS = ["reviewStatus", "indexStatus"] as const;
export type FeedbackField = (typeof FEEDBACK_FIELDS)[number];

/** Resultado seguro de uma acao editorial (so outcome + campo, nada sensivel). */
export interface EditorialActionResult {
  readonly ok: boolean;
  readonly outcome: EditorialActionOutcome;
  /** Campo afetado (so quando `updated`); sempre um nome de campo do allowlist. */
  readonly field?: FeedbackField;
}

/**
 * Monta um `EditorialActionResult`. Por construcao so aceita um outcome do enum e
 * (opcionalmente) um nome de campo do allowlist — impossivel embutir segredo,
 * valor cru ou mensagem de erro. `ok` deriva do outcome (`updated`).
 */
export function buildActionResult(
  outcome: EditorialActionOutcome,
  field?: FeedbackField,
): EditorialActionResult {
  const ok = outcome === "updated";
  return field !== undefined && ok ? { ok, outcome, field } : { ok, outcome };
}

/**
 * Serializa o resultado como a QUERY STRING de feedback usada no redirect
 * (`updated=reviewStatus` | `error=actions_disabled` | `error=invalid_input` |
 * `error=update_failed`). Determinista e sem segredo — a UI le so estes tokens.
 */
export function actionResultToQuery(result: EditorialActionResult): string {
  if (result.ok && result.outcome === "updated" && result.field !== undefined) {
    return `updated=${result.field}`;
  }
  return `error=${result.outcome === "updated" ? "update_failed" : result.outcome}`;
}

/* ------------------------------------------------------------------ */
/* Feedback pos-acao (mensagem pt-BR fixa, sem payload)                */
/* ------------------------------------------------------------------ */

/** Tom visual do feedback (mapeia para uma pill/banner). */
export type FeedbackTone = "success" | "error";

/** Feedback exibivel: tom + mensagem FIXA em pt-BR (nunca payload/stack). */
export interface ActionFeedback {
  readonly tone: FeedbackTone;
  readonly message: string;
}

/**
 * Traduz os tokens de query (`?updated=` / `?error=`) em uma mensagem SEGURA de
 * feedback. Retorna `null` quando nao ha token reconhecido. So devolve strings
 * fixas — por construcao nao ha como um valor cru, id ou stack trace vazar aqui.
 */
export function readActionFeedback(params: {
  readonly updated?: string;
  readonly error?: string;
}): ActionFeedback | null {
  const { updated, error } = params;
  if (updated === "reviewStatus") {
    return { tone: "success", message: "Status de revisao atualizado." };
  }
  if (updated === "indexStatus") {
    return { tone: "success", message: "Indexacao (index_status) atualizada." };
  }
  if (error === "actions_disabled") {
    return { tone: "error", message: "Acao negada: acoes editoriais desativadas por ambiente." };
  }
  if (error === "invalid_input") {
    return { tone: "error", message: "Entrada invalida. Nada foi alterado." };
  }
  if (error === "update_failed") {
    return { tone: "error", message: "Falha ao atualizar. Nada foi alterado." };
  }
  return null;
}
