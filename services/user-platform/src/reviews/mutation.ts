/**
 * mutation.ts — Planner puro das mutacoes do AUTOR sobre a propria review
 * (Backend C, unidade C5B).
 *
 * PURO: sem rede, sem DB, sem relogio (o instante entra por `now`). NAO executa
 * persistencia — resolve a INTENCAO num plano EXPLICITO
 * (create | update | withdraw | restore | noop) ou num erro de dominio
 * (forbidden | validation_failed). O plano carrega SO conceitos de review;
 * nunca nota numerica, fonte externa ou Cinerie Score.
 *
 * LACUNAS REGISTRADAS:
 *  - Sem coluna `version` e sem unique (user, entidade): a criacao SEMPRE cria
 *    (nao ha conflito por unique/versao a detectar aqui). Idempotencia recai
 *    sobre edit/spoiler/visibility/withdraw. Concorrencia fica para a
 *    persistencia (transacao + pre-imagem).
 *  - Withdraw/restore do AUTOR nao estao nas decisoes de produto (so a soft
 *    delete de moderacao). Modelado de forma conservadora sobre `deletedAt`,
 *    SEM tocar `status`; `status = removed` fica reservado a MODERACAO e um
 *    restore do autor NUNCA desfaz um takedown de moderacao (POLICY_GAP).
 *  - Editar o conteudo de uma review `approved` a devolve para `pending`
 *    (publishedAt = null): conteudo editado nao permanece publico sem
 *    re-moderacao (anti-abuso, fail-closed; POLICY a confirmar).
 */

import { type DomainResult, err, ok } from "../core/result.js";
import type { UserStatus, Visibility } from "../core/types.js";
import { assertAuthorMutationAllowed, isVisibility } from "./policy.js";
import { sanitizeReviewText, validateReviewSubmission } from "./review.js";
import {
  isReviewableEntityType,
  type ReviewableEntityType,
  type ReviewMutationPlan,
  type ReviewSnapshot,
} from "./types.js";

/** Normaliza titulo opcional: sanitiza; vazio apos sanitizacao vira null. */
function normalizeTitle(title: string | undefined): string | null {
  if (title === undefined) {
    return null;
  }
  const sanitized = sanitizeReviewText(title);
  return sanitized.length === 0 ? null : sanitized;
}

/** noop reutilizavel a partir da pre-imagem (nada muda). */
function noopPlan(current: ReviewSnapshot): ReviewMutationPlan {
  return {
    kind: "noop",
    entityType: current.entityType,
    entityId: current.entityId,
    changes: {},
  };
}

// ---------------------------------------------------------------------------
// Criacao
// ---------------------------------------------------------------------------

export interface PlanCreateReviewInput {
  readonly accountStatus: UserStatus;
  readonly entityType: string;
  readonly entityId: bigint;
  readonly title?: string;
  readonly body: string;
  readonly containsSpoiler: boolean;
  /** Visibilidade escolhida pelo autor; default `private` (tudo nasce privado). */
  readonly visibility?: Visibility;
  readonly now: Date;
}

/**
 * Planeja CRIAR uma review. Nasce sempre `pending` (moderacao) e, por padrao,
 * `private`. Gate de conta -> validacao de ref/conteudo/visibilidade -> plano.
 */
export function planCreateReview(input: PlanCreateReviewInput): DomainResult<ReviewMutationPlan> {
  const accountCheck = assertAuthorMutationAllowed(input.accountStatus);
  if (!accountCheck.ok) {
    return accountCheck;
  }

  const errors: string[] = [];
  if (!isReviewableEntityType(input.entityType)) {
    errors.push(
      `entityType invalido: "${input.entityType}" nao e revisavel (movie, tv, season, episode).`,
    );
  }
  if (input.entityId <= 0n) {
    errors.push("entityId invalido: deve ser um identificador positivo.");
  }
  errors.push(
    ...validateReviewSubmission({
      title: input.title,
      body: input.body,
      containsSpoiler: input.containsSpoiler,
    }).errors,
  );
  if (input.visibility !== undefined && !isVisibility(input.visibility)) {
    errors.push(`visibilidade invalida: "${String(input.visibility)}".`);
  }
  if (errors.length > 0) {
    return err("validation_failed", "review invalida.", errors);
  }

  const entityType = input.entityType as ReviewableEntityType;

  return ok({
    kind: "create",
    entityType,
    entityId: input.entityId,
    changes: {
      title: normalizeTitle(input.title),
      body: sanitizeReviewText(input.body),
      containsSpoiler: input.containsSpoiler,
      visibility: input.visibility ?? "private",
      status: "pending",
      publishedAt: null,
      deletedAt: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Edicao de conteudo (titulo + corpo)
// ---------------------------------------------------------------------------

export interface PlanEditReviewInput {
  readonly accountStatus: UserStatus;
  readonly current: ReviewSnapshot;
  readonly title?: string;
  readonly body: string;
  readonly now: Date;
}

/**
 * Planeja EDITAR titulo/corpo. Bloqueia review removida por moderacao
 * (forbidden). Sem alteracao real = noop. Se a review estava `approved`, a
 * edicao a devolve para `pending` (re-moderacao; conteudo editado nao segue
 * publico sem revisao).
 */
export function planEditReview(input: PlanEditReviewInput): DomainResult<ReviewMutationPlan> {
  const accountCheck = assertAuthorMutationAllowed(input.accountStatus);
  if (!accountCheck.ok) {
    return accountCheck;
  }

  if (input.current.status === "removed") {
    return err("forbidden", "review removida por moderacao nao pode ser editada.");
  }

  const errors = validateReviewSubmission({
    title: input.title,
    body: input.body,
    containsSpoiler: input.current.containsSpoiler,
  }).errors;
  if (errors.length > 0) {
    return err("validation_failed", "review invalida.", errors);
  }

  const nextTitle = normalizeTitle(input.title);
  const nextBody = sanitizeReviewText(input.body);

  if (nextTitle === input.current.title && nextBody === input.current.body) {
    return ok(noopPlan(input.current));
  }

  const reModerate = input.current.status === "approved";
  return ok({
    kind: "update",
    entityType: input.current.entityType,
    entityId: input.current.entityId,
    changes: {
      title: nextTitle,
      body: nextBody,
      ...(reModerate ? { status: "pending" as const, publishedAt: null } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Spoiler (marcar / desmarcar)
// ---------------------------------------------------------------------------

export interface PlanSetSpoilerInput {
  readonly accountStatus: UserStatus;
  readonly current: ReviewSnapshot;
  readonly containsSpoiler: boolean;
  readonly now: Date;
}

/** Planeja marcar/desmarcar spoiler. noop se ja esta no valor pedido. */
export function planSetSpoiler(input: PlanSetSpoilerInput): DomainResult<ReviewMutationPlan> {
  const accountCheck = assertAuthorMutationAllowed(input.accountStatus);
  if (!accountCheck.ok) {
    return accountCheck;
  }
  if (typeof input.containsSpoiler !== "boolean") {
    return err("validation_failed", "containsSpoiler invalido: deve ser booleano explicito.");
  }
  if (input.current.status === "removed") {
    return err("forbidden", "review removida por moderacao nao pode ser alterada.");
  }
  if (input.current.containsSpoiler === input.containsSpoiler) {
    return ok(noopPlan(input.current));
  }
  return ok({
    kind: "update",
    entityType: input.current.entityType,
    entityId: input.current.entityId,
    changes: { containsSpoiler: input.containsSpoiler },
  });
}

// ---------------------------------------------------------------------------
// Visibilidade
// ---------------------------------------------------------------------------

export interface PlanSetVisibilityInput {
  readonly accountStatus: UserStatus;
  readonly current: ReviewSnapshot;
  readonly visibility: Visibility;
  readonly now: Date;
}

/**
 * Planeja alterar a visibilidade escolhida pelo autor. noop se ja e a atual.
 * Publicar (public) NAO renderiza sozinho: continua dependendo de aprovacao de
 * moderacao (ver canRenderPublicly). Visibilidade do autor != aprovacao.
 */
export function planSetVisibility(
  input: PlanSetVisibilityInput,
): DomainResult<ReviewMutationPlan> {
  const accountCheck = assertAuthorMutationAllowed(input.accountStatus);
  if (!accountCheck.ok) {
    return accountCheck;
  }
  if (!isVisibility(input.visibility)) {
    return err("validation_failed", `visibilidade invalida: "${String(input.visibility)}".`);
  }
  if (input.current.status === "removed") {
    return err("forbidden", "review removida por moderacao nao pode ser alterada.");
  }
  if (input.current.visibility === input.visibility) {
    return ok(noopPlan(input.current));
  }
  return ok({
    kind: "update",
    entityType: input.current.entityType,
    entityId: input.current.entityId,
    changes: { visibility: input.visibility },
  });
}

// ---------------------------------------------------------------------------
// Retirada / restauracao (soft delete do AUTOR sobre `deletedAt`)
// ---------------------------------------------------------------------------

export interface PlanWithdrawInput {
  readonly accountStatus: UserStatus;
  readonly current: ReviewSnapshot;
  readonly now: Date;
}

/** Planeja RETIRAR a review (deletedAt = now). Ja retirada/removida => noop. */
export function planWithdrawReview(input: PlanWithdrawInput): DomainResult<ReviewMutationPlan> {
  const accountCheck = assertAuthorMutationAllowed(input.accountStatus);
  if (!accountCheck.ok) {
    return accountCheck;
  }
  if (input.current.deletedAt !== null) {
    return ok(noopPlan(input.current));
  }
  return ok({
    kind: "withdraw",
    entityType: input.current.entityType,
    entityId: input.current.entityId,
    changes: { deletedAt: input.now },
  });
}

export interface PlanRestoreInput {
  readonly accountStatus: UserStatus;
  readonly current: ReviewSnapshot;
  readonly now: Date;
}

/**
 * Planeja RESTAURAR a review (deletedAt = null). Ja ativa => noop. Um takedown
 * de MODERACAO (status = removed) NUNCA e restauravel pelo autor (forbidden).
 */
export function planRestoreReview(input: PlanRestoreInput): DomainResult<ReviewMutationPlan> {
  const accountCheck = assertAuthorMutationAllowed(input.accountStatus);
  if (!accountCheck.ok) {
    return accountCheck;
  }
  if (input.current.status === "removed") {
    return err("forbidden", "review removida por moderacao nao pode ser restaurada pelo autor.");
  }
  if (input.current.deletedAt === null) {
    return ok(noopPlan(input.current));
  }
  return ok({
    kind: "restore",
    entityType: input.current.entityType,
    entityId: input.current.entityId,
    changes: { deletedAt: null },
  });
}
