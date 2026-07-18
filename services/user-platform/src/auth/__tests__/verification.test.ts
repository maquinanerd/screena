/**
 * Testes de verificacao de email (auth/verification.ts): emissao hash-only
 * (registro nunca guarda o token cru), reenvio indistinguivel (anti-enumeracao)
 * e aplicacao idempotente quando o email ja esta verificado.
 */

import { describe, expect, it } from "vitest";
import { EMAIL_VERIFICATION_TTL_HOURS } from "../policy.js";
import type { SecretGeneratorPort, SecretHasherPort } from "../types.js";
import {
  applyEmailVerification,
  buildEmailVerificationIssue,
  evaluateVerificationResend,
} from "../verification.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const HOUR = 3_600_000;

const RAW = "raw-verification-token-abc";
const fakeGenerate: SecretGeneratorPort = () => RAW;
const fakeHashSecret: SecretHasherPort = (s) => {
  let hex = "";
  for (const ch of s) hex += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return (hex + "0".repeat(64)).slice(0, 64);
};

describe("buildEmailVerificationIssue", () => {
  it("(1) persiste SO o hash; o registro nunca contem o token cru", () => {
    const issue = buildEmailVerificationIssue({
      userId: 1n,
      now: NOW,
      generateSecret: fakeGenerate,
      hashSecret: fakeHashSecret,
    });
    expect(issue.record.tokenHash).toBe(fakeHashSecret(RAW));
    expect(issue.record.purpose).toBe("email_verification");
    const recordText = JSON.stringify(issue.record, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    expect(recordText).not.toContain(RAW);
  });

  it("(2) o token cru so aparece no campo de entrega (rawToken), para o email", () => {
    const issue = buildEmailVerificationIssue({
      userId: 1n,
      now: NOW,
      generateSecret: fakeGenerate,
      hashSecret: fakeHashSecret,
    });
    expect(issue.rawToken).toBe(RAW);
  });

  it("(3) expira em EMAIL_VERIFICATION_TTL_HOURS a partir de now", () => {
    const issue = buildEmailVerificationIssue({
      userId: 1n,
      now: NOW,
      generateSecret: fakeGenerate,
      hashSecret: fakeHashSecret,
    });
    expect(issue.record.expiresAt.getTime()).toBe(NOW.getTime() + EMAIL_VERIFICATION_TTL_HOURS * HOUR);
  });
});

describe("evaluateVerificationResend (anti-enumeracao)", () => {
  it("(1) resposta publica IDENTICA entre inexistente, ja verificada e elegivel", () => {
    const a = evaluateVerificationResend({ userExists: false, alreadyVerified: false });
    const b = evaluateVerificationResend({ userExists: true, alreadyVerified: true });
    const c = evaluateVerificationResend({ userExists: true, alreadyVerified: false });
    expect(a.publicResult.ok).toBe(true);
    expect(b.publicResult.ok).toBe(true);
    expect(c.publicResult.ok).toBe(true);
    // so o motivo interno diferencia
    expect(a.internalReason).toBe("user_not_found");
    expect(b.internalReason).toBe("already_verified");
    expect(c.internalReason).toBe("issue_token");
  });
});

describe("applyEmailVerification (idempotente)", () => {
  it("(1) email nao verificado -> marca emailVerifiedAt = now (changed)", () => {
    const r = applyEmailVerification({ now: NOW, currentEmailVerifiedAt: null });
    expect(r.changed).toBe(true);
    expect(r.emailVerifiedAt).toEqual(NOW);
  });

  it("(2) email ja verificado -> preserva o carimbo original (idempotente)", () => {
    const original = new Date(NOW.getTime() - 10 * HOUR);
    const r = applyEmailVerification({ now: NOW, currentEmailVerifiedAt: original });
    expect(r.changed).toBe(false);
    expect(r.emailVerifiedAt).toEqual(original);
  });
});
