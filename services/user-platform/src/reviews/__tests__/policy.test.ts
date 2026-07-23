/**
 * Testes da politica de REVIEWS: gate de mutacao do autor (por estado da
 * conta), guard de visibilidade e guard de entidade revisavel (nunca person).
 */

import { describe, expect, it } from "vitest";
import type { UserStatus } from "../../core/types.js";
import { assertAuthorMutationAllowed, isVisibility } from "../policy.js";
import { isReviewableEntityType } from "../types.js";

describe("assertAuthorMutationAllowed", () => {
  it("(1) libera conta active", () => {
    expect(assertAuthorMutationAllowed("active")).toEqual({ ok: true, value: true });
  });

  it("(2) bloqueia disabled, pending_deletion e deleted (forbidden)", () => {
    for (const status of ["disabled", "pending_deletion", "deleted"] as const) {
      const result = assertAuthorMutationAllowed(status);
      expect(result.ok, `${status} deveria bloquear`).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("forbidden");
      }
    }
  });

  it("(3) bloqueia estado desconhecido (fail-closed)", () => {
    const result = assertAuthorMutationAllowed("frozen" as UserStatus);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("forbidden");
    }
  });
});

describe("isVisibility", () => {
  it("(4) aceita private, unlisted e public", () => {
    for (const v of ["private", "unlisted", "public"]) {
      expect(isVisibility(v)).toBe(true);
    }
  });

  it("(5) rejeita desconhecidos e nao-strings (fail-closed)", () => {
    for (const v of ["", "hidden", "PUBLIC"]) {
      expect(isVisibility(v)).toBe(false);
    }
    expect(isVisibility(undefined)).toBe(false);
    expect(isVisibility(null)).toBe(false);
    expect(isVisibility(1)).toBe(false);
  });
});

describe("isReviewableEntityType", () => {
  it("(6) aceita movie, tv, season e episode", () => {
    for (const t of ["movie", "tv", "season", "episode"]) {
      expect(isReviewableEntityType(t)).toBe(true);
    }
  });

  it("(7) rejeita person, article, vazio e nao-strings (CHECK do banco)", () => {
    for (const t of ["person", "article", "", "franchise"]) {
      expect(isReviewableEntityType(t)).toBe(false);
    }
    expect(isReviewableEntityType(undefined)).toBe(false);
    expect(isReviewableEntityType(42)).toBe(false);
  });
});
