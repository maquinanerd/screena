/**
 * renewal.ts — Estado e expiracao do snapshot atual (Backend C, C6B).
 *
 * PURO e DETERMINISTICO. Classifica o snapshot ATUAL de um usuario em relacao ao
 * snapshot DESEJADO (recem-construido) e ao instante `now` (epoch-ms INJETADO —
 * nunca `Date.now`). NAO le banco, NAO escreve, NAO promove; so decide o ESTADO.
 * O planner de transacao (transaction-plan.ts) mapeia o estado para o plano.
 *
 * Precedencia (mais especifico primeiro): invalido -> ausente -> algoritmo
 * defasado -> politica defasada -> fingerprint mudou -> (mesmo conteudo) valido/
 * expirando/expirado. Como o fingerprint ja incorpora algoritmo+politica, uma
 * versao defasada tambem mudaria o fingerprint; classificar como
 * algorithm/policy_outdated apenas expoe o motivo MAIS especifico.
 */

import { isValidEpochMillis } from "./time.js";
import type { SnapshotPolicy } from "./types.js";

/** Resumo minimo do snapshot ATUAL lido pela persistencia (sem itens, sem PII). */
export interface CurrentSnapshotSummary {
  readonly snapshotId: bigint;
  readonly fingerprint: string;
  readonly algorithmVersion: string;
  readonly policyVersion: string;
  readonly generatedAtMs: number;
  /** `null` = snapshot sem expiracao (TTL desligado quando foi criado). */
  readonly expiresAtMs: number | null;
}

/** Identidade semantica do snapshot DESEJADO (recem-construido). */
export interface DesiredSnapshotSummary {
  readonly fingerprint: string;
  readonly algorithmVersion: string;
  readonly policyVersion: string;
}

export const SNAPSHOT_STATE_KINDS = [
  "missing",
  "current_valid",
  "current_expiring",
  "current_expired",
  "algorithm_outdated",
  "policy_outdated",
  "fingerprint_changed",
  "invalid",
] as const;
export type SnapshotStateKind = (typeof SNAPSHOT_STATE_KINDS)[number];

export interface SnapshotState {
  readonly kind: SnapshotStateKind;
  /** Motivos quando `invalid` (auditoria); ausente nos demais. */
  readonly reasons?: readonly string[];
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface EvaluateSnapshotStateInput {
  readonly current: CurrentSnapshotSummary | null;
  readonly desired: DesiredSnapshotSummary;
  readonly now: number;
  readonly policy: SnapshotPolicy;
}

/**
 * Classifica o estado do snapshot atual. Total e sem excecao: entrada invalida
 * (now/versoes/summary malformado) => `invalid` (fail-closed, nunca "valido").
 */
export function evaluateSnapshotState(input: EvaluateSnapshotStateInput): SnapshotState {
  const errors: string[] = [];
  if (!isValidEpochMillis(input.now)) errors.push("now (epoch-ms) invalido");
  if (!nonBlank(input.desired.fingerprint)) errors.push("desired.fingerprint vazio");
  if (!nonBlank(input.desired.algorithmVersion)) errors.push("desired.algorithmVersion vazio");
  if (!nonBlank(input.desired.policyVersion)) errors.push("desired.policyVersion vazio");
  if (errors.length > 0) {
    return { kind: "invalid", reasons: errors };
  }

  const current = input.current;
  if (current === null) {
    return { kind: "missing" };
  }

  // Fail-closed: summary do atual malformado => invalido (nunca tratado valido).
  if (
    typeof current.snapshotId !== "bigint" ||
    current.snapshotId <= 0n ||
    !nonBlank(current.fingerprint) ||
    !nonBlank(current.algorithmVersion) ||
    !nonBlank(current.policyVersion) ||
    !isValidEpochMillis(current.generatedAtMs) ||
    (current.expiresAtMs !== null && !isValidEpochMillis(current.expiresAtMs))
  ) {
    return { kind: "invalid", reasons: ["current summary malformado"] };
  }

  if (current.algorithmVersion !== input.desired.algorithmVersion) {
    return { kind: "algorithm_outdated" };
  }
  if (current.policyVersion !== input.desired.policyVersion) {
    return { kind: "policy_outdated" };
  }
  if (current.fingerprint !== input.desired.fingerprint) {
    return { kind: "fingerprint_changed" };
  }

  // Mesmo conteudo/versoes: decide por expiracao.
  if (current.expiresAtMs === null) {
    return { kind: "current_valid" };
  }
  if (input.now >= current.expiresAtMs) {
    return { kind: "current_expired" };
  }
  const window = Math.max(0, input.policy.renewWindowMs);
  if (input.now >= current.expiresAtMs - window) {
    return { kind: "current_expiring" };
  }
  return { kind: "current_valid" };
}
