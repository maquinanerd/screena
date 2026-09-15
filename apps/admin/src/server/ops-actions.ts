"use server";

/**
 * ops-actions.ts — As ACOES do painel operacional (Server Actions). SERVER-ONLY.
 *
 * SEGUNDO arquivo do admin autorizado a ter `"use server"` (o primeiro e
 * `editorial-actions.ts`). Travado por `tests/admin/no-server-writes.test.ts`,
 * `tests/admin/no-write-endpoints.test.ts` e `tests/admin/ops-actions-guard.test.ts`.
 *
 * O QUE ESTE ARQUIVO FAZ
 *   - forcar detalhe, midia ou temporadas de UM titulo -> catalog_jobs
 *   - forcar a nota externa ou o Score de UM titulo, e UM ciclo de fila ->
 *     scheduler_force_requests, que o screen-cron atende no proximo tique
 *   - buscar usuario por trecho de e-mail (LEITURA, por POST: e-mail nunca vai
 *     para a URL)
 *
 * O QUE ELE NAO FAZ
 *   Nao apaga nada; nao muda licenca nem display_allowed; nao altera cadencia nem
 *   teto de fila; nao para, reinicia nem implanta servico; nao exporta e-mail.
 *   Nenhum metodo de escrita do Prisma aparece aqui: a unica porta de escrita e
 *   `@screena/sync/admin-actions`, que so faz INSERT em tres tabelas.
 *
 * TRES TRAVAS
 *   1. ACESSO: o middleware exige Basic Auth em producao (fail-closed).
 *   2. INTERRUPTOR: `ADMIN_OPS_ACTIONS_ENABLED=false` desliga todas as acoes.
 *   3. CUSTO: a estimativa e REFEITA aqui, com o banco de agora — o formulario
 *      nunca diz quanto custa. Recusa (cota acabou, titulo sem imdb_id) vira
 *      auditoria `refused`, sem enfileirar nada.
 *
 * O nonce do formulario (`token`) faz o reenvio do MESMO formulario ser uma acao
 * so. Nada aqui escreve log: o termo buscado nao aparece em lugar nenhum alem da
 * resposta.
 */

import { redirect } from "next/navigation";
import {
  ADMIN_ACTION_KIND_BY_TITLE_ACTION,
  isAdminCatalogAction,
  isAdminRequestToken,
  isAdminTitleAction,
} from "@screena/sync/admin-action-plan";
import {
  enqueueAdminCatalogRefresh,
  recordRefusedAdminAction,
  requestAdminSchedulerRun,
  type AdminActionResult,
  type AdminActor,
} from "@screena/sync/admin-actions";

import { isAdminProtectionRequired } from "../lib/access-protection";
import { estimateQueueAction, estimateTitleAction } from "../lib/ops/estimate";
import { parseEntityId, parseTitleSegment, titlePath } from "../lib/ops/title-routes";
import { opsActionsEnabled } from "./ops/actions-flag";
import { opsDb } from "./ops/db";
import { getQueueCostInputs, isSchedulerQueue } from "./ops/queues";
import { readOmdbSpentToday, readTitleIdentity, titleShapeOf } from "./ops/titles";
import { searchUsersByEmail, type EmailSearchResult } from "./ops/users";

/** Quem esta agindo. A credencial e compartilhada: o rotulo nao identifica pessoa. */
function currentActor(): AdminActor {
  const required = isAdminProtectionRequired({
    ADMIN_PROTECTION_ENABLED: process.env.ADMIN_PROTECTION_ENABLED,
    ADMIN_BASIC_AUTH_USER: undefined,
    ADMIN_BASIC_AUTH_PASSWORD: undefined,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });
  const label = (process.env.ADMIN_OPERATOR_LABEL ?? "").trim().slice(0, 120);
  return required
    ? { kind: "basic_auth_shared", label: label || "credencial compartilhada do painel" }
    : { kind: "open_development", label: label || "desenvolvimento local sem proteção" };
}

/** Confirma a acao sobre UM titulo. */
export async function forceTitleAction(formData: FormData): Promise<void> {
  const kind = parseTitleSegment(String(formData.get("tipo") ?? ""));
  const id = parseEntityId(String(formData.get("id") ?? ""));
  const action = String(formData.get("acao") ?? "");
  const token = String(formData.get("token") ?? "");
  if (kind === null || id === null || !isAdminTitleAction(action) || !isAdminRequestToken(token)) {
    redirect("/acoes?erro=pedido_invalido");
  }
  const back = titlePath(kind, id);
  if (!opsActionsEnabled()) redirect(`${back}?erro=acoes_desligadas`);

  let target: string;
  try {
    const now = new Date();
    const db = opsDb();
    const identity = await readTitleIdentity(db, kind, id);
    if (identity === null) {
      target = `${back}?erro=titulo_inexistente`;
    } else {
      const omdbSpent = action === "nota" ? await readOmdbSpentToday(now) : null;
      const estimate = estimateTitleAction(action, titleShapeOf(identity), {
        spentToday: omdbSpent !== null && omdbSpent.ok ? omdbSpent.value : null,
      });
      const titleTarget = { entityType: kind, entityId: id, tmdbId: identity.tmdbId };
      const actor = currentActor();
      let result: AdminActionResult;
      if (estimate.refusal !== null) {
        result = await recordRefusedAdminAction(db, {
          kind: ADMIN_ACTION_KIND_BY_TITLE_ACTION[action],
          target: titleTarget,
          queue: null,
          actor,
          token,
          estimate,
          reason: estimate.refusal,
          now,
        });
      } else if (isAdminCatalogAction(action)) {
        result = await enqueueAdminCatalogRefresh(db, { action, target: titleTarget, actor, token, estimate, now });
      } else {
        result = await requestAdminSchedulerRun(db, {
          request: { kind: action === "nota" ? "title_ratings" : "title_score", target: titleTarget },
          actor,
          token,
          estimate,
          now,
        });
      }
      target = `/acoes/${result.auditId}`;
    }
  } catch {
    // Motivo generico: a mensagem crua poderia carregar SQL ou host.
    target = `${back}?erro=falha_ao_enfileirar`;
  }
  redirect(target);
}

/** Confirma UM ciclo forcado de fila. */
export async function forceQueueAction(formData: FormData): Promise<void> {
  const queue = String(formData.get("fila") ?? "");
  const token = String(formData.get("token") ?? "");
  if (!isSchedulerQueue(queue) || !isAdminRequestToken(token)) redirect("/acoes?erro=pedido_invalido");
  const back = `/filas/${queue}`;
  if (!opsActionsEnabled()) redirect(`${back}?erro=acoes_desligadas`);

  let target: string;
  try {
    const now = new Date();
    const db = opsDb();
    const inputs = await getQueueCostInputs(queue, now);
    const estimate = estimateQueueAction(queue, inputs.context);
    const actor = currentActor();
    const result =
      estimate.refusal !== null
        ? await recordRefusedAdminAction(db, {
            kind: "force_queue",
            target: null,
            queue,
            actor,
            token,
            estimate,
            reason: estimate.refusal,
            now,
          })
        : await requestAdminSchedulerRun(db, { request: { kind: "queue", queue }, actor, token, estimate, now });
    target = `/acoes/${result.auditId}`;
  } catch {
    target = `${back}?erro=falha_ao_enfileirar`;
  }
  redirect(target);
}

/** Busca usuarios por trecho de e-mail. LEITURA; o termo nunca vai para URL nem log. */
export async function searchUserEmailsAction(
  _previous: EmailSearchResult | null,
  formData: FormData,
): Promise<EmailSearchResult | null> {
  return searchUsersByEmail(formData.get("termo"));
}
