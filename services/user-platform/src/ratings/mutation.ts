/**
 * mutation.ts — Planner puro de mutacao da AVALIACAO DE USUARIO (Backend C,
 * unidade C5A).
 *
 * PURO: sem rede, sem DB, sem relogio (o instante entra por `now`). NAO executa
 * persistencia — resolve a INTENCAO num plano EXPLICITO
 * (create | update | remove | noop) ou num erro de dominio
 * (forbidden | validation_failed). O plano nunca carrega fonte externa,
 * Cinerie Score ou conteudo de review.
 *
 * Semantica de "set" = upsert idempotente:
 *  - nao existe nota   -> create (evento rating_set);
 *  - existe MESMA nota  -> noop   (sem evento, nada muda);
 *  - existe nota DIFERENTE -> update (evento rating_set).
 * Semantica de "remove":
 *  - existe nota -> remove (evento rating_removed);
 *  - nao existe  -> noop   (remocao idempotente de item ausente, nunca erro).
 *
 * Nenhum conflito e "escondido" como sucesso. Tambem NAO ha conflito de VERSAO
 * a detectar: `user_ratings` nao tem coluna `version` (ver policy.ts); a
 * concorrencia e resolvida na persistencia pelo indice unico (user, entidade).
 */

import { type DomainResult, err, ok } from "../core/result.js";
import type { UserStatus } from "../core/types.js";
import { assertRatingMutationAllowed, validateUserRatingValue } from "./policy.js";
import {
  isRatableEntityType,
  type RatableEntityType,
  toHalfStarUnits,
  USER_RATING_SCALE,
  type UserRatingMutationPlan,
  type UserRatingSnapshot,
} from "./types.js";

/** Valida a referencia da entidade avaliada vinda de entrada nao confiavel. */
function validateEntityRef(entityType: string, entityId: bigint): string[] {
  const errors: string[] = [];
  if (!isRatableEntityType(entityType)) {
    errors.push(
      `entityType invalido: "${entityType}" nao pertence a RATABLE_ENTITY_TYPES (movie, tv, season, episode).`,
    );
  }
  if (entityId <= 0n) {
    errors.push("entityId invalido: deve ser um identificador positivo.");
  }
  return errors;
}

export interface PlanRatingSetInput {
  readonly accountStatus: UserStatus;
  readonly entityType: string;
  readonly entityId: bigint;
  readonly value: number;
  readonly scale: number;
  /** Pre-imagem da nota vigente (null = usuario ainda nao avaliou a entidade). */
  readonly current: UserRatingSnapshot | null;
  readonly now: Date;
}

/**
 * Planeja DEFINIR/atualizar a nota. Ordem fail-closed:
 *  1. gate de conta (forbidden se nao-active);
 *  2. validacao de ref + (value, scale), acumulada (validation_failed);
 *  3. resolucao create / noop / update contra a pre-imagem.
 */
export function planRatingSet(input: PlanRatingSetInput): DomainResult<UserRatingMutationPlan> {
  const accountCheck = assertRatingMutationAllowed(input.accountStatus);
  if (!accountCheck.ok) {
    return accountCheck;
  }

  const errors = validateEntityRef(input.entityType, input.entityId);
  errors.push(...validateUserRatingValue(input.value, input.scale).errors);
  if (errors.length > 0) {
    return err("validation_failed", "nota de usuario invalida.", errors);
  }

  // Narrowing seguro: validateEntityRef ja garantiu o tipo.
  const entityType = input.entityType as RatableEntityType;

  if (input.current === null) {
    return ok({
      kind: "create",
      entityType,
      entityId: input.entityId,
      value: input.value,
      scale: USER_RATING_SCALE,
      events: [{ eventType: "rating_set", occurredAt: input.now }],
    });
  }

  // Idempotencia: mesma nota (comparacao canonica em meia-estrelas) = no-op.
  // Nao gera evento novo nem "toca" a linha.
  if (toHalfStarUnits(input.current.value) === toHalfStarUnits(input.value)) {
    return ok({
      kind: "noop",
      entityType,
      entityId: input.entityId,
      value: input.current.value,
      scale: USER_RATING_SCALE,
      events: [],
    });
  }

  return ok({
    kind: "update",
    entityType,
    entityId: input.entityId,
    value: input.value,
    scale: USER_RATING_SCALE,
    events: [{ eventType: "rating_set", occurredAt: input.now }],
  });
}

export interface PlanRatingRemovalInput {
  readonly accountStatus: UserStatus;
  readonly entityType: string;
  readonly entityId: bigint;
  /** Pre-imagem: null = nada para remover (no-op idempotente). */
  readonly current: UserRatingSnapshot | null;
  readonly now: Date;
}

/**
 * Planeja REMOVER a nota. Gate de conta -> validacao de ref -> resolucao:
 * existe => remove (evento rating_removed); nao existe => no-op (sem evento).
 * Remocao repetida de item inexistente e sempre no-op, nunca erro.
 */
export function planRatingRemoval(
  input: PlanRatingRemovalInput,
): DomainResult<UserRatingMutationPlan> {
  const accountCheck = assertRatingMutationAllowed(input.accountStatus);
  if (!accountCheck.ok) {
    return accountCheck;
  }

  const errors = validateEntityRef(input.entityType, input.entityId);
  if (errors.length > 0) {
    return err("validation_failed", "referencia de nota invalida.", errors);
  }

  const entityType = input.entityType as RatableEntityType;

  if (input.current === null) {
    return ok({
      kind: "noop",
      entityType,
      entityId: input.entityId,
      value: null,
      scale: USER_RATING_SCALE,
      events: [],
    });
  }

  return ok({
    kind: "remove",
    entityType,
    entityId: input.entityId,
    value: null,
    scale: USER_RATING_SCALE,
    events: [{ eventType: "rating_removed", occurredAt: input.now }],
  });
}
