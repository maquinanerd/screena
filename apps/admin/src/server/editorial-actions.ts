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

/** Base das rotas de detalhe (para o redirect de feedback). */
const ARTICLE_BASE = "/articles";
const CONTENT_BLOCK_BASE = "/content-blocks";

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
