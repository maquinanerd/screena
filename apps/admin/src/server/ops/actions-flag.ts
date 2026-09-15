/**
 * actions-flag.ts — O interruptor e o nonce das acoes do painel. SERVER-ONLY.
 *
 * As acoes do painel operacional nascem LIGADAS: elas so enfileiram trabalho que
 * o agendador ja faz sozinho, com custo mostrado antes e auditoria. O dono
 * desliga todas com `ADMIN_OPS_ACTIONS_ENABLED=false`. (As acoes EDITORIAIS
 * seguem o contrario — nascem desligadas — porque publicar e decisao humana
 * registrada; atualizar um titulo nao e.)
 */

import { randomBytes } from "node:crypto";

/** As acoes do painel estao ligadas? So `false` explicito desliga. */
export function opsActionsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.ADMIN_OPS_ACTIONS_ENABLED ?? "").trim().toLowerCase() !== "false";
}

/** Um nonce novo para UM formulario de confirmacao (24 hex). */
export function newRequestToken(): string {
  return randomBytes(12).toString("hex");
}
