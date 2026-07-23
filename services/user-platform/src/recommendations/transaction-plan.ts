/**
 * transaction-plan.ts — Plano transaction-ready de publicacao do snapshot (C6B).
 *
 * PURO e DETERMINISTICO. NAO executa persistencia, NAO contem SQL nem Prisma,
 * NAO carrega entidade completa do catalogo. Produz um PLANO DISCRIMINADO que
 * descreve, em vocabulario neutro, as OPERACOES e PRE-CONDICOES que a transacao
 * futura (C7) devera cumprir. Conflito e SEMPRE explicito — nunca vira replace
 * silencioso.
 *
 * Garantia de "no maximo um atual": o schema tem indice unico PARCIAL
 * `(user_id) WHERE is_current = true`. O plano de replace/renew SEMPRE rebaixa o
 * atual esperado (demote) ANTES de inserir o novo como current, na MESMA
 * transacao; se um writer concorrente ja tiver trocado o atual, o demote
 * condicional afeta 0 linhas e C7 levanta conflito (ou o insert viola o unico) —
 * jamais restam dois current.
 */

import type { UserStatus } from "../core/types.js";
import {
  type CurrentSnapshotSummary,
  evaluateSnapshotState,
  type SnapshotStateKind,
} from "./renewal.js";
import type { BuiltSnapshot, PersistableSnapshotRecord } from "./snapshot.js";
import { isValidEpochMillis } from "./time.js";
import type { SnapshotPolicy } from "./types.js";

/** Operacao neutra que C7 traduz para Prisma/SQL. Nunca contem SQL aqui. */
export type SnapshotOperation =
  | {
      readonly op: "demote_current";
      readonly ownerUserId: bigint;
      readonly snapshotId: bigint;
      /** Pre-condicao: a linha deve estar `is_current=true` (senao => conflito em C7). */
      readonly expectIsCurrent: true;
    }
  | {
      readonly op: "insert_snapshot";
      readonly record: PersistableSnapshotRecord;
      readonly isCurrent: boolean;
    };

/** Pre-condicoes que a transacao futura deve honrar (optimistic concurrency). */
export interface SnapshotPreconditions {
  readonly ownerUserId: bigint;
  /** Id do snapshot atual esperado na leitura (null = esperava nenhum). */
  readonly expectedCurrentSnapshotId: bigint | null;
  /** Tudo numa unica transacao. */
  readonly atomicTransaction: true;
  /** Reforca o indice unico parcial (user_id) WHERE is_current. */
  readonly enforceSingleCurrent: true;
}

export type SnapshotPublicationPlan =
  | {
      readonly kind: "create" | "replace" | "renew" | "invalidate";
      readonly stateKind: SnapshotStateKind | "explicit_invalidation";
      readonly operations: readonly SnapshotOperation[];
      readonly preconditions: SnapshotPreconditions;
    }
  | { readonly kind: "noop"; readonly stateKind: SnapshotStateKind | "no_current"; readonly reason: string }
  | {
      readonly kind: "conflict";
      readonly expectedCurrentSnapshotId: bigint | null;
      readonly actualCurrentSnapshotId: bigint | null;
    }
  | { readonly kind: "invalid"; readonly errors: readonly string[] }
  | { readonly kind: "forbidden"; readonly reason: string };

function bigintEq(a: bigint | null, b: bigint | null): boolean {
  if (a === null || b === null) return a === b;
  return a === b;
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface PlanSnapshotPublicationInput {
  readonly ownerUserId: bigint;
  readonly built: BuiltSnapshot;
  readonly current: CurrentSnapshotSummary | null;
  /** O que o chamador LEU como atual (base do optimistic locking). */
  readonly expectedCurrentSnapshotId: bigint | null;
  readonly accountStatus: UserStatus;
  readonly now: number;
  readonly policy: SnapshotPolicy;
}

/**
 * Resolve o plano de publicacao. Precedencia: conta -> validade do built ->
 * concorrencia (conflito) -> estado do snapshot. Total e sem excecao.
 */
export function planSnapshotPublication(
  input: PlanSnapshotPublicationInput,
): SnapshotPublicationPlan {
  if (input.accountStatus !== "active") {
    return { kind: "forbidden", reason: "conta indisponivel para publicar recomendacoes." };
  }

  const built = input.built;
  const errors: string[] = [];
  if (typeof input.ownerUserId !== "bigint" || input.ownerUserId <= 0n) {
    errors.push("ownerUserId invalido");
  }
  if (built.record.ownerUserId !== input.ownerUserId) {
    errors.push("owner do snapshot construido diverge do ownerUserId do plano");
  }
  if (!nonBlank(built.fingerprint)) errors.push("fingerprint ausente no snapshot construido");
  if (!nonBlank(built.record.algorithmVersion)) errors.push("algorithmVersion ausente");
  if (!nonBlank(built.payload.policyVersion)) errors.push("policyVersion ausente");
  if (!isValidEpochMillis(input.now)) errors.push("now (epoch-ms) invalido");
  if (errors.length > 0) {
    return { kind: "invalid", errors };
  }

  // Optimistic concurrency: o atual REAL tem de bater com o esperado na leitura.
  const actualCurrentId = input.current === null ? null : input.current.snapshotId;
  if (!bigintEq(input.expectedCurrentSnapshotId, actualCurrentId)) {
    return {
      kind: "conflict",
      expectedCurrentSnapshotId: input.expectedCurrentSnapshotId,
      actualCurrentSnapshotId: actualCurrentId,
    };
  }

  const state = evaluateSnapshotState({
    current: input.current,
    desired: {
      fingerprint: built.fingerprint,
      algorithmVersion: built.record.algorithmVersion,
      policyVersion: built.payload.policyVersion,
    },
    now: input.now,
    policy: input.policy,
  });

  const preconditions: SnapshotPreconditions = {
    ownerUserId: input.ownerUserId,
    expectedCurrentSnapshotId: input.expectedCurrentSnapshotId,
    atomicTransaction: true,
    enforceSingleCurrent: true,
  };
  const insertOp: SnapshotOperation = {
    op: "insert_snapshot",
    record: built.record,
    isCurrent: true,
  };
  const demoteOp = (): SnapshotOperation => ({
    op: "demote_current",
    ownerUserId: input.ownerUserId,
    // current e nao-nulo em replace/renew (estado != missing/invalid).
    snapshotId: input.current!.snapshotId,
    expectIsCurrent: true,
  });

  switch (state.kind) {
    case "invalid":
      return { kind: "invalid", errors: state.reasons ?? ["estado do snapshot invalido"] };
    case "missing":
      // create: NUNCA rebaixa snapshot inexistente (sem demote).
      return { kind: "create", stateKind: state.kind, operations: [insertOp], preconditions };
    case "fingerprint_changed":
    case "algorithm_outdated":
    case "policy_outdated":
      return {
        kind: "replace",
        stateKind: state.kind,
        operations: [demoteOp(), insertOp],
        preconditions,
      };
    case "current_expired":
      return {
        kind: "renew",
        stateKind: state.kind,
        operations: [demoteOp(), insertOp],
        preconditions,
      };
    case "current_expiring":
      if (input.policy.renewOnExpiring) {
        return {
          kind: "renew",
          stateKind: state.kind,
          operations: [demoteOp(), insertOp],
          preconditions,
        };
      }
      return { kind: "noop", stateKind: state.kind, reason: "atual equivalente ainda valido (expiring)." };
    case "current_valid":
      return { kind: "noop", stateKind: state.kind, reason: "atual equivalente e valido." };
    default: {
      const exhaustive: never = state.kind;
      return { kind: "invalid", errors: [`estado nao tratado: ${String(exhaustive)}`] };
    }
  }
}

export interface PlanSnapshotInvalidationInput {
  readonly ownerUserId: bigint;
  readonly current: CurrentSnapshotSummary | null;
  readonly expectedCurrentSnapshotId: bigint | null;
  readonly accountStatus: UserStatus;
}

/**
 * Planeja a invalidacao (rebaixar o atual sem criar novo). Sem atual = noop;
 * divergencia de concorrencia = conflict; conta inativa = forbidden.
 */
export function planSnapshotInvalidation(
  input: PlanSnapshotInvalidationInput,
): SnapshotPublicationPlan {
  if (input.accountStatus !== "active") {
    return { kind: "forbidden", reason: "conta indisponivel para invalidar recomendacoes." };
  }
  if (typeof input.ownerUserId !== "bigint" || input.ownerUserId <= 0n) {
    return { kind: "invalid", errors: ["ownerUserId invalido"] };
  }

  const actualCurrentId = input.current === null ? null : input.current.snapshotId;
  if (!bigintEq(input.expectedCurrentSnapshotId, actualCurrentId)) {
    return {
      kind: "conflict",
      expectedCurrentSnapshotId: input.expectedCurrentSnapshotId,
      actualCurrentSnapshotId: actualCurrentId,
    };
  }
  if (input.current === null) {
    return { kind: "noop", stateKind: "no_current", reason: "nao ha snapshot atual para invalidar." };
  }
  return {
    kind: "invalidate",
    stateKind: "explicit_invalidation",
    operations: [
      {
        op: "demote_current",
        ownerUserId: input.ownerUserId,
        snapshotId: input.current.snapshotId,
        expectIsCurrent: true,
      },
    ],
    preconditions: {
      ownerUserId: input.ownerUserId,
      expectedCurrentSnapshotId: input.expectedCurrentSnapshotId,
      atomicTransaction: true,
      enforceSingleCurrent: true,
    },
  };
}
