/**
 * Testes de sessao (auth/sessions.ts): construcao hash-only, IP cru barrado,
 * expiracao a partir de `now` injetado, rotacao que invalida a anterior,
 * avaliacao fail-closed (expirada/revogada/conta inelegivel) e revogacao em
 * massa (logout, revoke-all, evento sensivel).
 */

import { describe, expect, it } from "vitest";
import {
  buildSessionCreation,
  buildSessionRecord,
  buildSessionRotation,
  evaluateSessionAccess,
  planLogout,
  planRevokeAll,
  planRevokeAllAfterSensitiveEvent,
} from "../sessions.js";
import type { SecretHasherPort } from "../types.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const HOUR = 3_600_000;

/** Hasher fake DETERMINISTICO que devolve 64 hex chars (forma sha256). */
const fakeHashSecret: SecretHasherPort = (s) => {
  let hex = "";
  for (const ch of s) hex += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return (hex + "0".repeat(64)).slice(0, 64);
};

/** Um ipHash valido de teste (64 hex), como o adapter produziria. */
const VALID_IP_HASH = fakeHashSecret("ip:1.2.3.4");

describe("buildSessionRecord", () => {
  it("(1) persiste SO hashes; o token cru nunca aparece no registro", () => {
    const rawToken = "token-cru-super-secreto-0001";
    const rawCsrf = "csrf-cru-super-secreto-0002";
    const result = buildSessionRecord({
      userId: 5n,
      rawToken,
      rawCsrfToken: rawCsrf,
      now: NOW,
      ttlHours: 720,
      hashSecret: fakeHashSecret,
      ipHash: VALID_IP_HASH,
      userAgent: "Mozilla/5.0",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tokenHash).toBe(fakeHashSecret(rawToken));
    expect(result.value.csrfTokenHash).toBe(fakeHashSecret(rawCsrf));
    const text = JSON.stringify(result.value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(text).not.toContain(rawToken);
    expect(text).not.toContain(rawCsrf);
  });

  it("(2) expiracao calculada a partir de `now` injetado (720h)", () => {
    const result = buildSessionRecord({
      userId: 1n,
      rawToken: "a".repeat(20),
      rawCsrfToken: "b".repeat(20),
      now: NOW,
      ttlHours: 720,
      hashSecret: fakeHashSecret,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expiresAt.getTime()).toBe(NOW.getTime() + 720 * HOUR);
  });

  it("(3) IP cru e barrado: ipHash precisa ser sha256 hex ou nulo", () => {
    const rawIp = buildSessionRecord({
      userId: 1n,
      rawToken: "a".repeat(20),
      rawCsrfToken: "b".repeat(20),
      now: NOW,
      ttlHours: 720,
      hashSecret: fakeHashSecret,
      ipHash: "192.168.0.1", // IP CRU: deve ser rejeitado
    });
    expect(rawIp.ok).toBe(false);

    const nullIp = buildSessionRecord({
      userId: 1n,
      rawToken: "a".repeat(20),
      rawCsrfToken: "b".repeat(20),
      now: NOW,
      ttlHours: 720,
      hashSecret: fakeHashSecret,
      ipHash: null,
    });
    expect(nullIp.ok).toBe(true);
    if (nullIp.ok) expect(nullIp.value.ipHash).toBeNull();
  });

  it("(4) user-agent e minimizado (truncado a 256 chars)", () => {
    const result = buildSessionRecord({
      userId: 1n,
      rawToken: "a".repeat(20),
      rawCsrfToken: "b".repeat(20),
      now: NOW,
      ttlHours: 720,
      hashSecret: fakeHashSecret,
      userAgent: "U".repeat(1000),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.userAgent?.length).toBe(256);
  });

  it("(5) token vazio e TTL invalido sao rejeitados", () => {
    const emptyToken = buildSessionRecord({
      userId: 1n,
      rawToken: "",
      rawCsrfToken: "b".repeat(20),
      now: NOW,
      ttlHours: 720,
      hashSecret: fakeHashSecret,
    });
    expect(emptyToken.ok).toBe(false);
    const badTtl = buildSessionRecord({
      userId: 1n,
      rawToken: "a".repeat(20),
      rawCsrfToken: "b".repeat(20),
      now: NOW,
      ttlHours: 0,
      hashSecret: fakeHashSecret,
    });
    expect(badTtl.ok).toBe(false);
  });
});

describe("buildSessionCreation (gate de status na criacao)", () => {
  const base = {
    userId: 5n,
    rawToken: "token-de-criacao-0009",
    rawCsrfToken: "csrf-de-criacao-0010",
    now: NOW,
    ttlHours: 720,
    hashSecret: fakeHashSecret,
  };

  it("(1) conta active cria sessao sem linhagem de rotacao", () => {
    const r = buildSessionCreation({ ...base, userStatus: "active" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rotatedFromSessionId).toBeNull();
  });

  it("(2) conta bloqueada NUNCA cria sessao (fail-closed em A6)", () => {
    for (const status of ["disabled", "pending_deletion", "deleted", null] as const) {
      const r = buildSessionCreation({ ...base, userStatus: status });
      expect(r.ok, String(status)).toBe(false);
    }
  });
});

describe("buildSessionRotation", () => {
  const base = {
    userId: 9n,
    previousSessionId: 100n,
    rawToken: "novo-token-rotacionado-0003",
    rawCsrfToken: "novo-csrf-rotacionado-0004",
    now: NOW,
    ttlHours: 720,
    hashSecret: fakeHashSecret,
  };

  it("(1) rotacao revoga a anterior E emite nova marcada com a linhagem", () => {
    const result = buildSessionRotation({ ...base, userStatus: "active" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // exatamente UMA sessao viva depois: a anterior entra na lista de revogacao
    expect(result.value.revokeSessionIds).toEqual([100n]);
    expect(result.value.newSession.rotatedFromSessionId).toBe(100n);
  });

  it("(2) conta inelegivel NAO rotaciona (fail-closed)", () => {
    for (const status of ["disabled", "pending_deletion", "deleted"] as const) {
      const result = buildSessionRotation({ ...base, userStatus: status });
      expect(result.ok, status).toBe(false);
    }
  });
});

describe("evaluateSessionAccess", () => {
  const active = { expiresAt: new Date(NOW.getTime() + HOUR), revokedAt: null };

  it("(1) sessao valida + conta active concede acesso", () => {
    const d = evaluateSessionAccess({ now: NOW, session: active, userStatus: "active" });
    expect(d.publicResult.ok).toBe(true);
    expect(d.internalReason).toBe("ok");
  });

  it("(2) sessao inexistente falha fechada (generico)", () => {
    const d = evaluateSessionAccess({ now: NOW, session: null, userStatus: "active" });
    expect(d.publicResult.ok).toBe(false);
    expect(d.internalReason).toBe("not_found");
  });

  it("(3) sessao expirada falha (now >= expiresAt)", () => {
    const d = evaluateSessionAccess({
      now: NOW,
      session: { expiresAt: NOW, revokedAt: null },
      userStatus: "active",
    });
    expect(d.publicResult.ok).toBe(false);
    expect(d.internalReason).toBe("expired");
  });

  it("(4) sessao revogada falha", () => {
    const d = evaluateSessionAccess({
      now: NOW,
      session: { expiresAt: new Date(NOW.getTime() + HOUR), revokedAt: new Date(NOW.getTime() - HOUR) },
      userStatus: "active",
    });
    expect(d.publicResult.ok).toBe(false);
    expect(d.internalReason).toBe("revoked");
  });

  it("(5) conta suspensa/pending_deletion/deleted falha mesmo com sessao viva", () => {
    for (const status of ["disabled", "pending_deletion", "deleted"] as const) {
      const d = evaluateSessionAccess({ now: NOW, session: active, userStatus: status });
      expect(d.publicResult.ok, status).toBe(false);
      expect(d.internalReason).toBe("account_ineligible");
    }
  });

  it("(6) a mensagem publica e IDENTICA entre as causas de falha (anti-enumeracao)", () => {
    const notFound = evaluateSessionAccess({ now: NOW, session: null, userStatus: "active" });
    const expired = evaluateSessionAccess({
      now: NOW,
      session: { expiresAt: NOW, revokedAt: null },
      userStatus: "active",
    });
    const ineligible = evaluateSessionAccess({ now: NOW, session: active, userStatus: "deleted" });
    const msg = (d: typeof notFound) => (d.publicResult.ok ? "" : d.publicResult.error.message);
    expect(msg(notFound)).toBe(msg(expired));
    expect(msg(expired)).toBe(msg(ineligible));
  });
});

describe("revogacoes", () => {
  it("(1) logout revoga exatamente a sessao corrente", () => {
    expect(planLogout({ currentSessionId: 42n }).revokeSessionIds).toEqual([42n]);
  });

  it("(2) revoke-all preserva a sessao corrente quando exceptSessionId e dado", () => {
    const plan = planRevokeAll({ activeSessionIds: [1n, 2n, 3n, 2n], exceptSessionId: 2n });
    expect(plan.revokeSessionIds).toEqual([1n, 3n]);
  });

  it("(3) evento sensivel revoga TUDO (sem excecao) e deduplica", () => {
    const plan = planRevokeAllAfterSensitiveEvent({ activeSessionIds: [1n, 1n, 2n] });
    expect(plan.revokeSessionIds).toEqual([1n, 2n]);
  });
});
