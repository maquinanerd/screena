/**
 * Testes da politica de AVALIACAO DE USUARIO: escala fixa 5 (passo 0.5),
 * guard de entidade avaliavel e gate de mutacao por estado da conta.
 * Nota de usuario NUNCA se mistura com fontes externas (invariantes 1/2) — este
 * modulo nem importa nada de ratings externos.
 */

import { describe, expect, it } from "vitest";
import type { UserStatus } from "../../core/types.js";
import { assertRatingMutationAllowed, validateUserRatingValue } from "../policy.js";
import { isRatableEntityType } from "../types.js";

const GRID = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

describe("validateUserRatingValue — grade e escala", () => {
  it("(1) aceita o minimo 0.5 e o maximo 5 na escala 5", () => {
    expect(validateUserRatingValue(0.5, 5)).toEqual({ ok: true, errors: [] });
    expect(validateUserRatingValue(5, 5)).toEqual({ ok: true, errors: [] });
  });

  it("(2) aceita TODOS os 10 incrementos validos da grade", () => {
    for (const value of GRID) {
      const result = validateUserRatingValue(value, 5);
      expect(result.ok, `valor ${value} deveria ser aceito`).toBe(true);
    }
  });

  it("(3) rejeita abaixo do minimo (0 e 0.25) sem arredondar", () => {
    expect(validateUserRatingValue(0, 5).ok).toBe(false);
    expect(validateUserRatingValue(0, 5).errors.some((e) => e.includes("minima e 0.5"))).toBe(true);
    // 0.25 e menor que o minimo E fora do passo: nunca vira 0.5 por arredondamento.
    expect(validateUserRatingValue(0.25, 5).ok).toBe(false);
  });

  it("(4) rejeita acima do maximo (5.5)", () => {
    const result = validateUserRatingValue(5.5, 5);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("maxima e 5"))).toBe(true);
  });

  it("(5) rejeita valores fora do passo 0.5 (4.75, 3.2) sem truncar", () => {
    for (const value of [4.75, 3.2, 1.1, 2.3]) {
      const result = validateUserRatingValue(value, 5);
      expect(result.ok, `valor ${value} deveria ser rejeitado`).toBe(false);
      expect(result.errors.some((e) => e.includes("passos de 0.5"))).toBe(true);
    }
  });

  it("(6) rejeita NaN, Infinity e -Infinity", () => {
    expect(validateUserRatingValue(Number.NaN, 5).ok).toBe(false);
    expect(validateUserRatingValue(Number.POSITIVE_INFINITY, 5).ok).toBe(false);
    expect(validateUserRatingValue(Number.NEGATIVE_INFINITY, 5).ok).toBe(false);
  });

  it("(7) rejeita nao-numeros (string, null, undefined) via Number.isFinite", () => {
    expect(validateUserRatingValue("4.5" as unknown as number, 5).ok).toBe(false);
    expect(validateUserRatingValue(null as unknown as number, 5).ok).toBe(false);
    expect(validateUserRatingValue(undefined as unknown as number, 5).ok).toBe(false);
  });

  it("(8) rejeita escala de fonte externa (10 e 100) — escala fixa 5", () => {
    expect(validateUserRatingValue(8, 10).ok).toBe(false);
    expect(validateUserRatingValue(8, 10).errors.some((e) => e.includes("escala"))).toBe(true);
    expect(validateUserRatingValue(92, 100).ok).toBe(false);
  });

  it("(9) acumula multiplas violacoes (fora do passo + escala errada)", () => {
    const result = validateUserRatingValue(4.75, 10);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("isRatableEntityType — CHECK do banco (nunca person)", () => {
  it("(10) aceita movie, tv, season e episode", () => {
    for (const t of ["movie", "tv", "season", "episode"]) {
      expect(isRatableEntityType(t)).toBe(true);
    }
  });

  it("(11) rejeita person, article, vazio, desconhecidos e nao-strings (fail-closed)", () => {
    for (const t of ["person", "article", "", "franchise", "tv_show"]) {
      expect(isRatableEntityType(t)).toBe(false);
    }
    expect(isRatableEntityType(undefined)).toBe(false);
    expect(isRatableEntityType(null)).toBe(false);
    expect(isRatableEntityType(42)).toBe(false);
  });
});

describe("assertRatingMutationAllowed — gate por estado da conta", () => {
  it("(12) libera conta active", () => {
    expect(assertRatingMutationAllowed("active")).toEqual({ ok: true, value: true });
  });

  it("(13) bloqueia disabled, pending_deletion e deleted (forbidden)", () => {
    for (const status of ["disabled", "pending_deletion", "deleted"] as const) {
      const result = assertRatingMutationAllowed(status);
      expect(result.ok, `${status} deveria bloquear`).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("forbidden");
      }
    }
  });

  it("(14) bloqueia estado desconhecido (fail-closed)", () => {
    const result = assertRatingMutationAllowed("frozen" as UserStatus);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("forbidden");
    }
  });
});
