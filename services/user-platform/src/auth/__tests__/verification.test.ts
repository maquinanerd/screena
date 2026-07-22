/**
 * Testes de verificacao de email (auth/verification.ts): emissao hash-only
 * (registro nunca guarda o token cru), reenvio indistinguivel (anti-enumeracao)
 * e aplicacao idempotente quando o email ja esta verificado.
 */

import { describe, expect, it } from "vitest";
import { EMAIL_VERIFICATION_TTL_HOURS } from "../policy.js";
import type { SecretGeneratorPort, SecretHasherPort } from "../types.js";
import type { UserStatus } from "../../core/types.js";
import { evaluateTokenConsumption } from "../tokens.js";
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

describe("evaluateVerificationResend (elegibilidade + anti-enumeracao)", () => {
  it("(1) resposta publica IDENTICA nos CINCO casos", () => {
    const inexistente = evaluateVerificationResend({
      userExists: false,
      userStatus: null,
      alreadyVerified: false,
    });
    const jaVerificada = evaluateVerificationResend({
      userExists: true,
      userStatus: "active",
      alreadyVerified: true,
    });
    const elegivel = evaluateVerificationResend({
      userExists: true,
      userStatus: "active",
      alreadyVerified: false,
    });
    const desativada = evaluateVerificationResend({
      userExists: true,
      userStatus: "disabled",
      alreadyVerified: false,
    });
    const anonimizada = evaluateVerificationResend({
      userExists: true,
      userStatus: "deleted",
      alreadyVerified: false,
    });

    const todos = [inexistente, jaVerificada, elegivel, desativada, anonimizada];
    expect(todos.every((d) => d.publicResult.ok)).toBe(true);
    // Serializados IDENTICOS: nada distingue os casos para quem esta fora.
    expect(new Set(todos.map((d) => JSON.stringify(d.publicResult))).size).toBe(1);

    // So o motivo interno diferencia.
    expect(inexistente.internalReason).toBe("user_not_found");
    expect(jaVerificada.internalReason).toBe("already_verified");
    expect(elegivel.internalReason).toBe("issue_token");
    expect(desativada.internalReason).toBe("account_ineligible");
    expect(anonimizada.internalReason).toBe("account_ineligible");
  });

  it("(2) SO conta elegivel emite token", () => {
    const emite = (userStatus: UserStatus | null): boolean =>
      evaluateVerificationResend({ userExists: true, userStatus, alreadyVerified: false })
        .internalReason === "issue_token";
    expect(emite("active")).toBe(true);
    expect(emite("disabled")).toBe(false);
    expect(emite("pending_deletion")).toBe(false);
    expect(emite("deleted")).toBe(false);
    expect(emite(null)).toBe(false);
  });

  it("(3) inelegibilidade vem ANTES de already_verified", () => {
    // Conta anonimizada com carimbo antigo: o motivo que importa registrar e a
    // inelegibilidade, nao o carimbo.
    const r = evaluateVerificationResend({
      userExists: true,
      userStatus: "deleted",
      alreadyVerified: true,
    });
    expect(r.internalReason).toBe("account_ineligible");
  });
});

describe("applyEmailVerification (gate de status + idempotencia)", () => {
  it("(1) conta ativa nao verificada -> marca emailVerifiedAt = now", () => {
    const r = applyEmailVerification({
      now: NOW,
      userStatus: "active",
      currentEmailVerifiedAt: null,
    });
    expect(r.internalReason).toBe("verified");
    expect(r.publicResult.ok).toBe(true);
    if (!r.publicResult.ok) return;
    expect(r.publicResult.value.changed).toBe(true);
    expect(r.publicResult.value.emailVerifiedAt).toEqual(NOW);
  });

  it("(2) conta ativa ja verificada -> preserva o carimbo original", () => {
    const original = new Date(NOW.getTime() - 10 * HOUR);
    const r = applyEmailVerification({
      now: NOW,
      userStatus: "active",
      currentEmailVerifiedAt: original,
    });
    expect(r.internalReason).toBe("already_verified");
    expect(r.publicResult.ok).toBe(true);
    if (!r.publicResult.ok) return;
    expect(r.publicResult.value.changed).toBe(false);
    expect(r.publicResult.value.emailVerifiedAt).toEqual(original);
  });

  it("(3) conta INELEGIVEL nao conclui verificacao, mesmo com token valido", () => {
    for (const userStatus of ["disabled", "pending_deletion", "deleted", null] as const) {
      const r = applyEmailVerification({ now: NOW, userStatus, currentEmailVerifiedAt: null });
      expect(r.internalReason, String(userStatus)).toBe("account_ineligible");
      expect(r.publicResult.ok, String(userStatus)).toBe(false);
    }
  });

  it("(4) a recusa por conta inelegivel e INDISTINGUIVEL de token invalido", () => {
    // Se a confirmacao tivesse mensagem propria para "conta inelegivel", quem
    // tivesse um token qualquer saberia distinguir "token ruim" de "a conta
    // existe mas esta desativada". A mensagem e a MESMA do consumo de token.
    const inelegivel = applyEmailVerification({
      now: NOW,
      userStatus: "disabled",
      currentEmailVerifiedAt: null,
    });
    const tokenRuim = evaluateTokenConsumption({
      now: NOW,
      expectedPurpose: "email_verification",
      tokenRecord: null,
    });
    expect(JSON.stringify(inelegivel.publicResult)).toBe(JSON.stringify(tokenRuim.publicResult));
  });

  it("(5) conta anonimizada NAO e verificada nem com carimbo ausente", () => {
    // O caso que motivou a decisao: marcar o e-mail de um tumulo LGPD recriaria
    // atividade numa identidade que ja nao pode autenticar.
    const r = applyEmailVerification({
      now: NOW,
      userStatus: "deleted",
      currentEmailVerifiedAt: null,
    });
    expect(r.publicResult.ok).toBe(false);
    expect(r.internalReason).toBe("account_ineligible");
  });
});
