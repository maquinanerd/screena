/**
 * TTL efetivo dos tokens de uso unico: a configuracao manda, o dominio protege.
 */

import { describe, expect, it } from "vitest";

import { resolveTtlMinutes } from "../ttl.js";
import { EMAIL_VERIFICATION_TTL_HOURS, PASSWORD_RESET_TTL_HOURS } from "../policy.js";
import { buildEmailVerificationIssue } from "../verification.js";
import { buildPasswordResetIssue } from "../recovery.js";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const generateSecret = (): string => "a".repeat(64);
const hashSecret = (value: string): string => `hash:${value}`;

function minutosAte(expiresAt: Date): number {
  return (expiresAt.getTime() - NOW.getTime()) / 60_000;
}

describe("resolveTtlMinutes", () => {
  it("(1) usa o candidato quando ele e inteiro positivo", () => {
    expect(resolveTtlMinutes(30, 2)).toBe(30);
    expect(resolveTtlMinutes(1, 2)).toBe(1);
    expect(resolveTtlMinutes(43_200, 2)).toBe(43_200);
  });

  it("(2) FAIL-SAFE: valor ausente ou fora de forma cai no default do dominio", () => {
    for (const invalido of [undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveTtlMinutes(invalido, 2), String(invalido)).toBe(120);
    }
  });

  it("(3) o fallback NUNCA e 'sem expiracao'", () => {
    expect(resolveTtlMinutes(undefined, PASSWORD_RESET_TTL_HOURS)).toBeGreaterThan(0);
    expect(resolveTtlMinutes(undefined, EMAIL_VERIFICATION_TTL_HOURS)).toBeGreaterThan(0);
  });
});

describe("os construtores de token honram o TTL injetado", () => {
  it("(4) reset: sem parametro usa o default de 2h; com parametro usa a config", () => {
    const padrao = buildPasswordResetIssue({
      userId: 1n,
      now: NOW,
      generateSecret,
      hashSecret,
    });
    expect(minutosAte(padrao.record.expiresAt)).toBe(PASSWORD_RESET_TTL_HOURS * 60);

    const configurado = buildPasswordResetIssue({
      userId: 1n,
      now: NOW,
      generateSecret,
      hashSecret,
      ttlMinutes: 30,
    });
    expect(minutosAte(configurado.record.expiresAt)).toBe(30);
  });

  it("(5) verificacao: sem parametro usa o default de 24h; com parametro usa a config", () => {
    const padrao = buildEmailVerificationIssue({
      userId: 1n,
      now: NOW,
      generateSecret,
      hashSecret,
    });
    expect(minutosAte(padrao.record.expiresAt)).toBe(EMAIL_VERIFICATION_TTL_HOURS * 60);

    const configurado = buildEmailVerificationIssue({
      userId: 1n,
      now: NOW,
      generateSecret,
      hashSecret,
      ttlMinutes: 1440,
    });
    expect(minutosAte(configurado.record.expiresAt)).toBe(1440);
  });

  it("(6) TTL invalido nao produz data invalida (o banco recusaria)", () => {
    const issue = buildPasswordResetIssue({
      userId: 1n,
      now: NOW,
      generateSecret,
      hashSecret,
      ttlMinutes: Number.NaN,
    });
    expect(Number.isNaN(issue.record.expiresAt.getTime())).toBe(false);
    expect(issue.record.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("(7) o token CRU nunca vira o valor persistido", () => {
    const issue = buildPasswordResetIssue({
      userId: 1n,
      now: NOW,
      generateSecret,
      hashSecret,
      ttlMinutes: 30,
    });
    expect(issue.record.tokenHash).toBe(hashSecret(issue.rawToken));
    expect(issue.record.tokenHash).not.toBe(issue.rawToken);
  });
});
