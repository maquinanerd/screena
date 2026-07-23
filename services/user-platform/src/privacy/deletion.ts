/**
 * Exclusao de conta (LGPD) — regras puras (Backend C, unidade C3).
 *
 * PURO: sem rede, sem DB, sem relogio. NAO executa DELETE nem altera dado —
 * produz DECISOES e PLANOS. Fluxo (decisoes secao 7): pedido -> pending_deletion
 * imediato -> janela de arrependimento -> anonimizacao. Determinismo total
 * (`now` e duracao de politica injetados).
 */

import { type DomainResult, err, ok } from "../core/result.js";
import type { ConsentKind, UserStatus } from "../core/types.js";
import { isRevocableConsent, PRIVACY_DURATIONS } from "./policy.js";
import { buildFullRetentionPlan } from "./retention.js";
import type { RetentionDecision } from "./types.js";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Gate de ciclo de vida (bloqueio durante pending_deletion / conta nao-ativa)
// ---------------------------------------------------------------------------

/** Somente conta `active` e operacional para login/sessao/mutacoes. */
export function isOperational(status: UserStatus): boolean {
  return status === "active";
}

/** Conta so cria sessao quando active (pending_deletion/deleted/disabled nao). */
export function assertCanCreateSession(status: UserStatus): DomainResult<true> {
  if (!isOperational(status)) {
    return err("forbidden", "conta indisponivel para autenticacao.");
  }
  return ok(true);
}

/** Mutacoes de produto/consentimento/export exigem conta active (fail-closed). */
export function assertCanMutate(status: UserStatus): DomainResult<true> {
  if (!isOperational(status)) {
    return err("forbidden", "conta indisponivel para esta acao.");
  }
  return ok(true);
}

// ---------------------------------------------------------------------------
// Pedido de exclusao
// ---------------------------------------------------------------------------

/**
 * Decide um pedido de exclusao. So `active`/`disabled` podem pedir; a conta vai
 * IMEDIATAMENTE para `pending_deletion`. Ja em pending_deletion/deleted, ou com
 * pedido de exclusao ATIVO, e conflito (sem duplicidade). Fail-closed.
 */
export function decideDeletionRequest(input: {
  readonly currentStatus: UserStatus;
  readonly hasActiveDeletionRequest: boolean;
}): DomainResult<{ nextStatus: "pending_deletion"; requestStatus: "pending" }> {
  if (input.currentStatus === "pending_deletion" || input.currentStatus === "deleted") {
    return err("conflict", "ja existe uma exclusao em andamento ou concluida.");
  }
  if (input.currentStatus !== "active" && input.currentStatus !== "disabled") {
    return err("forbidden", "estado da conta nao permite solicitar exclusao.");
  }
  if (input.hasActiveDeletionRequest) {
    return err("conflict", "ja existe um pedido de exclusao em andamento.");
  }
  return ok({ nextStatus: "pending_deletion", requestStatus: "pending" });
}

/** Data efetiva da exclusao: requestedAt + carencia (dias de politica). */
export function computeEffectiveDeletionAt(input: {
  readonly requestedAt: Date;
  readonly graceDays?: number;
}): Date {
  const graceDays = input.graceDays ?? PRIVACY_DURATIONS.deletionGraceDays;
  return new Date(input.requestedAt.getTime() + graceDays * DAY_MS);
}

/** true quando ainda estamos DENTRO da janela de arrependimento em `now`. */
export function isWithinGraceWindow(input: {
  readonly requestedAt: Date;
  readonly now: Date;
  readonly graceDays?: number;
}): boolean {
  const effectiveAt = computeEffectiveDeletionAt({
    requestedAt: input.requestedAt,
    graceDays: input.graceDays,
  });
  return input.now.getTime() < effectiveAt.getTime();
}

/**
 * Decide o CANCELAMENTO da exclusao (arrependimento). So enquanto
 * `pending_deletion` e DENTRO da carencia. Apos a efetivacao (`deleted`) ou
 * fora da janela, falha fechado. NAO reativa consentimentos — apenas restaura
 * o status para `active` (o adapter nunca re-concede consent aqui).
 */
export function decideDeletionCancel(input: {
  readonly currentStatus: UserStatus;
  readonly requestedAt: Date;
  readonly now: Date;
  readonly graceDays?: number;
}): DomainResult<{ nextStatus: "active"; reactivateConsents: false }> {
  if (input.currentStatus === "deleted") {
    return err("conflict", "a exclusao ja foi efetivada e nao pode ser cancelada.");
  }
  if (input.currentStatus !== "pending_deletion") {
    return err("precondition_failed", "nao ha exclusao pendente para cancelar.");
  }
  if (
    !isWithinGraceWindow({ requestedAt: input.requestedAt, now: input.now, graceDays: input.graceDays })
  ) {
    return err("precondition_failed", "a janela de arrependimento expirou.");
  }
  return ok({ nextStatus: "active", reactivateConsents: false });
}

// ---------------------------------------------------------------------------
// Plano de exclusao / anonimizacao (aplicado na efetivacao)
// ---------------------------------------------------------------------------

/** Anonimizacao deterministica da identidade da conta (sem PII). */
export interface AccountAnonymization {
  readonly email: string;
  readonly emailNormalized: string;
  readonly handle: null;
  readonly displayName: null;
  readonly status: "deleted";
}

export interface DeletionPlan {
  /** Retencao por categoria (delete/anonymize/retain), ordem canonica. */
  readonly retention: readonly RetentionDecision[];
  /** Anonimizacao da conta (tumba: sem PII, integridade referencial). */
  readonly accountAnonymization: AccountAnonymization;
  readonly revokeAllSessions: true;
  readonly revokeAllTokens: true;
  /** Consentimentos REVOGAVEIS a marcar como revogados; nao-revogaveis retidos. */
  readonly revokeConsentKinds: readonly ConsentKind[];
  /** Reviews/conteudo publico sao removidos/anonimizados via retention acima. */
  readonly effectiveAt: Date;
}

/**
 * Plano de exclusao efetiva (anonimizacao). Deterministico: email vira
 * `deleted-<id>@anonymized.invalid`, handle/displayName caem para null, status
 * `deleted`; sessoes e tokens marcados para revogacao; consentimentos
 * REVOGAVEIS marcados como revogados (ToS/privacy sao RETIDOS como prova);
 * retencao por categoria vem do plano canonico. NAO preserva por conveniencia
 * comercial (razoes controladas apenas).
 */
export function buildDeletionPlan(input: {
  readonly userId: bigint;
  readonly activeConsentKinds: readonly ConsentKind[];
  readonly effectiveAt: Date;
}): DeletionPlan {
  const placeholder = `deleted-${input.userId.toString(10)}@anonymized.invalid`;
  // Ordem canonica preservada; deduplica e mantem so os revogaveis.
  const seen = new Set<ConsentKind>();
  const revokeConsentKinds: ConsentKind[] = [];
  for (const kind of input.activeConsentKinds) {
    if (isRevocableConsent(kind) && !seen.has(kind)) {
      seen.add(kind);
      revokeConsentKinds.push(kind);
    }
  }
  return {
    retention: buildFullRetentionPlan(),
    accountAnonymization: {
      email: placeholder,
      emailNormalized: placeholder,
      handle: null,
      displayName: null,
      status: "deleted",
    },
    revokeAllSessions: true,
    revokeAllTokens: true,
    revokeConsentKinds,
    effectiveAt: input.effectiveAt,
  };
}
