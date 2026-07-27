/**
 * Testes do gate CANONICO de publicabilidade de artigo.
 *
 * Este modulo e a fonte unica consumida por listagem, pagina de artigo,
 * noticias relacionadas, sitemap, projecao de busca e indexabilidade. Ele
 * estava coberto apenas de forma transitiva pelos consumidores — o que e
 * exatamente o tipo de lacuna que deixa uma regra central mudar sem ninguem
 * perceber. Aqui ele e testado diretamente, com foco no eixo TEMPORAL, que foi
 * a origem do vazamento de materia agendada.
 */

import { describe, expect, it } from "vitest";

import {
  evaluateArticlePublication,
  isArticlePublishable,
  isPubliclyRenderableArticleReviewStatus,
  isRetractedArticleReviewStatus,
  PUBLICLY_RENDERABLE_ARTICLE_REVIEW_STATUSES,
  RETRACTED_ARTICLE_REVIEW_STATUSES,
  resolveArticlePublishedIso,
  type ArticlePublicationInput,
} from "./article-publication.js";

const NOW = "2026-07-20T12:00:00.000Z";

function article(overrides: Partial<ArticlePublicationInput> = {}): ArticlePublicationInput {
  return {
    reviewStatus: "published",
    licenseStatus: "official",
    displayAllowed: true,
    slug: "materia",
    title: "Uma materia real",
    publishedAtIso: "2026-07-19T10:00:00.000Z",
    ...overrides,
  };
}

describe("caso feliz", () => {
  it("artigo publicado, licenciado e ja datado e publicavel", () => {
    const verdict = evaluateArticlePublication(article(), NOW);
    expect(verdict.publishable).toBe(true);
    expect(verdict.reasons).toEqual([]);
    expect(isArticlePublishable(article(), NOW)).toBe(true);
  });

  it("human_reviewed tambem publica", () => {
    expect(isArticlePublishable(article({ reviewStatus: "human_reviewed" }), NOW)).toBe(true);
  });
});

describe("eixo TEMPORAL (origem do vazamento de materia agendada)", () => {
  it("data no FUTURO nao publica, mesmo com review published", () => {
    const verdict = evaluateArticlePublication(
      article({ publishedAtIso: "2026-12-01T00:00:00.000Z" }),
      NOW,
    );
    expect(verdict.publishable).toBe(false);
    expect(verdict.reasons).toContain("future_scheduled");
  });

  it("um milissegundo no futuro ainda e embargo", () => {
    expect(
      isArticlePublishable(article({ publishedAtIso: "2026-07-20T12:00:00.001Z" }), NOW),
    ).toBe(false);
  });

  it("o instante EXATO de publicacao ja e publico (comparacao inclusiva)", () => {
    expect(isArticlePublishable(article({ publishedAtIso: NOW }), NOW)).toBe(true);
  });

  it("data ausente nao publica", () => {
    const verdict = evaluateArticlePublication(article({ publishedAtIso: null }), NOW);
    expect(verdict.reasons).toContain("missing_publication_date");
  });

  it("FAIL-CLOSED: data ilegivel nao publica", () => {
    expect(isArticlePublishable(article({ publishedAtIso: "nao-e-data" }), NOW)).toBe(false);
  });

  it("FAIL-CLOSED: relogio ilegivel nao libera nada", () => {
    // Sem instante confiavel para comparar, nenhum artigo com data e liberado.
    expect(isArticlePublishable(article(), "relogio-quebrado")).toBe(false);
    expect(isArticlePublishable(article(), "")).toBe(false);
  });

  it("o veredito depende do RELOGIO INJETADO, nao do relogio do processo", () => {
    const scheduled = article({ publishedAtIso: "2026-08-01T00:00:00.000Z" });
    expect(isArticlePublishable(scheduled, "2026-07-31T23:59:59.999Z")).toBe(false);
    expect(isArticlePublishable(scheduled, "2026-08-01T00:00:00.000Z")).toBe(true);
  });
});

describe("review_status", () => {
  it("estados de trabalho em andamento nao publicam", () => {
    for (const status of ["draft", "ai_generated", "needs_review", "needs_update"]) {
      const verdict = evaluateArticlePublication(article({ reviewStatus: status }), NOW);
      expect(verdict.publishable, status).toBe(false);
      expect(verdict.reasons, status).toContain("not_published");
    }
  });

  it("retratada e distinguida de rascunho (motivo proprio)", () => {
    for (const status of RETRACTED_ARTICLE_REVIEW_STATUSES) {
      const verdict = evaluateArticlePublication(article({ reviewStatus: status }), NOW);
      expect(verdict.publishable, status).toBe(false);
      expect(verdict.reasons, status).toContain("retracted");
      expect(verdict.reasons, status).not.toContain("not_published");
    }
  });

  it("os dois conjuntos de status sao disjuntos", () => {
    for (const status of PUBLICLY_RENDERABLE_ARTICLE_REVIEW_STATUSES) {
      expect(isPubliclyRenderableArticleReviewStatus(status)).toBe(true);
      expect(isRetractedArticleReviewStatus(status)).toBe(false);
    }
  });
});

describe("licenca (invariante 6)", () => {
  it("licencas exibiveis passam", () => {
    for (const license of ["official", "licensed", "third_party"]) {
      expect(isArticlePublishable(article({ licenseStatus: license }), NOW), license).toBe(true);
    }
  });

  it("unknown/blocked nao publicam", () => {
    for (const license of ["unknown", "blocked", "qualquer-coisa"]) {
      const verdict = evaluateArticlePublication(article({ licenseStatus: license }), NOW);
      expect(verdict.reasons, license).toContain("blocked_license");
    }
  });

  it("display_allowed=false e gate-mestra", () => {
    expect(
      evaluateArticlePublication(article({ displayAllowed: false }), NOW).reasons,
    ).toContain("display_not_allowed");
  });
});

describe("atribuicao e linkback", () => {
  it("atribuicao exigida sem fonte nao publica", () => {
    const verdict = evaluateArticlePublication(
      article({ requiresAttribution: true, sourceName: null }),
      NOW,
    );
    expect(verdict.reasons).toContain("missing_required_attribution");
  });

  it("linkback exigido sem URL nao publica", () => {
    const verdict = evaluateArticlePublication(
      article({ requiresLinkback: true, sourceUrl: null }),
      NOW,
    );
    expect(verdict.reasons).toContain("missing_required_linkback");
  });

  it("exigencias satisfeitas publicam", () => {
    expect(
      isArticlePublishable(
        article({
          requiresAttribution: true,
          requiresLinkback: true,
          sourceName: "Collider",
          sourceUrl: "https://collider.com/x",
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("string em branco nao satisfaz a exigencia", () => {
    expect(
      evaluateArticlePublication(
        article({ requiresAttribution: true, sourceName: "   " }),
        NOW,
      ).reasons,
    ).toContain("missing_required_attribution");
  });
});

describe("campos obrigatorios e determinismo", () => {
  it("slug/titulo em branco nao publicam", () => {
    expect(evaluateArticlePublication(article({ slug: "  " }), NOW).reasons).toContain(
      "missing_slug",
    );
    expect(evaluateArticlePublication(article({ title: null }), NOW).reasons).toContain(
      "missing_headline",
    );
  });

  it("acumula TODOS os motivos (nao para no primeiro)", () => {
    const verdict = evaluateArticlePublication(
      article({ reviewStatus: "draft", licenseStatus: "blocked", slug: null, title: null }),
      NOW,
    );
    expect(verdict.reasons).toEqual(
      expect.arrayContaining(["not_published", "blocked_license", "missing_slug", "missing_headline"]),
    );
  });

  it("mesma entrada -> mesma saida (ordem estavel)", () => {
    const input = article({ reviewStatus: "draft", licenseStatus: "unknown" });
    expect(evaluateArticlePublication(input, NOW).reasons).toEqual(
      evaluateArticlePublication(input, NOW).reasons,
    );
  });
});

describe("resolveArticlePublishedIso", () => {
  it("a data da traducao vence a do artigo", () => {
    expect(resolveArticlePublishedIso("2026-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("cai para a do artigo quando a traducao nao tem", () => {
    expect(resolveArticlePublishedIso(null, "2025-01-01T00:00:00.000Z")).toBe(
      "2025-01-01T00:00:00.000Z",
    );
    expect(resolveArticlePublishedIso("   ", "2025-01-01T00:00:00.000Z")).toBe(
      "2025-01-01T00:00:00.000Z",
    );
  });

  it("sem nenhuma das duas -> null", () => {
    expect(resolveArticlePublishedIso(null, null)).toBeNull();
  });
});
