/**
 * editorial-review.test.ts — "Esta página ainda está em revisão editorial." só
 * quando é verdade.
 *
 * Medido em produção em 22/09/2026: a página do Josh Brolin e a ficha
 * `tmdb-1465816` exibiam a frase, e as duas estavam fora do índice por PORTÃO
 * DE QUALIDADE — ninguém as revisava.
 */

import { describe, expect, it } from "vitest";
import type { DecisionSource } from "@screena/seo";

import { isEditorialReviewPending } from "../editorial-review";

function seo(decision: "index" | "noindex" | "stale" | "blocked" | "draft", decisionSource: DecisionSource) {
  return { decision, decisionSource };
}

describe("isEditorialReviewPending", () => {
  it("(1) página esperando decisão diz que está em revisão", () => {
    expect(isEditorialReviewPending(seo("noindex", "entity-not-published"))).toBe(true);
    expect(isEditorialReviewPending(seo("noindex", "absent-decision-armed"))).toBe(true);
    expect(isEditorialReviewPending(seo("stale", "stale-invalidation"))).toBe(true);
  });

  it("(2) CONTROLE — o caso medido: portão de qualidade NÃO é revisão editorial", () => {
    expect(isEditorialReviewPending(seo("noindex", "quality-gate"))).toBe(false);
  });

  it("(3) caso técnico, licença, idioma, exclusão registrada e decisão persistida também não", () => {
    for (const fonte of [
      "technical-invalid",
      "license-blocked",
      "language-not-published",
      "explicit-exclusion",
      "persisted-decision",
      "news-attribution-missing",
    ] as const) {
      expect(isEditorialReviewPending(seo("noindex", fonte)), fonte).toBe(false);
    }
  });

  it("(4) a válvula de emergência rebaixa `index` mantendo a fonte da resolução: não é revisão", () => {
    // `applyPageSuspension` troca a decisão e o motivo, e deixa `decisionSource`
    // como veio (`total-indexing`).
    expect(isEditorialReviewPending(seo("noindex", "total-indexing"))).toBe(false);
  });

  it("(5) página no índice nunca diz que está em revisão", () => {
    expect(isEditorialReviewPending(seo("index", "entity-not-published"))).toBe(false);
    expect(isEditorialReviewPending(seo("index", "total-indexing"))).toBe(false);
  });
});
