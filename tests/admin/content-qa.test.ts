/**
 * Testes PUROS do QA editorial (Fase 7D).
 *
 * Cobrem cada categoria de issue (slug/titulo/corpo/review/licenca/display/index/
 * idioma/bloco), o score 0..100, severidades deterministas e ausencia de corpo
 * completo / segredo na saida.
 */

import { describe, expect, it } from "vitest";

import {
  buildQaIssue,
  calculateQaScore,
  evaluateArticleQa,
  evaluateBodyQuality,
  evaluateContentBlockQa,
  evaluateSlugQuality,
  evaluateTitleQuality,
  getQaSeverity,
  MIN_TITLE_CHARS,
  summarizeQaIssues,
  worstSeverity,
  type ArticleQaInput,
  type ContentBlockQaInput,
  type QaIssue,
} from "../../apps/admin/src/lib/content-qa";

function healthyArticle(overrides: Partial<ArticleQaInput> = {}): ArticleQaInput {
  return {
    reviewStatus: "published",
    licenseStatus: "official",
    displayAllowed: true,
    slug: "um-artigo-completo",
    title: "Um Titulo Suficientemente Longo",
    publishedAtIso: "2026-06-30T12:00:00.000Z",
    bodyChars: 300,
    indexStatus: "index",
    languageCode: "pt-BR",
    updatedAtIso: "2026-06-30T12:00:00.000Z",
    ...overrides,
  };
}

function categories(input: ArticleQaInput): string[] {
  return evaluateArticleQa(input).issues.map((i) => i.category);
}

function healthyBlock(overrides: Partial<ContentBlockQaInput> = {}): ContentBlockQaInput {
  return { reviewStatus: "published", contentChars: 120, languageCode: "pt-BR", ...overrides };
}

describe("evaluateArticleQa — artigo saudavel", () => {
  it("index_ready, score 100, severidade success", () => {
    const qa = evaluateArticleQa(healthyArticle());
    expect(qa.severity).toBe("success");
    expect(qa.score).toBe(100);
    expect(qa.issues.map((i) => i.category)).toContain("index_ready");
    expect(qa.readinessLevel).toBe("index_ready");
  });
});

describe("evaluateArticleQa — categorias criticas/warning", () => {
  it("sem slug -> missing_slug (critical)", () => {
    const qa = evaluateArticleQa(healthyArticle({ slug: null }));
    expect(qa.issues.map((i) => i.category)).toContain("missing_slug");
    expect(qa.severity).toBe("critical");
  });

  it("slug inseguro -> unsafe_slug", () => {
    expect(categories(healthyArticle({ slug: "a/b" }))).toContain("unsafe_slug");
    expect(categories(healthyArticle({ slug: "../x" }))).toContain("unsafe_slug");
  });

  it("sem titulo -> missing_title; titulo curto -> short_title", () => {
    expect(categories(healthyArticle({ title: "   " }))).toContain("missing_title");
    expect(categories(healthyArticle({ title: "Curto" }))).toContain("short_title");
  });

  it("sem corpo -> missing_body; corpo fino -> thin_body", () => {
    expect(categories(healthyArticle({ bodyChars: 0 }))).toContain("missing_body");
    expect(categories(healthyArticle({ bodyChars: 50 }))).toContain("thin_body");
  });

  it("sem publishedAt -> missing_published_at", () => {
    expect(categories(healthyArticle({ publishedAtIso: null }))).toContain("missing_published_at");
  });

  it("review pendente -> pending_review; rejeitado -> rejected_review", () => {
    expect(categories(healthyArticle({ reviewStatus: "draft" }))).toContain("pending_review");
    expect(categories(healthyArticle({ reviewStatus: "blocked" }))).toContain("rejected_review");
    expect(categories(healthyArticle({ reviewStatus: "archived" }))).toContain("rejected_review");
  });

  it("licenca bloqueada -> blocked_license; display -> display_not_allowed", () => {
    expect(categories(healthyArticle({ licenseStatus: "blocked" }))).toContain("blocked_license");
    expect(categories(healthyArticle({ licenseStatus: "unknown" }))).toContain("blocked_license");
    expect(categories(healthyArticle({ displayAllowed: false }))).toContain("display_not_allowed");
  });

  it("index_status=noindex -> forced_noindex; idioma en -> non_pt_br", () => {
    expect(categories(healthyArticle({ indexStatus: "noindex" }))).toContain("forced_noindex");
    expect(categories(healthyArticle({ languageCode: "en" }))).toContain("non_pt_br");
  });

  it("corpo fino + index -> visible_but_noindex (nao index_ready)", () => {
    const cats = categories(healthyArticle({ bodyChars: 50 }));
    expect(cats).toContain("visible_but_noindex");
    expect(cats).not.toContain("index_ready");
  });

  it("stale_content so com nowIso e updatedAt antigo", () => {
    const old = healthyArticle({ updatedAtIso: "2026-01-01T00:00:00.000Z" });
    expect(evaluateArticleQa(old).issues.map((i) => i.category)).not.toContain("stale_content");
    const withNow = evaluateArticleQa(old, { nowIso: "2027-01-01T00:00:00.000Z" });
    expect(withNow.issues.map((i) => i.category)).toContain("stale_content");
  });
});

describe("evaluateContentBlockQa", () => {
  it("bloco saudavel -> success", () => {
    const qa = evaluateContentBlockQa(healthyBlock());
    expect(qa.severity).toBe("success");
    expect(qa.score).toBe(100);
  });

  it("vazio -> content_block_empty; pendente -> content_block_pending; rejeitado -> content_block_rejected", () => {
    expect(evaluateContentBlockQa(healthyBlock({ contentChars: 0 })).issues.map((i) => i.category)).toContain(
      "content_block_empty",
    );
    expect(
      evaluateContentBlockQa(healthyBlock({ reviewStatus: "ai_generated" })).issues.map((i) => i.category),
    ).toContain("content_block_pending");
    expect(
      evaluateContentBlockQa(healthyBlock({ reviewStatus: "blocked" })).issues.map((i) => i.category),
    ).toContain("content_block_rejected");
  });

  it("entidade inexistente -> content_block_unknown_entity; idioma en -> non_pt_br", () => {
    expect(
      evaluateContentBlockQa(healthyBlock({ entityMissing: true })).issues.map((i) => i.category),
    ).toContain("content_block_unknown_entity");
    expect(
      evaluateContentBlockQa(healthyBlock({ languageCode: "en" })).issues.map((i) => i.category),
    ).toContain("non_pt_br");
  });
});

describe("sub-avaliadores e score", () => {
  it("evaluateSlugQuality / Title / Body", () => {
    expect(evaluateSlugQuality(null)).toEqual({ missing: true, unsafe: false });
    expect(evaluateSlugQuality("a?b").unsafe).toBe(true);
    expect(evaluateTitleQuality("x").short).toBe(true);
    expect(evaluateTitleQuality("x".repeat(MIN_TITLE_CHARS)).short).toBe(false);
    expect(evaluateBodyQuality(0).missing).toBe(true);
    expect(evaluateBodyQuality(50).thin).toBe(true);
    expect(evaluateBodyQuality(300).sufficient).toBe(true);
  });

  it("getQaSeverity/buildQaIssue coerentes", () => {
    expect(getQaSeverity("missing_slug")).toBe("critical");
    expect(getQaSeverity("index_ready")).toBe("success");
    expect(buildQaIssue("thin_body").severity).toBe("warning");
    expect(buildQaIssue("thin_body").message.length).toBeGreaterThan(0);
  });

  it("calculateQaScore fica em 0..100 e worstSeverity ranqueia", () => {
    expect(calculateQaScore([])).toBe(100);
    const many: QaIssue[] = [
      buildQaIssue("missing_slug"),
      buildQaIssue("missing_title"),
      buildQaIssue("missing_body"),
      buildQaIssue("blocked_license"),
      buildQaIssue("display_not_allowed"),
    ];
    expect(calculateQaScore(many)).toBe(0);
    expect(worstSeverity(many)).toBe("critical");
    expect(worstSeverity([buildQaIssue("index_ready")])).toBe("success");
  });

  it("summarizeQaIssues conta por severidade e categoria", () => {
    const s = summarizeQaIssues([
      buildQaIssue("missing_slug"),
      buildQaIssue("thin_body"),
      buildQaIssue("thin_body"),
    ]);
    expect(s.bySeverity.critical).toBe(1);
    expect(s.bySeverity.warning).toBe(2);
    expect(s.byCategory.thin_body).toBe(2);
    expect(s.total).toBe(3);
  });

  it("score sempre 0..100 para qualquer entrada", () => {
    for (const input of [healthyArticle(), healthyArticle({ slug: null, title: null, bodyChars: 0, licenseStatus: "blocked", displayAllowed: false })]) {
      const qa = evaluateArticleQa(input);
      expect(qa.score).toBeGreaterThanOrEqual(0);
      expect(qa.score).toBeLessThanOrEqual(100);
    }
  });
});

describe("determinismo e ausencia de corpo/segredo", () => {
  it("mesma entrada -> mesmas issues", () => {
    const input = healthyArticle({ slug: null, bodyChars: 10 });
    expect(evaluateArticleQa(input).issues).toEqual(evaluateArticleQa(input).issues);
  });

  it("a saida nunca contem corpo completo nem segredo", () => {
    const body = "corpo-secreto-".repeat(30);
    const qa = evaluateArticleQa(healthyArticle({ bodyChars: body.length }));
    const dump = JSON.stringify(qa);
    expect(dump).not.toContain("corpo-secreto");
    for (const term of ["password", "senha", "authorization", "DATABASE_URL", "process.env"]) {
      expect(dump.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });
});
