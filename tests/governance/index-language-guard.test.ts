/**
 * Teste de governanca (Fase 1, item 4) — trava de indexacao por idioma.
 *
 * Invariantes 7/9: page_indexability_decisions.decision='index' so e permitido
 * quando o idioma indexa por padrao (index_default=true) OU ha aprovacao
 * explicita de revisao. en/es (index_default=false) nao podem virar 'index'
 * por padrao.
 */

import { describe, expect, it } from "vitest";
import { assertIndexDecisionForLanguage, isIndexDecisionAllowedForLanguage } from "@screena/seo";

describe("guarda de indexacao por idioma (invariantes 7/9)", () => {
  it("proibe index quando index_default=false e sem aprovacao (en/es)", () => {
    const input = { decision: "index", languageIndexDefault: false } as const;
    expect(isIndexDecisionAllowedForLanguage(input)).toBe(false);
    expect(() => assertIndexDecisionForLanguage(input)).toThrow();
  });

  it("permite index quando o idioma indexa por padrao (pt-BR)", () => {
    const input = { decision: "index", languageIndexDefault: true } as const;
    expect(isIndexDecisionAllowedForLanguage(input)).toBe(true);
    expect(() => assertIndexDecisionForLanguage(input)).not.toThrow();
  });

  it("permite index para idioma nao-default quando ha aprovacao explicita de revisao", () => {
    const input = {
      decision: "index",
      languageIndexDefault: false,
      hasExplicitReviewApproval: true,
    } as const;
    expect(isIndexDecisionAllowedForLanguage(input)).toBe(true);
  });

  it("decisoes diferentes de index sao sempre permitidas, mesmo sem index_default", () => {
    for (const decision of ["noindex", "draft", "stale", "blocked"] as const) {
      expect(isIndexDecisionAllowedForLanguage({ decision, languageIndexDefault: false })).toBe(true);
    }
  });
});
