/**
 * moderation.ts — Moderacao de reviews, denuncias e bloqueios (Backend C).
 *
 * PURO: nao faz rede, DB nem IO; recebe `now: Date` por parametro.
 *
 * Decisoes de dominio:
 *  - Maquina de estados de moderacao e FECHADA: pending -> approved|rejected;
 *    approved -> removed; rejected -> pending (reedicao); removed e terminal.
 *  - Decisao de moderacao exige HUMANO identificado (decidedBy nao-vazio) —
 *    nunca decisao automatica anonima.
 *  - publishedAt so existe quando approved (coerente com o CHECK do banco:
 *    published_at exige approved).
 *  - Mensagens nunca vazam conteudo de terceiros nem permitem enumeracao.
 */

import { collect, type DomainResult, err, ok, type ValidationResult } from "../core/result.js";
import {
  REPORT_REASONS,
  type ReportReason,
  type ReportStatus,
  type ReviewModerationStatus,
} from "../core/types.js";
import type { ModerationPlan } from "./types.js";

/** Limite de detalhe livre em uma denuncia. */
export const REPORT_DETAIL_MAX_LENGTH = 2000 as const;

/** Limite da nota interna de moderacao (nunca vai para projecao publica). */
export const MODERATION_NOTE_MAX_LENGTH = 2000 as const;

/**
 * Transicoes validas da maquina de estados de moderacao.
 * "removed" nao aparece como origem: estado terminal.
 */
const MODERATION_TRANSITIONS: Readonly<
  Record<ReviewModerationStatus, ReadonlySet<ReviewModerationStatus>>
> = {
  pending: new Set<ReviewModerationStatus>(["approved", "rejected"]),
  approved: new Set<ReviewModerationStatus>(["removed"]),
  rejected: new Set<ReviewModerationStatus>(["pending"]),
  removed: new Set<ReviewModerationStatus>(),
};

/** True quando a transicao from -> to pertence a maquina de estados. */
export function isValidModerationTransition(
  from: ReviewModerationStatus,
  to: ReviewModerationStatus,
): boolean {
  return MODERATION_TRANSITIONS[from].has(to);
}

/**
 * Aplica uma decisao de moderacao humana sobre uma review.
 *
 * Regras:
 *  - decidedBy (humano) nao-vazio obrigatorio;
 *  - transicao current -> decision precisa ser valida;
 *  - decision approved => publishedAt = now; qualquer outra => null.
 */
export function applyModerationDecision(input: {
  readonly current: ReviewModerationStatus;
  readonly decision: ReviewModerationStatus;
  readonly decidedBy: string;
  readonly now: Date;
}): DomainResult<{ status: ReviewModerationStatus; publishedAt: Date | null }> {
  if (input.decidedBy.trim().length === 0) {
    return err("validation_failed", "decisao de moderacao exige revisor humano identificado.", [
      "decidedBy nao pode ser vazio",
    ]);
  }
  if (!isValidModerationTransition(input.current, input.decision)) {
    return err(
      "conflict",
      `transicao de moderacao invalida: "${input.current}" -> "${input.decision}".`,
    );
  }
  return ok({
    status: input.decision,
    publishedAt: input.decision === "approved" ? input.now : null,
  });
}

const REPORT_REASON_SET: ReadonlySet<string> = new Set(REPORT_REASONS);

/**
 * Planeja uma decisao de moderacao (plano explicito `moderate` | `noop`).
 * Envolve a maquina de estados (nao a reimplementa) e adiciona:
 *  - revisor humano identificado obrigatorio (decidedBy);
 *  - `reasonCode` fechado (reutiliza REPORT_REASONS) e `moderationNote`
 *    limitado — ambos NUNCA vao para a projecao publica e NAO tem coluna
 *    dedicada em `user_reviews` (destino: audit sink futuro — SCHEMA_CLEANUP);
 *  - deteccao de no-op (decidir o estado atual nao gera escrita);
 *  - transicao invalida => conflict (nunca escondida como sucesso).
 *
 * Optimistic locking: `user_reviews` nao tem coluna `version` — nao ha
 * expectedVersion (POLICY_GAP registrado em types.ts). A pre-imagem
 * (currentStatus/currentPublishedAt) deixa o plano transaction-ready.
 */
export function planModeration(input: {
  readonly currentStatus: ReviewModerationStatus;
  readonly currentPublishedAt: Date | null;
  readonly decision: ReviewModerationStatus;
  readonly decidedBy: string;
  readonly reasonCode?: ReportReason;
  readonly moderationNote?: string;
  readonly now: Date;
}): DomainResult<ModerationPlan> {
  if (input.decidedBy.trim().length === 0) {
    return err("validation_failed", "decisao de moderacao exige revisor humano identificado.", [
      "decidedBy nao pode ser vazio",
    ]);
  }
  if (input.reasonCode !== undefined && !REPORT_REASON_SET.has(input.reasonCode)) {
    return err("validation_failed", "reasonCode de moderacao invalido.", [
      `reasonCode deve pertencer a REPORT_REASONS (${REPORT_REASONS.join(", ")})`,
    ]);
  }
  if (
    input.moderationNote !== undefined &&
    input.moderationNote.length > MODERATION_NOTE_MAX_LENGTH
  ) {
    return err("validation_failed", "nota interna de moderacao excede o limite.", [
      `moderationNote deve ter no maximo ${MODERATION_NOTE_MAX_LENGTH} caracteres`,
    ]);
  }

  const reasonCode = input.reasonCode ?? null;
  const moderationNote = input.moderationNote ?? null;

  // No-op: decidir o estado atual nao gera escrita nem republica.
  if (input.decision === input.currentStatus) {
    return ok({
      kind: "noop",
      changes: { status: input.currentStatus, publishedAt: input.currentPublishedAt },
      decidedBy: input.decidedBy,
      reasonCode,
      moderationNote,
    });
  }

  const decided = applyModerationDecision({
    current: input.currentStatus,
    decision: input.decision,
    decidedBy: input.decidedBy,
    now: input.now,
  });
  if (!decided.ok) {
    return decided;
  }

  return ok({
    kind: "moderate",
    changes: { status: decided.value.status, publishedAt: decided.value.publishedAt },
    decidedBy: input.decidedBy,
    reasonCode,
    moderationNote,
  });
}

/**
 * Valida uma denuncia de review: reason canonica (REPORT_REASONS) e
 * detail opcional limitado. Acumula todas as violacoes.
 */
export function validateReport(input: {
  readonly reason: string;
  readonly detail?: string;
}): ValidationResult {
  const errors: string[] = [];

  if (!REPORT_REASON_SET.has(input.reason)) {
    errors.push(
      `reason invalida: "${input.reason}" nao pertence a REPORT_REASONS (${REPORT_REASONS.join(", ")}).`,
    );
  }

  if (input.detail !== undefined && input.detail.length > REPORT_DETAIL_MAX_LENGTH) {
    errors.push(
      `detail invalido: maximo de ${REPORT_DETAIL_MAX_LENGTH} caracteres (recebido ${input.detail.length}).`,
    );
  }

  return collect(errors);
}

/** Resolucoes terminais permitidas para uma denuncia aberta. */
const REPORT_RESOLUTIONS: ReadonlySet<ReportStatus> = new Set<ReportStatus>([
  "reviewed",
  "dismissed",
  "actioned",
]);

/**
 * Resolve uma denuncia: apenas open -> reviewed|dismissed|actioned, com
 * resolvedBy humano nao-vazio. Denuncia ja resolvida nao reabre aqui.
 */
export function resolveReport(input: {
  readonly current: ReportStatus;
  readonly resolution: ReportStatus;
  readonly resolvedBy: string;
  readonly now: Date;
}): DomainResult<{ status: ReportStatus; resolvedAt: Date; resolvedBy: string }> {
  if (input.resolvedBy.trim().length === 0) {
    return err("validation_failed", "resolucao de denuncia exige revisor humano identificado.", [
      "resolvedBy nao pode ser vazio",
    ]);
  }
  if (input.current !== "open") {
    return err("conflict", "apenas denuncias abertas podem ser resolvidas.");
  }
  if (!REPORT_RESOLUTIONS.has(input.resolution)) {
    return err("validation_failed", "resolucao de denuncia invalida.", [
      `resolution deve ser uma de: reviewed, dismissed, actioned (recebido "${input.resolution}")`,
    ]);
  }
  return ok({
    status: input.resolution,
    resolvedAt: input.now,
    resolvedBy: input.resolvedBy,
  });
}

/**
 * Valida um bloqueio entre usuarios: auto-bloqueio proibido e ids
 * positivos obrigatorios. Mensagens nao revelam existencia de contas.
 */
export function validateBlock(input: {
  readonly blockerId: bigint;
  readonly blockedId: bigint;
}): ValidationResult {
  const errors: string[] = [];

  if (input.blockerId <= 0n) {
    errors.push("blockerId invalido: deve ser um identificador positivo.");
  }
  if (input.blockedId <= 0n) {
    errors.push("blockedId invalido: deve ser um identificador positivo.");
  }
  if (input.blockerId === input.blockedId) {
    errors.push("auto-bloqueio proibido: um usuario nao pode bloquear a si mesmo.");
  }

  return collect(errors);
}
