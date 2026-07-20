/**
 * Testes do PLANO transaction-ready (C6B): create/replace/renew/noop/invalidate/
 * conflict/invalid/forbidden. Provam que create nao rebaixa snapshot inexistente,
 * replace/renew rebaixam o atual ANTES de inserir (nunca dois current), noop e
 * conflict nao escrevem, conflito e explicito (nunca replace silencioso) e o
 * plano nao contem SQL/Prisma nem entidade completa.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_SNAPSHOT_POLICY } from "../policy.js";
import type { CurrentSnapshotSummary } from "../renewal.js";
import type { BuiltSnapshot, PersistableSnapshotRecord, SnapshotPayload } from "../snapshot.js";
import {
  planSnapshotInvalidation,
  planSnapshotPublication,
  type PlanSnapshotPublicationInput,
  type SnapshotPublicationPlan,
} from "../transaction-plan.js";

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;

function makeBuilt(
  o: {
    ownerUserId?: bigint;
    algorithmVersion?: string;
    policyVersion?: string;
    fingerprint?: string;
  } = {},
): BuiltSnapshot {
  const ownerUserId = o.ownerUserId ?? 7n;
  const algorithmVersion = o.algorithmVersion ?? "reco-v1";
  const policyVersion = o.policyVersion ?? "reco-v1";
  const fingerprint = o.fingerprint ?? "fp1";
  const generatedAt = "2023-11-14T22:13:20.000Z";
  const payload: SnapshotPayload = {
    contractVersion: "cinerie-reco-snap-1",
    context: "discovery",
    algorithmVersion,
    policyVersion,
    fingerprint,
    generatedAt,
    expiresAt: null,
    diversity: {
      policyVersion: "reco-div-v1",
      appliedCaps: { maxPerPrimaryGenre: 3, maxPerFranchise: 2, maxPerEntityType: 20, outputLimit: 20 },
      skippedCandidates: 0,
    },
    items: [{ entityType: "movie", entityId: "1", score: 0.9, confidence: 0.8, position: 0, reasons: [] }],
  };
  const record: PersistableSnapshotRecord = { ownerUserId, algorithmVersion, generatedAt, payload };
  return { record, payload, fingerprint, canonical: "c", generatedAtMs: NOW, expiresAtMs: NOW + 24 * HOUR };
}

function curr(o: Partial<CurrentSnapshotSummary> = {}): CurrentSnapshotSummary {
  return {
    snapshotId: 10n,
    fingerprint: "fp1",
    algorithmVersion: "reco-v1",
    policyVersion: "reco-v1",
    generatedAtMs: NOW - HOUR,
    expiresAtMs: NOW + 24 * HOUR,
    ...o,
  };
}

function plan(o: Partial<PlanSnapshotPublicationInput> = {}): SnapshotPublicationPlan {
  return planSnapshotPublication({
    ownerUserId: 7n,
    built: makeBuilt(),
    current: null,
    expectedCurrentSnapshotId: null,
    accountStatus: "active",
    now: NOW,
    policy: DEFAULT_SNAPSHOT_POLICY,
    ...o,
  });
}

describe("planSnapshotPublication: mapeamento de estado", () => {
  it("sem atual => create sem demote (nao invalida inexistente)", () => {
    const p = plan();
    expect(p.kind).toBe("create");
    if (p.kind === "create") {
      expect(p.operations.map((op) => op.op)).toEqual(["insert_snapshot"]);
    }
  });

  it("fingerprint diferente => replace (demote antes de insert)", () => {
    const p = plan({ current: curr({ fingerprint: "fp2" }), expectedCurrentSnapshotId: 10n });
    expect(p.kind).toBe("replace");
    if (p.kind === "replace") {
      expect(p.operations.map((op) => op.op)).toEqual(["demote_current", "insert_snapshot"]);
      const insert = p.operations[1];
      expect(insert && insert.op === "insert_snapshot" && insert.isCurrent).toBe(true);
      expect(p.preconditions.expectedCurrentSnapshotId).toBe(10n);
    }
  });

  it("algoritmo antigo => replace; politica antiga => replace", () => {
    expect(plan({ current: curr({ algorithmVersion: "old" }), expectedCurrentSnapshotId: 10n }).kind).toBe(
      "replace",
    );
    expect(plan({ current: curr({ policyVersion: "old" }), expectedCurrentSnapshotId: 10n }).kind).toBe(
      "replace",
    );
  });

  it("mesmo fingerprint + expirado => renew", () => {
    const p = plan({ current: curr({ expiresAtMs: NOW - 1000 }), expectedCurrentSnapshotId: 10n });
    expect(p.kind).toBe("renew");
    if (p.kind === "renew") {
      expect(p.operations.map((op) => op.op)).toEqual(["demote_current", "insert_snapshot"]);
    }
  });

  it("mesmo fingerprint + valido => noop (nao escreve)", () => {
    const p = plan({ current: curr(), expectedCurrentSnapshotId: 10n });
    expect(p.kind).toBe("noop");
    expect("operations" in p).toBe(false);
  });

  it("current esperado divergente => conflict (nunca replace silencioso)", () => {
    const p = plan({ current: curr({ snapshotId: 10n }), expectedCurrentSnapshotId: 99n });
    expect(p.kind).toBe("conflict");
    if (p.kind === "conflict") {
      expect(p.expectedCurrentSnapshotId).toBe(99n);
      expect(p.actualCurrentSnapshotId).toBe(10n);
    }
    expect("operations" in p).toBe(false);
  });

  it("esperava nenhum mas existe atual => conflict; esperava id mas nao ha atual => conflict", () => {
    expect(plan({ current: curr(), expectedCurrentSnapshotId: null }).kind).toBe("conflict");
    expect(plan({ current: null, expectedCurrentSnapshotId: 5n }).kind).toBe("conflict");
  });

  it("conta inativa => forbidden; built invalido => invalid", () => {
    expect(plan({ accountStatus: "disabled" }).kind).toBe("forbidden");
    expect(plan({ built: makeBuilt({ fingerprint: "" }) }).kind).toBe("invalid");
    expect(plan({ built: makeBuilt({ algorithmVersion: "  " }) }).kind).toBe("invalid");
  });

  it("owner do built diverge do plano => invalid", () => {
    expect(plan({ ownerUserId: 7n, built: makeBuilt({ ownerUserId: 8n }) }).kind).toBe("invalid");
  });
});

describe("planSnapshotPublication: seguranca da transacao", () => {
  it("nunca deixa dois current: replace/renew demotam antes do insert(is_current=true)", () => {
    for (const p of [
      plan({ current: curr({ fingerprint: "fp2" }), expectedCurrentSnapshotId: 10n }),
      plan({ current: curr({ expiresAtMs: NOW - 1 }), expectedCurrentSnapshotId: 10n }),
    ]) {
      if (p.kind === "replace" || p.kind === "renew") {
        expect(p.operations[0]!.op).toBe("demote_current");
        expect(p.operations[1]!.op).toBe("insert_snapshot");
        expect(p.preconditions.enforceSingleCurrent).toBe(true);
        expect(p.preconditions.atomicTransaction).toBe(true);
      }
    }
  });

  it("plano nao contem SQL nem Prisma nem entidade completa", () => {
    const p = plan({ current: curr({ fingerprint: "fp2" }), expectedCurrentSnapshotId: 10n });
    const json = JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).toLowerCase();
    for (const banned of ["select ", "insert into", "update ", "delete ", "$transaction", "prisma"]) {
      expect(json.includes(banned)).toBe(false);
    }
  });
});

describe("planSnapshotInvalidation", () => {
  it("com atual e id esperado batendo => invalidate (so demote, sem insert)", () => {
    const p = planSnapshotInvalidation({
      ownerUserId: 7n,
      current: curr(),
      expectedCurrentSnapshotId: 10n,
      accountStatus: "active",
    });
    expect(p.kind).toBe("invalidate");
    if (p.kind === "invalidate") expect(p.operations.map((op) => op.op)).toEqual(["demote_current"]);
  });

  it("sem atual => noop; concorrencia divergente => conflict; conta inativa => forbidden", () => {
    expect(
      planSnapshotInvalidation({ ownerUserId: 7n, current: null, expectedCurrentSnapshotId: null, accountStatus: "active" }).kind,
    ).toBe("noop");
    expect(
      planSnapshotInvalidation({ ownerUserId: 7n, current: curr(), expectedCurrentSnapshotId: 99n, accountStatus: "active" }).kind,
    ).toBe("conflict");
    expect(
      planSnapshotInvalidation({ ownerUserId: 7n, current: curr(), expectedCurrentSnapshotId: 10n, accountStatus: "deleted" }).kind,
    ).toBe("forbidden");
  });
});
