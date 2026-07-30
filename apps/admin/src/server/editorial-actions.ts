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
 * TRIPLA TRAVA DE SEGURANCA:
 *   1. ACESSO — o middleware (`apps/admin/middleware.ts`) ja exige Basic Auth em
 *      ambiente production-like (Fase 6C). Nenhuma acao chega aqui sem passar por
 *      ele quando a protecao e exigida.
 *   2. ESCRITA — mesmo autenticado, a escrita so ocorre se
 *      `ADMIN_EDITORIAL_ACTIONS_ENABLED === "true"` (feature flag). Sem a flag, a
 *      acao e negada no servidor (nunca confia no botao desabilitado do cliente).
 *   3. CICLO DE VIDA — mesmo com flag ligada, uma mudanca de `reviewStatus` DE
 *      ARTIGO so persiste se a FONTE UNICA (`canTransition`, de
 *      `@screena/news-ingestion`, via `../lib/editorial-transition-policy`)
 *      permitir a transicao a partir do estado LIDO DO BANCO. Antes disto o admin
 *      escrevia qualquer valor do enum isoladamente, o que permitia
 *      `draft -> published` (pulando a revisao humana) e `blocked -> published`
 *      (republicando uma materia retratada).
 *
 *      Esta trava NAO vale para `content_blocks`: o enum e o mesmo, o dominio
 *      NAO e. Ver `docs/adr/0016-content-block-lifecycle-separation.md`.
 *
 * CONCORRENCIA (compare-and-swap). Validar contra um estado lido e depois
 * escrever sem condicao aceitaria silenciosamente um estado velho: entre a
 * leitura e a escrita, outro operador pode ter movido a materia. Por isso o
 * `where` do `update` carrega o estado lido como PRE-CONDICAO. Se ele nao casar
 * mais, o Prisma devolve P2025, nada e escrito e o resultado e `stale_state`.
 * Usamos `update` (nao `updateMany`) de proposito: `updateMany` esta proibido
 * neste arquivo por `tests/admin/editorial-actions-guard.test.ts`, e o
 * `where` estendido do Prisma 6 aceita pre-condicao escalar junto da chave
 * unica — atingindo no maximo uma linha.
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
  type ReviewStatusValue,
} from "../lib/editorial-action-policy";
import {
  buildBulkActionResult,
  bulkResultToQuery,
  bulkScopeFor,
  parseBulkArticleActionInput,
  parseBulkContentBlockActionInput,
  type BulkActionResult,
} from "../lib/editorial-bulk-policy";
import { evaluateReviewStatusTransition } from "../lib/editorial-transition-policy";

/**
 * `true` quando o Prisma sinaliza "nenhum registro casou com o `where`" (P2025).
 * Numa escrita condicionada ao estado lido, isso significa exatamente uma coisa:
 * o registro sumiu ou mudou entre a leitura e a escrita. Checagem estrutural, sem
 * importar o tipo de erro do Prisma (que arrastaria runtime para este modulo).
 */
function isRecordConditionUnmet(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "P2025"
  );
}

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
      const recordId = BigInt(parsed.id);
      // Estado ATUAL vem do banco, nunca do formulario: a transicao e avaliada
      // contra o que existe, nao contra o que o cliente afirma existir.
      const current = await prisma.articleTranslation.findUnique({
        where: { id: recordId },
        select: { reviewStatus: true },
      });
      if (current === null) return buildActionResult("update_failed");

      const verdict = evaluateReviewStatusTransition(current.reviewStatus, parsed.value);
      if (!verdict.allowed) return buildActionResult(verdict.outcome);

      // CAS: so escreve se o estado ainda for o que foi lido e validado.
      await prisma.articleTranslation.update({
        where: { id: recordId, reviewStatus: current.reviewStatus },
        data: { reviewStatus: parsed.value },
      });
    } else {
      // `indexStatus` NAO e campo de ciclo de vida: nao ha maquina de estados
      // para ele, e por isso nao passa por `canTransition`. Continua sendo uma
      // decisao editorial independente — e nunca e tocado como efeito colateral
      // de uma mudanca de `reviewStatus`.
      await prisma.articleTranslation.update({
        where: { id: BigInt(parsed.id) },
        data: { indexStatus: parsed.value },
      });
    }
    return buildActionResult("updated", parsed.field);
  } catch (error) {
    if (isRecordConditionUnmet(error)) return buildActionResult("stale_state");
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
    const recordId = BigInt(parsed.id);
    // ATENCAO — `content_blocks` NAO usa a maquina de estados de
    // `article_translations`, apesar de compartilhar o enum `ReviewStatus`. Os
    // mesmos rotulos significam coisas diferentes nos dois dominios (ver
    // `docs/adr/0016-content-block-lifecycle-separation.md`):
    //   - artigo:  `blocked`/`archived` = RETRATACAO de algo que foi publico;
    //   - bloco:   `blocked` = falha de validacao na geracao (nasce assim) e
    //              `archived` = versao superada, arquivada AUTOMATICAMENTE pelo
    //              writer ao inserir a versao seguinte (archive + insert).
    // Alem disso, `ai_generated -> human_reviewed` e o caminho feliz do Entity
    // Writer e NAO existe na allowlist de artigo. Aplicar aquela allowlist aqui
    // quebraria a aprovacao de bloco em um passo.
    // O que permanece e a protecao de CONCORRENCIA (compare-and-swap).
    const current = await prisma.contentBlock.findUnique({
      where: { id: recordId },
      select: { reviewStatus: true },
    });
    if (current === null) return buildActionResult("update_failed");

    await prisma.contentBlock.update({
      where: { id: recordId, reviewStatus: current.reviewStatus },
      data: { reviewStatus: parsed.value },
    });
    return buildActionResult("updated", parsed.field);
  } catch (error) {
    if (isRecordConditionUnmet(error)) return buildActionResult("stale_state");
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
  // Narrowing na uniao discriminada: `null` quando o lote nao mexe no ciclo de
  // vida (campo `indexStatus`), o valor-alvo tipado quando mexe.
  const lifecycleTarget: ReviewStatusValue | null =
    parsed.field === "reviewStatus" ? parsed.value : null;

  let updated = 0;
  let failed = 0;
  let rejected = 0;
  for (const id of parsed.ids) {
    const recordId = BigInt(id);
    // O lote aplica o MESMO valor a estados de origem DIFERENTES. Por isso a
    // transicao e avaliada item a item: o mesmo "publicar" pode ser legitimo
    // para um `human_reviewed` e proibido para um `blocked` na mesma selecao.
    let expected: ReviewStatusValue | null = null;
    if (lifecycleTarget !== null) {
      const current = await prisma.articleTranslation.findUnique({
        where: { id: recordId },
        select: { reviewStatus: true },
      });
      if (current === null) {
        failed += 1;
        continue;
      }
      if (!evaluateReviewStatusTransition(current.reviewStatus, lifecycleTarget).allowed) {
        rejected += 1;
        continue;
      }
      expected = current.reviewStatus;
    }

    const where = expected === null ? { id: recordId } : { id: recordId, reviewStatus: expected };
    try {
      await prisma.articleTranslation.update({ where, data });
      updated += 1;
    } catch {
      failed += 1;
    }
  }

  if (updated === 0 && failed > 0) return buildBulkActionResult("bulk_update_failed");
  return buildBulkActionResult("bulk_updated", bulkScopeFor("article", parsed.field), {
    updated,
    failed,
    rejected,
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
  // `rejected` fica em 0 neste caminho: bloco NAO tem allowlist de transicao
  // (ver `applyContentBlockAction`). A contagem existe para manter o mesmo
  // formato de resultado dos lotes de artigo.
  const rejected = 0;
  for (const id of parsed.ids) {
    const recordId = BigInt(id);
    const current = await prisma.contentBlock.findUnique({
      where: { id: recordId },
      select: { reviewStatus: true },
    });
    if (current === null) {
      failed += 1;
      continue;
    }

    try {
      await prisma.contentBlock.update({
        where: { id: recordId, reviewStatus: current.reviewStatus },
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
    rejected,
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
