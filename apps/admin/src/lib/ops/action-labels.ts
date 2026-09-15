/**
 * action-labels.ts — Os nomes das acoes e dos desfechos na tela. PURO.
 */

/** `admin_action_audits.action_kind` -> rotulo. */
export const ACTION_KIND_LABELS: Readonly<Record<string, string>> = {
  force_title_detail: "Detalhe do título (cascata)",
  force_title_media: "Mídia do título",
  force_title_seasons: "Temporadas e episódios",
  force_title_ratings: "Nota externa (OMDb)",
  force_title_score: "Recalcular Cinerie Score",
  force_queue: "Ciclo de fila",
};

/** `admin_action_audits.outcome` -> rotulo e tom. */
export const OUTCOME_LABELS: Readonly<Record<string, { readonly text: string; readonly tone: "green" | "amber" | "red" | "neutral" }>> = {
  enqueued: { text: "enfileirado", tone: "green" },
  already_enqueued: { text: "já estava na fila", tone: "amber" },
  refused: { text: "recusado", tone: "red" },
  failed: { text: "falhou", tone: "red" },
};

/** Estado de job/pedido -> tom. */
export function statusTone(status: string | null): "green" | "amber" | "red" | "neutral" {
  if (status === null) return "neutral";
  if (status === "succeeded" || status === "done") return "green";
  if (status === "dead_letter" || status === "failed" || status === "cancelled") return "red";
  if (status === "pending" || status === "claimed" || status === "running" || status === "retry_wait") return "amber";
  return "neutral";
}
