/**
 * Testes de consentimento versionado: ausencia != granted; finalidade e versao
 * corretas; revogacao invalida; base legal nao-revogavel; determinismo.
 */

import { describe, expect, it } from "vitest";
import {
  currentConsent,
  describeConsentBasis,
  isConsentActive,
  recordConsent,
  revokeConsent,
  type StoredConsentRecord,
} from "../consent.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const HOUR = 3_600_000;

function rec(overrides: Partial<StoredConsentRecord>): StoredConsentRecord {
  return {
    kind: "marketing_email",
    granted: true,
    policyVersion: "2026-07",
    occurredAt: NOW,
    ...overrides,
  };
}

describe("isConsentActive", () => {
  it("(1) ausencia de registro NUNCA equivale a granted", () => {
    expect(isConsentActive({ records: [], kind: "marketing_email", requiredPolicyVersion: "2026-07" })).toBe(
      false,
    );
  });

  it("(2) concedido na versao correta e ativo", () => {
    expect(
      isConsentActive({ records: [rec({})], kind: "marketing_email", requiredPolicyVersion: "2026-07" }),
    ).toBe(true);
  });

  it("(3) finalidade diferente NAO e autorizada", () => {
    const records = [rec({ kind: "analytics" })];
    expect(
      isConsentActive({ records, kind: "marketing_email", requiredPolicyVersion: "2026-07" }),
    ).toBe(false);
  });

  it("(4) versao incompativel NAO autoriza (mesmo granted)", () => {
    expect(
      isConsentActive({ records: [rec({ policyVersion: "2025-01" })], kind: "marketing_email", requiredPolicyVersion: "2026-07" }),
    ).toBe(false);
  });

  it("(5) revogacao (ultimo granted=false) invalida", () => {
    const records = [
      rec({ granted: true, occurredAt: new Date(NOW.getTime() - HOUR) }),
      rec({ granted: false, occurredAt: NOW }),
    ];
    expect(
      isConsentActive({ records, kind: "marketing_email", requiredPolicyVersion: "2026-07" }),
    ).toBe(false);
  });

  it("(6) o registro VIGENTE e o mais recente (empate: ultima ocorrencia)", () => {
    const older = rec({ granted: false, occurredAt: new Date(NOW.getTime() - HOUR) });
    const newer = rec({ granted: true, occurredAt: NOW });
    expect(currentConsent([older, newer], "marketing_email")?.granted).toBe(true);
  });
});

describe("recordConsent (determinismo, sem checkbox pre-marcado)", () => {
  it("(1) granted e explicito; produz registro append-only com occurredAt=now", () => {
    const r = recordConsent({ userId: 1n, kind: "analytics", granted: true, policyVersion: "2026-07", now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.granted).toBe(true);
      expect(r.value.occurredAt).toEqual(NOW);
    }
  });

  it("(2) versao de politica vazia e rejeitada", () => {
    expect(
      recordConsent({ userId: 1n, kind: "analytics", granted: true, policyVersion: "  ", now: NOW }).ok,
    ).toBe(false);
  });

  it("(3) mesma entrada -> mesma saida (deterministico)", () => {
    const a = recordConsent({ userId: 1n, kind: "analytics", granted: false, policyVersion: "v1", now: NOW });
    const b = recordConsent({ userId: 1n, kind: "analytics", granted: false, policyVersion: "v1", now: NOW });
    expect(JSON.stringify(a, (_, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(
      JSON.stringify(b, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
  });
});

describe("revokeConsent e base legal", () => {
  it("(1) marketing/analytics sao revogaveis (base consent)", () => {
    expect(describeConsentBasis("marketing_email")).toEqual({
      kind: "marketing_email",
      legalBasis: "consent",
      revocable: true,
    });
    expect(revokeConsent({ userId: 1n, kind: "analytics", policyVersion: "v1", now: NOW }).ok).toBe(
      true,
    );
  });

  it("(2) ToS/privacy NAO sao revogaveis (base legal != consentimento)", () => {
    expect(describeConsentBasis("terms_of_service").revocable).toBe(false);
    expect(describeConsentBasis("privacy_policy").revocable).toBe(false);
    expect(revokeConsent({ userId: 1n, kind: "terms_of_service", policyVersion: "v1", now: NOW }).ok).toBe(
      false,
    );
    expect(revokeConsent({ userId: 1n, kind: "privacy_policy", policyVersion: "v1", now: NOW }).ok).toBe(
      false,
    );
  });

  it("(3) revogacao produz registro granted=false", () => {
    const r = revokeConsent({ userId: 1n, kind: "marketing_email", policyVersion: "v1", now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.granted).toBe(false);
  });

  it("(4) nenhum segredo aparece no registro de consentimento", () => {
    const r = recordConsent({ userId: 1n, kind: "analytics", granted: true, policyVersion: "v1", now: NOW });
    if (r.ok) {
      const text = JSON.stringify(r.value, (_, v) => (typeof v === "bigint" ? v.toString() : v)).toLowerCase();
      for (const t of ["password", "token", "hash", "secret"]) expect(text.includes(t)).toBe(false);
    }
  });
});
