"use server";

/**
 * editorial-actions.ts — UNICA superficie de ESCRITA editorial do admin (Fase 7A).
 * SERVER-ONLY. Server Actions (`"use server"` no topo).
 *
 * Este e o unico arquivo do admin autorizado a escrever no banco, e SO com:
 *   - `prisma.articleTranslation.update` (campos `reviewStatus` | `indexStatus`);
 *   - `prisma.contentBlock.update`       (campo  `reviewStatus`).
 *
 * PROIBIDO aqui (travado por `tests/admin/editorial-actions-guard.test.ts`):
 *   create, delete, upsert, createMany, updateMany, deleteMany, SQL bruto, e a
 *   alteracao de qualquer campo NAO editorial (titulo, slug, corpo/conteudo,
 *   publishedAt). O writer editorial nao publica sozinho: nao carimba
 *   `publishedAt` — so muda o estado de revisao/indexacao que um humano escolheu.
 *
 * DUPLA TRAVA DE SEGURANCA:
 *   1. ACESSO — o middleware (`apps/admin/middleware.ts`) ja exige Basic Auth em
 *      ambiente production-like (Fase 6C). Nenhuma acao chega aqui sem passar por
 *      ele quando a protecao e exigida.
 *   2. ESCRITA — mesmo autenticado, a escrita so ocorre se
 *      `ADMIN_EDITORIAL_ACTIONS_ENABLED === "true"` (feature flag). Sem a flag, a
 *      acao e negada no servidor (nunca confia no botao desabilitado do cliente).
 *
 * FEEDBACK sem vazamento: cada acao termina redirecionando de volta ao detalhe
 * com uma query SEGURA (`?updated=<campo>` ou `?error=<codigo>`), montada por
 * `actionResultToQuery`. Nunca ha payload cru, valor rejeitado nem stack trace na
 * URL nem em log.
 *
 * A verdade da validacao vive no modulo PURO `../lib/editorial-action-policy`
 * (id/campo/valor contra os enums reais do Prisma). Aqui so orquestramos: validar
 * -> escrever (um `update` de um registro) -> revalidar -> redirecionar.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPrismaClient } from "@screena/db/server";

import {
  actionResultToQuery,
  buildActionResult,
  canRunEditorialAction,
  isValidRecordId,
  parseArticleActionInput,
  parseContentBlockActionInput,
  type EditorialActionResult,
} from "../lib/editorial-action-policy";
import {
  buildBulkActionResult,
  bulkResultToQuery,
  bulkScopeFor,
  parseBulkArticleActionInput,
  parseBulkContentBlockActionInput,
  type BulkActionResult,
} from "../lib/editorial-bulk-policy";

/** Base das rotas de detalhe (para o redirect de feedback). */
const ARTICLE_BASE = "/articles";
const CONTENT_BLOCK_BASE = "/content-blocks";

/** Rotas de origem permitidas para o redirect de lote (evita open redirect). */
const WORKFLOW_BASE = "/workflow";
const ALLOWED_RETURN_PATHS: readonly string[] = [WORKFLOW_BASE, "/review-queue"];

/** Env lida na fronteira (subconjunto tipado; so a flag de acoes). */
function editorialEnv(): { ADMIN_EDITORIAL_ACTIONS_ENABLED?: string } {
  return { ADMIN_EDITORIAL_ACTIONS_ENABLED: process.env.ADMIN_EDITORIAL_ACTIONS_ENABLED };
}

/**
 * Redireciona de volta ao detalhe (ou a listagem, se o id for invalido) com a
 * query de feedback segura. `redirect()` lanca `NEXT_REDIRECT` — por isso e
 * chamado FORA de qualquer try/catch de escrita.
 */
function redirectWithFeedback(base: string, id: string, result: EditorialActionResult): never {
  const target = isValidRecordId(id) ? `${base}/${id}` : base;
  revalidatePath(target);
  redirect(`${target}?${actionResultToQuery(result)}`);
}

/**
 * Aplica uma acao de artigo: gate da flag -> validacao pura -> UM `update` de um
 * registro. Devolve um resultado SEGURO (sem valor cru); nao redireciona.
 */
async function applyArticleAction(
  id: string,
  field: "reviewStatus" | "indexStatus",
  rawValue: unknown,
): Promise<EditorialActionResult> {
  if (!canRunEditorialAction(editorialEnv())) return buildActionResult("actions_disabled");

  const parsed = parseArticleActionInput({ id, field, value: rawValue });
  if (!parsed.ok) return buildActionResult("invalid_input");

  try {
    const prisma = getPrismaClient();
    if (parsed.field === "reviewStatus") {
      await prisma.articleTranslation.update({
        where: { id: BigInt(parsed.id) },
        data: { reviewStatus: parsed.value },
      });
    } else {
      await prisma.articleTranslation.update({
        where: { id: BigInt(parsed.id) },
        data: { indexStatus: parsed.value },
      });
    }
    return buildActionResult("updated", parsed.field);
  } catch {
    // Rotulo generico: nunca vazar a mensagem crua (poderia expor host/coluna).
    return buildActionResult("update_failed");
  }
}

/**
 * Aplica uma acao de content_block: gate da flag -> validacao pura -> UM `update`
 * de `reviewStatus`. O conteudo do bloco NUNCA e tocado.
 */
async function applyContentBlockAction(
  id: string,
  rawValue: unknown,
): Promise<EditorialActionResult> {
  if (!canRunEditorialAction(editorialEnv())) return buildActionResult("actions_disabled");

  const parsed = parseContentBlockActionInput({ id, field: "reviewStatus", value: rawValue });
  if (!parsed.ok) return buildActionResult("invalid_input");

  try {
    const prisma = getPrismaClient();
    await prisma.contentBlock.update({
      where: { id: BigInt(parsed.id) },
      data: { reviewStatus: parsed.value },
    });
    return buildActionResult("updated", parsed.field);
  } catch {
    return buildActionResult("update_failed");
  }
}

/* ------------------------------------------------------------------ */
/* Server Actions exportadas (id ligado via .bind no componente)       */
/* ------------------------------------------------------------------ */

/** Altera `ArticleTranslation.reviewStatus`. `id` vem ligado por `.bind`. */
export async function updateArticleReviewStatus(id: string, formData: FormData): Promise<void> {
  const result = await applyArticleAction(id, "reviewStatus", formData.get("reviewStatus"));
  redirectWithFeedback(ARTICLE_BASE, id, result);
}

/** Altera `ArticleTranslation.indexStatus`. `id` vem ligado por `.bind`. */
export async function updateArticleIndexStatus(id: string, formData: FormData): Promise<void> {
  const result = await applyArticleAction(id, "indexStatus", formData.get("indexStatus"));
  redirectWithFeedback(ARTICLE_BASE, id, result);
}

/** Altera `ContentBlock.reviewStatus`. `id` vem ligado por `.bind`. */
export async function updateContentBlockReviewStatus(
  id: string,
  formData: FormData,
): Promise<void> {
  const result = await applyContentBlockAction(id, formData.get("reviewStatus"));
  redirectWithFeedback(CONTENT_BLOCK_BASE, id, result);
}

/* ------------------------------------------------------------------ */
/* Acoes em LOTE (Fase 7C) — mesmo gate, mesma allowlist, 1..20 ids    */
/* ------------------------------------------------------------------ */

/**
 * Redireciona de volta a rota de origem (allowlist) com a query de feedback de
 * lote. `returnTo` e allowlistado para evitar open redirect. `redirect()` lanca
 * `NEXT_REDIRECT` — chamado FORA de qualquer try/catch de escrita.
 */
function redirectBulk(returnTo: string, result: BulkActionResult): never {
  const target = ALLOWED_RETURN_PATHS.includes(returnTo) ? returnTo : WORKFLOW_BASE;
  revalidatePath(target);
  redirect(`${target}?${bulkResultToQuery(result)}`);
}

/**
 * Aplica UMA acao editorial ao conjunto (1..20) de artigos: gate da flag ->
 * validacao pura -> `update` por item (NUNCA updateMany). Erro por item e
 * contado, nunca vaza (rotulo generico). O mesmo campo/valor vai para todos os
 * ids validados; nenhum campo nao editorial e tocado.
 */
async function applyBulkArticleAction(
  field: string,
  formData: FormData,
): Promise<BulkActionResult> {
  if (!canRunEditorialAction(editorialEnv())) return buildBulkActionResult("bulk_actions_disabled");

  const parsed = parseBulkArticleActionInput({
    field,
    value: formData.get("value"),
    ids: formData.getAll("ids"),
  });
  if (!parsed.ok) return buildBulkActionResult("bulk_invalid_input");

  const prisma = getPrismaClient();
  // Um unico objeto `data` (mesmo valor para todos); so campo editorial.
  const data =
    parsed.field === "reviewStatus"
      ? { reviewStatus: parsed.value }
      : { indexStatus: parsed.value };

  let updated = 0;
  let failed = 0;
  for (const id of parsed.ids) {
    try {
      await prisma.articleTranslation.update({ where: { id: BigInt(id) }, data });
      updated += 1;
    } catch {
      failed += 1;
    }
  }

  if (updated === 0 && failed > 0) return buildBulkActionResult("bulk_update_failed");
  return buildBulkActionResult("bulk_updated", bulkScopeFor("article", parsed.field), {
    updated,
    failed,
    total: parsed.ids.length,
  });
}

/**
 * Aplica `reviewStatus` a um conjunto (1..20) de content_blocks: gate -> validacao
 * -> `update` por item (NUNCA updateMany). O conteudo do bloco NUNCA e tocado.
 */
async function applyBulkContentBlockAction(formData: FormData): Promise<BulkActionResult> {
  if (!canRunEditorialAction(editorialEnv())) return buildBulkActionResult("bulk_actions_disabled");

  const parsed = parseBulkContentBlockActionInput({
    field: "reviewStatus",
    value: formData.get("value"),
    ids: formData.getAll("ids"),
  });
  if (!parsed.ok) return buildBulkActionResult("bulk_invalid_input");

  const prisma = getPrismaClient();
  let updated = 0;
  let failed = 0;
  for (const id of parsed.ids) {
    try {
      await prisma.contentBlock.update({
        where: { id: BigInt(id) },
        data: { reviewStatus: parsed.value },
      });
      updated += 1;
    } catch {
      failed += 1;
    }
  }

  if (updated === 0 && failed > 0) return buildBulkActionResult("bulk_update_failed");
  return buildBulkActionResult("bulk_updated", "contentBlock_reviewStatus", {
    updated,
    failed,
    total: parsed.ids.length,
  });
}

/**
 * Server Action de lote para artigos. `field` e `returnTo` vem ligados por
 * `.bind` (nao vem do cliente); `value` e `ids[]` vem do FormData.
 */
export async function runBulkArticleEditorialAction(
  field: string,
  returnTo: string,
  formData: FormData,
): Promise<void> {
  const result = await applyBulkArticleAction(field, formData);
  redirectBulk(returnTo, result);
}

/** Server Action de lote para content_blocks (sempre `reviewStatus`). */
export async function runBulkContentBlockEditorialAction(
  returnTo: string,
  formData: FormData,
): Promise<void> {
  const result = await applyBulkContentBlockAction(formData);
  redirectBulk(returnTo, result);
}
