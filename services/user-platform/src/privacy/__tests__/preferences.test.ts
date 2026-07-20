/**
 * Testes de preferencias de privacidade: privacidade por padrao, normalizacao
 * fail-closed (unknown -> private) e transicoes de visibilidade (publicar exige
 * email verificado).
 */

import { describe, expect, it } from "vitest";
import {
  normalizeProfileVisibility,
  normalizeVisibility,
  PRIVACY_DEFAULTS,
  toPublicPrivacyPreferences,
  validateContentVisibilityTransition,
  validateProfileVisibilityTransition,
} from "../preferences.js";

const VERIFIED = new Date("2026-07-17T12:00:00.000Z");

describe("defaults e normalizacao (fail-closed)", () => {
  it("(1) defaults sao todos private", () => {
    expect(PRIVACY_DEFAULTS.profileVisibility).toBe("private");
    expect(PRIVACY_DEFAULTS.listVisibility).toBe("private");
    expect(PRIVACY_DEFAULTS.watchStateVisibility).toBe("private");
    expect(PRIVACY_DEFAULTS.reviewVisibility).toBe("private");
  });

  it("(2) valor desconhecido de perfil -> private", () => {
    expect(normalizeProfileVisibility(undefined)).toBe("private");
    expect(normalizeProfileVisibility("hacker")).toBe("private");
    expect(normalizeProfileVisibility(123)).toBe("private");
    expect(normalizeProfileVisibility("public")).toBe("public");
  });

  it("(3) valor desconhecido de conteudo -> private", () => {
    expect(normalizeVisibility(null)).toBe("private");
    expect(normalizeVisibility("weird")).toBe("private");
    expect(normalizeVisibility("unlisted")).toBe("unlisted");
  });

  it("(4) DTO publico monta com defaults e nunca expoe id interno", () => {
    const dto = toPublicPrivacyPreferences({});
    expect(dto).toEqual({
      profileVisibility: "private",
      defaultListVisibility: "private",
      defaultWatchStateVisibility: "private",
    });
    expect(JSON.stringify(dto)).not.toContain("id");
  });
});

describe("validateProfileVisibilityTransition", () => {
  it("(1) publicar exige email verificado", () => {
    expect(validateProfileVisibilityTransition({ to: "public", emailVerifiedAt: null }).ok).toBe(
      false,
    );
    expect(
      validateProfileVisibilityTransition({ to: "public", emailVerifiedAt: VERIFIED }).ok,
    ).toBe(true);
  });

  it("(2) voltar a private e sempre permitido", () => {
    expect(
      validateProfileVisibilityTransition({ to: "private", emailVerifiedAt: null }).ok,
    ).toBe(true);
  });

  it("(3) alvo desconhecido e rejeitado (fail-closed)", () => {
    expect(validateProfileVisibilityTransition({ to: "weird", emailVerifiedAt: VERIFIED }).ok).toBe(
      false,
    );
  });
});

describe("validateContentVisibilityTransition", () => {
  it("(1) public e unlisted exigem email verificado; private sempre ok", () => {
    expect(validateContentVisibilityTransition({ to: "public", emailVerifiedAt: null }).ok).toBe(
      false,
    );
    expect(validateContentVisibilityTransition({ to: "unlisted", emailVerifiedAt: null }).ok).toBe(
      false,
    );
    expect(validateContentVisibilityTransition({ to: "private", emailVerifiedAt: null }).ok).toBe(
      true,
    );
    expect(
      validateContentVisibilityTransition({ to: "public", emailVerifiedAt: VERIFIED }).ok,
    ).toBe(true);
  });

  it("(2) alvo desconhecido e rejeitado", () => {
    expect(validateContentVisibilityTransition({ to: 42, emailVerifiedAt: VERIFIED }).ok).toBe(
      false,
    );
  });
});
