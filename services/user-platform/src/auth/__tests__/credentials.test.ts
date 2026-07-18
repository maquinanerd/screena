/**
 * Testes de credenciais (auth/credentials.ts): registro via porta de hash,
 * autenticacao via porta de verificacao injetada, senha nunca em claro no
 * resultado, e troca de senha que SEMPRE revoga as sessoes.
 */

import { describe, expect, it } from "vitest";
import {
  authenticatePassword,
  buildCredentialRegistration,
  buildPasswordChange,
} from "../credentials.js";
import type { PasswordHasherPort, PasswordVerifierPort } from "../types.js";

/** Hasher fake DETERMINISTICO em formato PHC-like (scrypt$...$...$<hex(pw)>). */
const fakeHash: PasswordHasherPort = (pw) => {
  let hex = "";
  for (const ch of pw) hex += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return `scrypt$N=1,r=1,p=1$00$${hex}`;
};

/** Verifier fake coerente com fakeHash (comparacao exata do hash derivado). */
const fakeVerify: PasswordVerifierPort = (pw, storedHash) => storedHash === fakeHash(pw);

describe("buildCredentialRegistration", () => {
  it("(1) produz hash via porta e deriva o algoritmo do proprio hash PHC", () => {
    const result = buildCredentialRegistration({
      userId: 7n,
      password: "senha-bem-longa",
      hashPassword: fakeHash,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.userId).toBe(7n);
    expect(result.value.algorithm).toBe("scrypt");
    expect(result.value.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  it("(2) o registro NUNCA contem a senha em claro", () => {
    const password = "minhaSenhaSecreta123";
    const result = buildCredentialRegistration({ userId: 1n, password, hashPassword: fakeHash });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // nenhum campo do registro pode ser igual a senha crua
    expect(Object.values(result.value)).not.toContain(password);
    expect(JSON.stringify(result.value, (_, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain(
      password,
    );
  });

  it("(3) senha vazia e invariante violada (fail-closed, nunca lanca)", () => {
    const result = buildCredentialRegistration({ userId: 1n, password: "", hashPassword: fakeHash });
    expect(result.ok).toBe(false);
  });
});

describe("authenticatePassword", () => {
  const stored = fakeHash("aSenhaCorreta10");

  it("(1) senha correta autentica (porta injetada)", () => {
    expect(authenticatePassword({ password: "aSenhaCorreta10", storedHash: stored, verify: fakeVerify })).toBe(
      true,
    );
  });

  it("(2) senha incorreta falha", () => {
    expect(authenticatePassword({ password: "aSenhaErrada99", storedHash: stored, verify: fakeVerify })).toBe(
      false,
    );
  });

  it("(3) credencial ausente falha sem distincao (conta sem senha == senha errada)", () => {
    expect(authenticatePassword({ password: "qualquer", storedHash: null, verify: fakeVerify })).toBe(false);
    expect(authenticatePassword({ password: "qualquer", storedHash: "", verify: fakeVerify })).toBe(false);
  });

  it("(4) nunca chama o verifier quando nao ha hash (evita oraculo de tempo trivial)", () => {
    let called = 0;
    const spy: PasswordVerifierPort = (pw, h) => {
      called += 1;
      return fakeVerify(pw, h);
    };
    authenticatePassword({ password: "x", storedHash: null, verify: spy });
    expect(called).toBe(0);
  });
});

describe("buildPasswordChange", () => {
  it("(1) troca de senha revoga TODAS as sessoes (sem excecao) e deduplica", () => {
    const result = buildPasswordChange({
      userId: 3n,
      newPassword: "novaSenhaLonga123",
      hashPassword: fakeHash,
      activeSessionIds: [10n, 11n, 10n, 12n],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.revokeSessionIds).toEqual([10n, 11n, 12n]);
    expect(result.value.credential.algorithm).toBe("scrypt");
  });

  it("(2) o plano nao contem a nova senha em claro", () => {
    const newPassword = "outraSenhaSuperSecreta";
    const result = buildPasswordChange({
      userId: 1n,
      newPassword,
      hashPassword: fakeHash,
      activeSessionIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(text).not.toContain(newPassword);
  });
});
