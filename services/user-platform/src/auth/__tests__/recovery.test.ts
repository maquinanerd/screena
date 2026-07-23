/**
 * Testes de recuperacao de senha (auth/recovery.ts): pedido com resposta
 * publica indistinguivel entre conta existente/inexistente/inelegivel; emissao
 * hash-only; reset aplicado troca a senha, revoga TODAS as sessoes e invalida
 * os tokens de reset pendentes; nenhum segredo aparece no plano.
 */

import { describe, expect, it } from "vitest";
import { PASSWORD_RESET_TTL_HOURS } from "../policy.js";
import type { PasswordHasherPort, SecretGeneratorPort, SecretHasherPort } from "../types.js";
import {
  applyPasswordReset,
  buildPasswordResetIssue,
  evaluatePasswordResetRequest,
} from "../recovery.js";
import type { UserStatus } from "../../core/types.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const HOUR = 3_600_000;

const RAW = "raw-reset-token-xyz";
const fakeGenerate: SecretGeneratorPort = () => RAW;
const fakeHashSecret: SecretHasherPort = (s) => {
  let hex = "";
  for (const ch of s) hex += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return (hex + "0".repeat(64)).slice(0, 64);
};
const fakeHashPassword: PasswordHasherPort = (pw) => {
  let hex = "";
  for (const ch of pw) hex += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return `scrypt$N=1,r=1,p=1$00$${hex}`;
};

describe("evaluatePasswordResetRequest (anti-enumeracao)", () => {
  it("(1) resposta publica IDENTICA para conta existente, inexistente e inelegivel", () => {
    const existing = evaluatePasswordResetRequest({ userExists: true, userStatus: "active" });
    const missing = evaluatePasswordResetRequest({ userExists: false, userStatus: null });
    const blocked = evaluatePasswordResetRequest({ userExists: true, userStatus: "disabled" });

    expect(existing.publicResult.ok).toBe(true);
    expect(missing.publicResult.ok).toBe(true);
    expect(blocked.publicResult.ok).toBe(true);

    // apenas o motivo interno diferencia (audit)
    expect(existing.internalReason).toBe("issue_token");
    expect(missing.internalReason).toBe("user_not_found");
    expect(blocked.internalReason).toBe("account_ineligible");
  });

  it("(2) so a conta active elegivel autoriza emitir token internamente", () => {
    for (const status of ["disabled", "pending_deletion", "deleted", null] as const) {
      const d = evaluatePasswordResetRequest({
        userExists: true,
        userStatus: status as UserStatus | null,
      });
      expect(d.internalReason).not.toBe("issue_token");
    }
  });
});

describe("buildPasswordResetIssue", () => {
  it("(1) persiste SO o hash (purpose=password_reset); token cru so para entrega", () => {
    const issue = buildPasswordResetIssue({
      userId: 2n,
      now: NOW,
      generateSecret: fakeGenerate,
      hashSecret: fakeHashSecret,
    });
    expect(issue.record.purpose).toBe("password_reset");
    expect(issue.record.tokenHash).toBe(fakeHashSecret(RAW));
    expect(issue.rawToken).toBe(RAW);
    const recordText = JSON.stringify(issue.record, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    expect(recordText).not.toContain(RAW);
  });

  it("(2) TTL curto: expira em PASSWORD_RESET_TTL_HOURS a partir de now", () => {
    const issue = buildPasswordResetIssue({
      userId: 2n,
      now: NOW,
      generateSecret: fakeGenerate,
      hashSecret: fakeHashSecret,
    });
    expect(issue.record.expiresAt.getTime()).toBe(NOW.getTime() + PASSWORD_RESET_TTL_HOURS * HOUR);
    expect(PASSWORD_RESET_TTL_HOURS).toBe(2);
  });
});

describe("applyPasswordReset", () => {
  it("(1) reset valido troca a senha E revoga TODAS as sessoes E invalida tokens pendentes", () => {
    const r = applyPasswordReset({
      userId: 3n,
      newPassword: "senhaNovaBemLonga1",
      hashPassword: fakeHashPassword,
      activeSessionIds: [10n, 11n, 10n],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.revokeSessionIds).toEqual([10n, 11n]);
    expect(r.value.credentialChange.credential.algorithm).toBe("scrypt");
    expect(r.value.invalidateAllPendingResetTokens).toBe(true);
  });

  it("(2) o plano nunca contem a nova senha em claro", () => {
    const newPassword = "outraSenhaUltraSecreta";
    const r = applyPasswordReset({
      userId: 1n,
      newPassword,
      hashPassword: fakeHashPassword,
      activeSessionIds: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = JSON.stringify(r.value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(text).not.toContain(newPassword);
  });
});
