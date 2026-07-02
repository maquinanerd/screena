/**
 * Testes puros da classificacao/agregacao editorial do admin read-only.
 *
 * Garantem que: as contagens do dashboard agregam corretamente (particao exata,
 * numeros reais), artigos e content_blocks sao classificados nos baldes certos,
 * o banco vazio produz zeros (sem inventar numeros) e o limite de listagem e
 * exportado e respeitado.
 */

import { describe, expect, it } from "vitest";

import {
  ADMIN_LIST_LIMIT,
  aggregateArticleGroups,
  aggregateContentBlockGroups,
  classifyArticle,
  classifyContentBlock,
  isDisplayableLicense,
  isPublishableReview,
  isSufficientBody,
  MIN_ARTICLE_BODY_CHARS,
  type ArticleGroup,
  type ArticleRowInput,
  type ContentBlockGroup,
} from "../../apps/admin/src/lib/editorial-status";

const LONG_BODY = "x".repeat(MIN_ARTICLE_BODY_CHARS);

function articleRow(overrides: Partial<ArticleRowInput> = {}): ArticleRowInput {
  return {
    reviewStatus: "published",
    indexStatus: "index",
    licenseStatus: "official",
    displayAllowed: true,
    slug: "artigo",
    title: "Artigo",
    publishedAtIso: "2026-06-30T12:00:00.000Z",
    body: LONG_BODY,
    ...overrides,
  };
}

describe("classifyArticle", () => {
  it("classifica versao verde como publishable, sem lacunas", () => {
    const result = classifyArticle(articleRow());
    expect(result.status).toBe("publishable");
    expect(result.issues).toEqual([]);
  });

  it("marca blocked quando a licenca nao e exibivel", () => {
    expect(classifyArticle(articleRow({ licenseStatus: "unknown" })).status).toBe("blocked");
    expect(classifyArticle(articleRow({ licenseStatus: "blocked" })).status).toBe("blocked");
  });

  it("marca blocked quando display nao e permitido", () => {
    expect(classifyArticle(articleRow({ displayAllowed: false })).status).toBe("blocked");
  });

  it("marca blocked quando a revisao esta bloqueada/arquivada ou index_status=blocked", () => {
    expect(classifyArticle(articleRow({ reviewStatus: "blocked" })).status).toBe("blocked");
    expect(classifyArticle(articleRow({ reviewStatus: "archived" })).status).toBe("blocked");
    expect(classifyArticle(articleRow({ indexStatus: "blocked" })).status).toBe("blocked");
  });

  it("marca noindex quando revisado/licenciado mas index_status != index", () => {
    expect(classifyArticle(articleRow({ indexStatus: "noindex" })).status).toBe("noindex");
    expect(classifyArticle(articleRow({ indexStatus: "draft" })).status).toBe("noindex");
  });

  it("marca noindex quando ainda em revisao (draft/needs_review), nunca blocked", () => {
    expect(classifyArticle(articleRow({ reviewStatus: "draft", indexStatus: "noindex" })).status).toBe(
      "noindex",
    );
    expect(
      classifyArticle(articleRow({ reviewStatus: "needs_review", indexStatus: "noindex" })).status,
    ).toBe("noindex");
  });

  it("reporta lacunas de campo sem alterar o status", () => {
    const result = classifyArticle(
      articleRow({ slug: "  ", title: null, publishedAtIso: null, body: "curto" }),
    );
    expect(result.issues).toEqual(["sem slug", "sem titulo", "sem data", "corpo insuficiente"]);
    // Continua publishable pelas dimensoes de licenca/revisao/index (particao coarse).
    expect(result.status).toBe("publishable");
  });
});

describe("classifyContentBlock", () => {
  it("particiona por reviewStatus", () => {
    expect(classifyContentBlock("published")).toBe("publishable");
    expect(classifyContentBlock("human_reviewed")).toBe("publishable");
    expect(classifyContentBlock("draft")).toBe("pending");
    expect(classifyContentBlock("ai_generated")).toBe("pending");
    expect(classifyContentBlock("needs_review")).toBe("pending");
    expect(classifyContentBlock("needs_update")).toBe("pending");
    expect(classifyContentBlock("blocked")).toBe("blocked");
    expect(classifyContentBlock("archived")).toBe("blocked");
  });
});

describe("aggregateArticleGroups", () => {
  it("banco vazio -> zeros (nao inventa numeros)", () => {
    expect(aggregateArticleGroups([])).toEqual({
      total: 0,
      publishable: 0,
      noindex: 0,
      blocked: 0,
    });
  });

  it("soma contagens reais e particiona (soma dos baldes = total)", () => {
    const groups: ArticleGroup[] = [
      // publishable
      { reviewStatus: "published", indexStatus: "index", licenseStatus: "official", displayAllowed: true, count: 5 },
      // noindex (revisado, licenca ok, mas index != index)
      { reviewStatus: "human_reviewed", indexStatus: "noindex", licenseStatus: "licensed", displayAllowed: true, count: 3 },
      // noindex (draft aguardando revisao)
      { reviewStatus: "draft", indexStatus: "noindex", licenseStatus: "official", displayAllowed: true, count: 4 },
      // blocked (licenca)
      { reviewStatus: "published", indexStatus: "index", licenseStatus: "unknown", displayAllowed: true, count: 2 },
      // blocked (display)
      { reviewStatus: "published", indexStatus: "index", licenseStatus: "official", displayAllowed: false, count: 1 },
    ];
    const counts = aggregateArticleGroups(groups);
    expect(counts).toEqual({ total: 15, publishable: 5, noindex: 7, blocked: 3 });
    expect(counts.publishable + counts.noindex + counts.blocked).toBe(counts.total);
  });

  it("ignora contagens negativas/nao finitas", () => {
    const groups: ArticleGroup[] = [
      { reviewStatus: "published", indexStatus: "index", licenseStatus: "official", displayAllowed: true, count: -3 },
      { reviewStatus: "published", indexStatus: "index", licenseStatus: "official", displayAllowed: true, count: 2 },
    ];
    expect(aggregateArticleGroups(groups)).toEqual({
      total: 2,
      publishable: 2,
      noindex: 0,
      blocked: 0,
    });
  });
});

describe("aggregateContentBlockGroups", () => {
  it("banco vazio -> zeros", () => {
    expect(aggregateContentBlockGroups([])).toEqual({
      total: 0,
      publishable: 0,
      pending: 0,
      blocked: 0,
    });
  });

  it("soma e particiona por reviewStatus", () => {
    const groups: ContentBlockGroup[] = [
      { reviewStatus: "published", count: 2 },
      { reviewStatus: "human_reviewed", count: 1 },
      { reviewStatus: "draft", count: 4 },
      { reviewStatus: "needs_review", count: 3 },
      { reviewStatus: "blocked", count: 1 },
      { reviewStatus: "archived", count: 1 },
    ];
    const counts = aggregateContentBlockGroups(groups);
    expect(counts).toEqual({ total: 12, publishable: 3, pending: 7, blocked: 2 });
    expect(counts.publishable + counts.pending + counts.blocked).toBe(counts.total);
  });
});

describe("predicados e constantes", () => {
  it("isDisplayableLicense cobre official/licensed/third_party e rejeita o resto", () => {
    expect(isDisplayableLicense("official")).toBe(true);
    expect(isDisplayableLicense("licensed")).toBe(true);
    expect(isDisplayableLicense("third_party")).toBe(true);
    expect(isDisplayableLicense("unknown")).toBe(false);
    expect(isDisplayableLicense("blocked")).toBe(false);
  });

  it("isPublishableReview cobre so human_reviewed/published", () => {
    expect(isPublishableReview("human_reviewed")).toBe(true);
    expect(isPublishableReview("published")).toBe(true);
    expect(isPublishableReview("draft")).toBe(false);
    expect(isPublishableReview("ai_generated")).toBe(false);
  });

  it("isSufficientBody respeita o limiar de chars", () => {
    expect(isSufficientBody(LONG_BODY)).toBe(true);
    expect(isSufficientBody("x".repeat(MIN_ARTICLE_BODY_CHARS - 1))).toBe(false);
    expect(isSufficientBody(null)).toBe(false);
    expect(isSufficientBody("   ")).toBe(false);
  });

  it("exporta um limite de listagem positivo", () => {
    expect(ADMIN_LIST_LIMIT).toBeGreaterThan(0);
    expect(Number.isInteger(ADMIN_LIST_LIMIT)).toBe(true);
  });
});
