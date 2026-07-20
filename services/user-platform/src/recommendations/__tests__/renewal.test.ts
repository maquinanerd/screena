/**
 * Testes de RENOVACAO/EXPIRACAO (C6B): evaluateSnapshotState classifica o
 * snapshot atual (missing/valid/expiring/expired/algorithm_outdated/
 * policy_outdated/fingerprint_changed/invalid) de forma determinista, com `now`
 * injetado, precedencia correta e fail-closed para entrada invalida.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_SNAPSHOT_POLICY } from "../policy.js";
import {
  type CurrentSnapshotSummary,
  type DesiredSnapshotSummary,
  evaluateSnapshotState,
} from "../renewal.js";

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;
const POLICY = DEFAULT_SNAPSHOT_POLICY; // ttl 24h, renewWindow 6h

function current(overrides: Partial<CurrentSnapshotSummary> = {}): CurrentSnapshotSummary {
  return {
    snapshotId: 10n,
    fingerprint: "fp1",
    algorithmVersion: "reco-v1",
    policyVersion: "reco-v1",
    generatedAtMs: NOW - HOUR,
    expiresAtMs: NOW + 24 * HOUR,
    ...overrides,
  };
}

function desired(overrides: Partial<DesiredSnapshotSummary> = {}): DesiredSnapshotSummary {
  return { fingerprint: "fp1", algorithmVersion: "reco-v1", policyVersion: "reco-v1", ...overrides };
}

function stateOf(
  cur: CurrentSnapshotSummary | null,
  des: DesiredSnapshotSummary = desired(),
  now = NOW,
) {
  return evaluateSnapshotState({ current: cur, desired: des, now, policy: POLICY }).kind;
}

describe("evaluateSnapshotState", () => {
  it("ausente => missing", () => {
    expect(stateOf(null)).toBe("missing");
  });

  it("dentro da validade => current_valid", () => {
    expect(stateOf(current({ expiresAtMs: NOW + 24 * HOUR }))).toBe("current_valid");
  });

  it("proximo da expiracao (dentro da janela) => current_expiring", () => {
    expect(stateOf(current({ expiresAtMs: NOW + 3 * HOUR }))).toBe("current_expiring");
  });

  it("expirado => current_expired (nunca valido)", () => {
    expect(stateOf(current({ expiresAtMs: NOW - 1000 }))).toBe("current_expired");
  });

  it("sem TTL (expiresAtMs null) => current_valid", () => {
    expect(stateOf(current({ expiresAtMs: null }))).toBe("current_valid");
  });

  it("algorithmVersion diferente => algorithm_outdated", () => {
    expect(stateOf(current(), desired({ algorithmVersion: "reco-v2" }))).toBe("algorithm_outdated");
  });

  it("policyVersion diferente => policy_outdated", () => {
    expect(stateOf(current(), desired({ policyVersion: "reco-v2" }))).toBe("policy_outdated");
  });

  it("fingerprint diferente => fingerprint_changed", () => {
    expect(stateOf(current(), desired({ fingerprint: "fp2" }))).toBe("fingerprint_changed");
  });

  it("precedencia: expirado + fingerprint mudou => fingerprint_changed", () => {
    expect(stateOf(current({ expiresAtMs: NOW - 1000 }), desired({ fingerprint: "fp2" }))).toBe(
      "fingerprint_changed",
    );
  });

  it("now invalido => invalid (fail-closed)", () => {
    expect(stateOf(current(), desired(), -1)).toBe("invalid");
    expect(stateOf(current(), desired(), 1.5)).toBe("invalid");
  });

  it("summary do atual malformado => invalid", () => {
    expect(stateOf(current({ fingerprint: "  " }))).toBe("invalid");
    expect(stateOf(current({ snapshotId: 0n }))).toBe("invalid");
    expect(stateOf(current({ generatedAtMs: -5 }))).toBe("invalid");
  });

  it("desired invalido => invalid", () => {
    expect(stateOf(current(), desired({ fingerprint: "" }))).toBe("invalid");
  });

  it("determinista: mesma entrada e mesmo now => mesma saida", () => {
    const a = evaluateSnapshotState({ current: current(), desired: desired(), now: NOW, policy: POLICY });
    const b = evaluateSnapshotState({ current: current(), desired: desired(), now: NOW, policy: POLICY });
    expect(a).toEqual(b);
  });
});
