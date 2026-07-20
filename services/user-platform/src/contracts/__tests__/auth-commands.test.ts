/**
 * Testes dos parsers de payload -> comando (contracts/auth-commands.ts):
 * validacao reusando a politica central de auth/, normalizacao nao-destrutiva,
 * e rejeicao de mass-assignment / campos administrativos / tokenHash /
 * passwordHash / userId / sessionId enviados pelo cliente.
 */

import { describe, expect, it } from "vitest";
import {
  parseChangePasswordCommand,
  parseConsumeEmailVerificationCommand,
  parseConsumePasswordRecoveryCommand,
  parseLoginCommand,
  parseLogoutCommand,
  parseRequestPasswordRecoveryCommand,
  parseSignupCommand,
} from "../auth-commands.js";

const GOOD_PW = "senha-bem-longa-10";
const GOOD_TOKEN = "0123456789abcdef0123456789abcdef"; // 32 chars

describe("parseSignupCommand", () => {
  it("(1) signup valido e aceito e normaliza o email", () => {
    const r = parseSignupCommand({ email: " Pablo@Example.COM ", password: GOOD_PW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.emailNormalized).toBe("pablo@example.com");
    expect(r.value.displayName).toBeNull();
  });

  it("(2) signup vazio e rejeitado", () => {
    expect(parseSignupCommand({}).ok).toBe(false);
    expect(parseSignupCommand({ email: "", password: "" }).ok).toBe(false);
  });

  it("(3) email acima do limite e rejeitado (politica central)", () => {
    const longEmail = `${"a".repeat(250)}@ex.com`;
    expect(parseSignupCommand({ email: longEmail, password: GOOD_PW }).ok).toBe(false);
  });

  it("(4) senha curta e rejeitada pela politica central (nao duplicada)", () => {
    expect(parseSignupCommand({ email: "a@b.co", password: "curta1" }).ok).toBe(false);
  });

  it("(5) normalizacao NAO remove pontos do Gmail (sem regra de provedor)", () => {
    const r = parseSignupCommand({ email: "pa.blo.eduardo@gmail.com", password: GOOD_PW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.emailNormalized).toBe("pa.blo.eduardo@gmail.com");
  });

  it("(6) campos administrativos sao rejeitados (mass-assignment)", () => {
    expect(
      parseSignupCommand({ email: "a@b.co", password: GOOD_PW, status: "active" }).ok,
    ).toBe(false);
    expect(parseSignupCommand({ email: "a@b.co", password: GOOD_PW, role: "admin" }).ok).toBe(false);
    expect(parseSignupCommand({ email: "a@b.co", password: GOOD_PW, isAdmin: true }).ok).toBe(false);
    expect(
      parseSignupCommand({ email: "a@b.co", password: GOOD_PW, emailVerifiedAt: "2020" }).ok,
    ).toBe(false);
  });

  it("(7) campos desconhecidos sao rejeitados", () => {
    expect(parseSignupCommand({ email: "a@b.co", password: GOOD_PW, extra: 1 }).ok).toBe(false);
  });

  it("(8) __proto__/constructor/prototype nao concedem propriedade", () => {
    const malicious = JSON.parse(`{"email":"a@b.co","password":"${GOOD_PW}","__proto__":{"role":"admin"}}`);
    expect(parseSignupCommand(malicious).ok).toBe(false);
    expect(({} as Record<string, unknown>).role).toBeUndefined();
  });

  it("(9) erro de validacao NUNCA ecoa a senha/token bruto (A20)", () => {
    const secretPw = "SENHA-SECRETA-QUE-NAO-PODE-VAZAR-1234567890";
    const overLong = parseSignupCommand({ email: "a@b.co", password: `${secretPw}${"x".repeat(2000)}` });
    expect(overLong.ok).toBe(false);
    if (!overLong.ok) expect(JSON.stringify(overLong.error)).not.toContain("SENHA-SECRETA");

    const secretToken = "TOKEN-SECRETO-NAO-VAZA-abcdef0123456789";
    const badReset = parseConsumePasswordRecoveryCommand({ token: secretToken, newPassword: "short" });
    expect(badReset.ok).toBe(false);
    if (!badReset.ok) expect(JSON.stringify(badReset.error)).not.toContain("TOKEN-SECRETO");
  });
});

describe("parseLoginCommand", () => {
  it("(1) login valido normaliza email", () => {
    const r = parseLoginCommand({ email: "A@B.CO", password: "x".repeat(12) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.emailNormalized).toBe("a@b.co");
  });

  it("(2) login NAO aceita userId/sessionId/status do cliente", () => {
    expect(parseLoginCommand({ email: "a@b.co", password: "x", userId: "1" }).ok).toBe(false);
    expect(parseLoginCommand({ email: "a@b.co", password: "x", sessionId: "9" }).ok).toBe(false);
    expect(parseLoginCommand({ email: "a@b.co", password: "x", status: "active" }).ok).toBe(false);
  });
});

describe("parseConsumePasswordRecoveryCommand", () => {
  it("(1) consumo valido e aceito", () => {
    const r = parseConsumePasswordRecoveryCommand({ token: GOOD_TOKEN, newPassword: GOOD_PW });
    expect(r.ok).toBe(true);
  });

  it("(2) NAO aceita tokenHash enviado pelo cliente", () => {
    const r = parseConsumePasswordRecoveryCommand({
      token: GOOD_TOKEN,
      newPassword: GOOD_PW,
      tokenHash: "deadbeef",
    });
    expect(r.ok).toBe(false);
  });

  it("(3) NAO aceita userId como autoridade da operacao", () => {
    const r = parseConsumePasswordRecoveryCommand({
      token: GOOD_TOKEN,
      newPassword: GOOD_PW,
      userId: "1",
    });
    expect(r.ok).toBe(false);
  });

  it("(4) token vazio/curto e rejeitado", () => {
    expect(parseConsumePasswordRecoveryCommand({ token: "", newPassword: GOOD_PW }).ok).toBe(false);
    expect(parseConsumePasswordRecoveryCommand({ token: "abc", newPassword: GOOD_PW }).ok).toBe(
      false,
    );
  });
});

describe("parseConsumeEmailVerificationCommand", () => {
  it("(1) token valido aceito; tokenHash rejeitado", () => {
    expect(parseConsumeEmailVerificationCommand({ token: GOOD_TOKEN }).ok).toBe(true);
    expect(
      parseConsumeEmailVerificationCommand({ token: GOOD_TOKEN, tokenHash: "x" }).ok,
    ).toBe(false);
  });
});

describe("parseChangePasswordCommand", () => {
  it("(1) mudanca valida aceita", () => {
    const r = parseChangePasswordCommand({ currentPassword: "antigaSenha10", newPassword: GOOD_PW });
    expect(r.ok).toBe(true);
  });

  it("(2) NAO aceita passwordHash/userId/credentialId do cliente", () => {
    expect(
      parseChangePasswordCommand({
        currentPassword: "antigaSenha10",
        newPassword: GOOD_PW,
        passwordHash: "scrypt$...",
      }).ok,
    ).toBe(false);
    expect(
      parseChangePasswordCommand({ currentPassword: "a", newPassword: GOOD_PW, userId: "1" }).ok,
    ).toBe(false);
    expect(
      parseChangePasswordCommand({
        currentPassword: "a",
        newPassword: GOOD_PW,
        credentialId: "1",
      }).ok,
    ).toBe(false);
  });
});

describe("parseRequestPasswordRecoveryCommand / parseLogoutCommand", () => {
  it("(1) recovery so aceita email; normaliza", () => {
    const r = parseRequestPasswordRecoveryCommand({ email: "A@B.CO" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.emailNormalized).toBe("a@b.co");
    expect(parseRequestPasswordRecoveryCommand({ email: "a@b.co", extra: 1 }).ok).toBe(false);
  });

  it("(2) logout da sessao atual NAO aceita sessionId arbitrario do body", () => {
    expect(parseLogoutCommand({}).ok).toBe(true);
    expect(parseLogoutCommand(null).ok).toBe(true);
    expect(parseLogoutCommand({ sessionId: "42" }).ok).toBe(false);
  });
});
