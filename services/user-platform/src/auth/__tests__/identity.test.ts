/**
 * Testes de identidade (auth/identity.ts): normalizacao deterministica,
 * rejeicao de vazio/comprimento, AUSENCIA de normalizacao destrutiva por
 * provedor (pontos do Gmail, "+tag") e garantia de que o resultado nunca
 * carrega segredo.
 */

import { describe, expect, it } from "vitest";
import {
  EMAIL_MAX_LENGTH,
  normalizeEmail,
  validateEmailFormat,
  validateHandle,
} from "../identity.js";

describe("normalizeEmail", () => {
  it("(1) aplica apenas trim + lowercase (deterministico)", () => {
    expect(normalizeEmail("  Pablo@Example.COM  ")).toBe("pablo@example.com");
    expect(normalizeEmail("pablo@example.com")).toBe("pablo@example.com");
  });

  it("(2) NAO remove pontos da parte local (sem regra de Gmail)", () => {
    expect(normalizeEmail("pa.blo.eduardo@gmail.com")).toBe("pa.blo.eduardo@gmail.com");
  });

  it("(3) NAO corta sufixo +tag (nao altera a parte local alem de caixa)", () => {
    expect(normalizeEmail("pablo+news@example.com")).toBe("pablo+news@example.com");
  });

  it("(4) mantem contas distintas distintas (nenhuma colisao por provedor)", () => {
    const a = normalizeEmail("p.ablo@gmail.com");
    const b = normalizeEmail("pablo@gmail.com");
    expect(a).not.toBe(b);
  });
});

describe("validateEmailFormat", () => {
  it("(1) aceita email valido mesmo com espacos e maiusculas na entrada", () => {
    const result = validateEmailFormat(" User.Name+tag@Example.com ");
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("(2) rejeita vazio", () => {
    expect(validateEmailFormat("   ").ok).toBe(false);
  });

  it("(3) rejeita formatos invalidos", () => {
    expect(validateEmailFormat("pablo.example.com").ok).toBe(false);
    expect(validateEmailFormat("pablo@localhost").ok).toBe(false);
    expect(validateEmailFormat("pa blo@example.com").ok).toBe(false);
  });

  it("(4) rejeita na fronteira de comprimento (> 254)", () => {
    const tooLong = `${"a".repeat(EMAIL_MAX_LENGTH)}@ex.com`;
    const result = validateEmailFormat(tooLong);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes(String(EMAIL_MAX_LENGTH)))).toBe(true);
  });

  it("(5) o resultado nunca contem senha/token/hash", () => {
    const result = validateEmailFormat("pablo@example.com");
    const text = JSON.stringify(result).toLowerCase();
    expect(text.includes("password")).toBe(false);
    expect(text.includes("token")).toBe(false);
    expect(text.includes("hash")).toBe(false);
  });
});

describe("validateHandle", () => {
  it("(1) aceita handles validos", () => {
    expect(validateHandle("pablo_eduardo1").ok).toBe(true);
    expect(validateHandle("a").ok).toBe(true);
    expect(validateHandle(`a${"b".repeat(28)}c`).ok).toBe(true); // 30 chars
  });

  it("(2) rejeita underscore nas pontas, maiusculas e tamanhos invalidos", () => {
    for (const bad of ["_abc", "abc_", "Pablo", "ab", `a${"b".repeat(29)}c`, ""]) {
      expect(validateHandle(bad).ok, bad).toBe(false);
    }
  });
});
