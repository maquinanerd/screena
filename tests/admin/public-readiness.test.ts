/**
 * Testes PUROS da validacao de prontidao publica (Fase 7B).
 *
 * Cobrem: artigo pronto/bloqueado por cada gate (slug/titulo/publishedAt/corpo/
 * review/licenca/display/index/idioma), content_block, buildPublicArticleUrl,
 * determinismo dos issues e ausencia de segredo na saida.
 */

import { describe, expect, it } from "vitest";

import {
  articleReadinessLabel,
  buildPublicArticleUrl,
  buildReadinessIssues,
  contentBlockReadinessLabel,
  evaluateArticlePublicReadiness as evaluateArticlePublicReadinessAt,
  evaluateContentBlockPublicReadiness,
  getReadinessLevel,
  isSufficientBodyChars,
  readinessBadgeVariant,
  type ArticleReadinessInput,
  type ContentBlockReadinessInput,
} from "../../apps/admin/src/lib/public-readiness";

function readyArticle(overrides: Partial<ArticleReadinessInput> = {}): ArticleReadinessInput {
  return {
    reviewStatus: "published",
    licenseStatus: "official",
    displayAllowed: true,
    slug: "meu-artigo",
    title: "Meu Artigo",
    publishedAtIso: "2026-06-30T12:00:00.000Z",
    bodyChars: 250,
    indexStatus: "index",
    languageCode: "pt-BR",
    ...overrides,
  };
}

function readyBlock(overrides: Partial<ContentBlockReadinessInput> = {}): ContentBlockReadinessInput {
  return { reviewStatus: "published", contentChars: 120, languageCode: "pt-BR", ...overrides };
}


/** Instante bem depois das datas das fixtures; agendamento tem teste proprio. */
const NOW = "2026-07-05T00:00:00.000Z";

const evaluateArticlePublicReadiness = (input: ArticleReadinessInput) =>
  evaluateArticlePublicReadinessAt(input, NOW);

const issuesText = (input: ArticleReadinessInput): string =>
  evaluateArticlePublicReadiness(input).issues.join(" | ");

describe("evaluateArticlePublicReadiness — artigo pronto", () => {
  it("pronto para indexar quando todos os gates passam", () => {
    const r = evaluateArticlePublicReadiness(readyArticle());
    expect(r.level).toBe("index_ready");
    expect(r.canDisplay).toBe(true);
    expect(r.canIndex).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.primaryIssue).toBeNull();
    expect(r.publicUrl).toBe("https://cinerie.com/pt/noticias/meu-artigo/");
    expect(articleReadinessLabel(r.level)).toBe("Pronto para indexar");
    expect(readinessBadgeVariant(r.level)).toBe("ok");
  });
});

describe("evaluateArticlePublicReadiness — gates de EXIBICAO (bloqueiam display)", () => {
  it("sem slug", () => {
    const r = evaluateArticlePublicReadiness(readyArticle({ slug: null }));
    expect(r.canDisplay).toBe(false);
    expect(r.canIndex).toBe(false);
    expect(issuesText(readyArticle({ slug: null }))).toContain("sem slug");
    expect(r.publicUrl).toBeNull();
    expect(r.level).toBe("blocked");
  });

  it("sem titulo", () => {
    expect(issuesText(readyArticle({ title: "  " }))).toContain("sem titulo");
    expect(evaluateArticlePublicReadiness(readyArticle({ title: null })).canDisplay).toBe(false);
  });

  it("sem publishedAt", () => {
    expect(issuesText(readyArticle({ publishedAtIso: null }))).toContain("sem publishedAt");
    expect(evaluateArticlePublicReadiness(readyArticle({ publishedAtIso: null })).canDisplay).toBe(
      false,
    );
  });

  it("review pendente -> review_pending", () => {
    for (const review of ["draft", "ai_generated", "needs_review", "needs_update"]) {
      const r = evaluateArticlePublicReadiness(readyArticle({ reviewStatus: review }));
      expect(r.level, review).toBe("review_pending");
      expect(r.canDisplay).toBe(false);
      expect(r.issues.join(" ")).toContain("revisao pendente");
    }
  });

  it("review bloqueado/arquivado -> blocked", () => {
    for (const review of ["blocked", "archived"]) {
      const r = evaluateArticlePublicReadiness(readyArticle({ reviewStatus: review }));
      expect(r.level, review).toBe("blocked");
      expect(r.issues.join(" ")).toContain("bloqueado/arquivado");
    }
  });

  it("license nao exibivel -> blocked", () => {
    for (const license of ["unknown", "blocked"]) {
      const r = evaluateArticlePublicReadiness(readyArticle({ licenseStatus: license }));
      expect(r.level, license).toBe("blocked");
      expect(r.issues.join(" ")).toContain("license_status nao exibivel");
    }
  });

  it("display_allowed=false -> blocked", () => {
    const r = evaluateArticlePublicReadiness(readyArticle({ displayAllowed: false }));
    expect(r.level).toBe("blocked");
    expect(r.issues.join(" ")).toContain("display_allowed=false");
  });

  it("idioma nao-pt-BR -> sem exibicao publica, sem URL", () => {
    for (const lang of ["en", "es", "fr"]) {
      const r = evaluateArticlePublicReadiness(readyArticle({ languageCode: lang }));
      expect(r.canDisplay, lang).toBe(false);
      expect(r.publicUrl).toBeNull();
      expect(r.issues.join(" ")).toContain("pt-BR primeiro");
    }
  });
});

describe("evaluateArticlePublicReadiness — gates de INDEXACAO (exibivel, mas noindex)", () => {
  it("corpo insuficiente -> visivel, mas noindex", () => {
    const r = evaluateArticlePublicReadiness(readyArticle({ bodyChars: 10 }));
    expect(r.canDisplay).toBe(true);
    expect(r.canIndex).toBe(false);
    expect(r.level).toBe("visible_noindex");
    expect(r.issues.join(" ")).toContain("corpo insuficiente");
  });

  it("index_status != index -> visivel, mas noindex", () => {
    for (const idx of ["noindex", "draft", "stale", "blocked"]) {
      const r = evaluateArticlePublicReadiness(readyArticle({ indexStatus: idx }));
      // 'blocked' index_status nao bloqueia display (nao ha rating bloqueado aqui),
      // mas mantem a pagina fora do indice.
      expect(r.canIndex, idx).toBe(false);
      expect(r.issues.join(" ")).toContain("index_status != index");
    }
    expect(evaluateArticlePublicReadiness(readyArticle({ indexStatus: "noindex" })).level).toBe(
      "visible_noindex",
    );
  });
});

describe("buildPublicArticleUrl", () => {
  it("pt-BR/pt com slug seguro -> URL canonica com barra final", () => {
    expect(buildPublicArticleUrl("meu-artigo", "pt-BR")).toBe(
      "https://cinerie.com/pt/noticias/meu-artigo/",
    );
    expect(buildPublicArticleUrl("x", "pt")).toBe("https://cinerie.com/pt/noticias/x/");
  });

  it("null para idioma nao-pt-BR, slug ausente/vazio ou slug perigoso", () => {
    expect(buildPublicArticleUrl("x", "en")).toBeNull();
    expect(buildPublicArticleUrl(null, "pt-BR")).toBeNull();
    expect(buildPublicArticleUrl("   ", "pt-BR")).toBeNull();
    expect(buildPublicArticleUrl("a/b", "pt-BR")).toBeNull();
    expect(buildPublicArticleUrl("../x", "pt-BR")).toBeNull();
    expect(buildPublicArticleUrl("a?b", "pt-BR")).toBeNull();
    expect(buildPublicArticleUrl("a#b", "pt-BR")).toBeNull();
  });
});

describe("isSufficientBodyChars / getReadinessLevel", () => {
  it("corpo suficiente no limiar de 200", () => {
    expect(isSufficientBodyChars(199)).toBe(false);
    expect(isSufficientBodyChars(200)).toBe(true);
    expect(isSufficientBodyChars(Number.NaN)).toBe(false);
  });

  it("deriva o nivel a partir das portas", () => {
    expect(getReadinessLevel({ canDisplay: true, canIndex: true, hardBlocked: false, reviewPending: false })).toBe("index_ready");
    expect(getReadinessLevel({ canDisplay: true, canIndex: false, hardBlocked: false, reviewPending: false })).toBe("visible_noindex");
    expect(getReadinessLevel({ canDisplay: false, canIndex: false, hardBlocked: true, reviewPending: false })).toBe("blocked");
    expect(getReadinessLevel({ canDisplay: false, canIndex: false, hardBlocked: false, reviewPending: true })).toBe("review_pending");
    expect(getReadinessLevel({ canDisplay: false, canIndex: false, hardBlocked: false, reviewPending: false })).toBe("blocked");
  });
});

describe("evaluateContentBlockPublicReadiness", () => {
  it("publicavel + conteudo + pt-BR -> pronto", () => {
    const r = evaluateContentBlockPublicReadiness(readyBlock());
    expect(r.level).toBe("index_ready");
    expect(r.canDisplay).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.publicUrl).toBeNull();
    expect(contentBlockReadinessLabel(r.level)).toContain("Pronto");
  });

  it("review pendente -> review_pending", () => {
    const r = evaluateContentBlockPublicReadiness(readyBlock({ reviewStatus: "ai_generated" }));
    expect(r.level).toBe("review_pending");
    expect(r.canDisplay).toBe(false);
  });

  it("review bloqueado ou conteudo vazio -> blocked", () => {
    expect(evaluateContentBlockPublicReadiness(readyBlock({ reviewStatus: "blocked" })).level).toBe(
      "blocked",
    );
    const empty = evaluateContentBlockPublicReadiness(readyBlock({ contentChars: 0 }));
    expect(empty.level).toBe("blocked");
    expect(empty.issues.join(" ")).toContain("conteudo vazio");
  });

  it("idioma nao-pt-BR nao aparece publicamente", () => {
    const r = evaluateContentBlockPublicReadiness(readyBlock({ languageCode: "en" }));
    expect(r.canDisplay).toBe(false);
    expect(r.issues.join(" ")).toContain("pt-BR primeiro");
  });
});

describe("determinismo e ausencia de segredo", () => {
  it("issues sao deterministas (mesma entrada -> mesma ordem)", () => {
    const input = readyArticle({ slug: null, title: null, displayAllowed: false, bodyChars: 5 });
    expect(buildReadinessIssues(input, NOW)).toEqual(buildReadinessIssues(input, NOW));
  });

  it("nenhuma saida contem termo de segredo", () => {
    const samples = [
      JSON.stringify(evaluateArticlePublicReadiness(readyArticle({ slug: null }))),
      JSON.stringify(evaluateContentBlockPublicReadiness(readyBlock({ contentChars: 0 }))),
    ].join(" ");
    for (const secret of ["password", "senha", "authorization", "DATABASE_URL", "process.env"]) {
      expect(samples.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });
});
