/**
 * Testes de governanca — reviews de usuario (services/user-platform).
 *
 * Provam sanitizacao de texto plano (sem interpretar HTML), limites de
 * submissao, rate limit de UGC, gate de exibicao publica (approved +
 * public + nao deletada) e soft delete.
 */

import { describe, expect, it } from "vitest";
import {
  buildReviewSoftDelete,
  canRenderPublicly,
  countLinks,
  evaluateUgcRateLimit,
  REVIEW_LIMITS,
  sanitizeReviewText,
  validateReviewSubmission,
} from "../review.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");

function baseSubmission(
  overrides: Partial<Parameters<typeof validateReviewSubmission>[0]> = {},
): Parameters<typeof validateReviewSubmission>[0] {
  return {
    title: "Uma review honesta",
    body: "Texto de review com opiniao propria e sem spoiler.",
    containsSpoiler: false,
    ...overrides,
  };
}

function basePublicReview(
  overrides: Partial<Parameters<typeof canRenderPublicly>[0]> = {},
): Parameters<typeof canRenderPublicly>[0] {
  return {
    status: "approved",
    visibility: "public",
    deletedAt: null,
    ...overrides,
  };
}

describe("sanitizeReviewText", () => {
  it("(1) remove chars de controle mas preserva \\n e \\t", () => {
    const raw = "linha1\u0000\n\tlinha2";

    expect(sanitizeReviewText(raw)).toBe("linha1\n\tlinha2");
  });

  it("(2) normaliza \\r\\n e \\r solto para \\n", () => {
    expect(sanitizeReviewText("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("(3) colapsa mais de 2 quebras seguidas em exatamente 2", () => {
    expect(sanitizeReviewText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("(4) faz trim nas pontas", () => {
    expect(sanitizeReviewText("  texto  \n\n")).toBe("texto");
  });

  it("(5) NAO interpreta HTML: tags permanecem como texto literal", () => {
    const raw = "<script>alert(1)</script> otimo filme";

    expect(sanitizeReviewText(raw)).toBe("<script>alert(1)</script> otimo filme");
  });
});

describe("countLinks", () => {
  it("(6) conta ocorrencias de http:// e https:// (case-insensitive)", () => {
    expect(countLinks("veja https://a.example e HTTP://b.example")).toBe(2);
    expect(countLinks("sem link nenhum")).toBe(0);
  });
});

describe("validateReviewSubmission", () => {
  it("(7) caminho feliz: titulo + corpo dentro dos limites", () => {
    const result = validateReviewSubmission(baseSubmission());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("(8) rejeita corpo vazio apos sanitizacao", () => {
    const result = validateReviewSubmission(baseSubmission({ body: "  \u0000  " }));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("vazia"))).toBe(true);
  });

  it("(9) rejeita corpo acima de maxBodyLength", () => {
    const result = validateReviewSubmission(
      baseSubmission({ body: "x".repeat(REVIEW_LIMITS.maxBodyLength + 1) }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes(String(REVIEW_LIMITS.maxBodyLength)))).toBe(true);
  });

  it("(10) rejeita titulo acima de maxTitleLength", () => {
    const result = validateReviewSubmission(
      baseSubmission({ title: "t".repeat(REVIEW_LIMITS.maxTitleLength + 1) }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("titulo"))).toBe(true);
  });

  it("(11) rejeita 3 links (maxLinks = 2)", () => {
    const result = validateReviewSubmission(
      baseSubmission({
        body: "veja https://a.example e https://b.example e http://c.example",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("links"))).toBe(true);
  });

  it("(12) aceita exatamente 2 links", () => {
    const result = validateReviewSubmission(
      baseSubmission({ body: "veja https://a.example e http://b.example" }),
    );

    expect(result.ok).toBe(true);
  });

  it("(13) titulo ausente e permitido", () => {
    const result = validateReviewSubmission(baseSubmission({ title: undefined }));

    expect(result.ok).toBe(true);
  });
});

describe("evaluateUgcRateLimit", () => {
  it("(14) bloqueia com rate_limited quando recentCount >= limit", () => {
    const result = evaluateUgcRateLimit({ recentCount: 5, limit: 5 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited");
    }
  });

  it("(15) permite quando recentCount < limit", () => {
    const result = evaluateUgcRateLimit({
      recentCount: 4,
      limit: REVIEW_LIMITS.maxReviewsPerHour,
    });

    expect(result.ok).toBe(true);
  });

  it("(16) rejeita parametros invalidos (negativo / nao inteiro / limit < 1)", () => {
    expect(evaluateUgcRateLimit({ recentCount: -1, limit: 5 }).ok).toBe(false);
    expect(evaluateUgcRateLimit({ recentCount: 1.5, limit: 5 }).ok).toBe(false);
    expect(evaluateUgcRateLimit({ recentCount: 0, limit: 0 }).ok).toBe(false);
  });
});

describe("canRenderPublicly", () => {
  it("(17) permite somente approved + public + nao deletada", () => {
    expect(canRenderPublicly(basePublicReview())).toBe(true);
  });

  it("(18) nega review pending mesmo publica", () => {
    expect(canRenderPublicly(basePublicReview({ status: "pending" }))).toBe(false);
  });

  it("(19) nega visibilidade private e unlisted mesmo approved", () => {
    expect(canRenderPublicly(basePublicReview({ visibility: "private" }))).toBe(false);
    expect(canRenderPublicly(basePublicReview({ visibility: "unlisted" }))).toBe(false);
  });

  it("(20) nega review deletada (soft delete) mesmo approved + public", () => {
    expect(canRenderPublicly(basePublicReview({ deletedAt: NOW }))).toBe(false);
  });

  it("(21) nega rejected e removed", () => {
    expect(canRenderPublicly(basePublicReview({ status: "rejected" }))).toBe(false);
    expect(canRenderPublicly(basePublicReview({ status: "removed" }))).toBe(false);
  });
});

describe("buildReviewSoftDelete", () => {
  it("(22) marca deletedAt=now e status removed", () => {
    expect(buildReviewSoftDelete(NOW)).toEqual({ deletedAt: NOW, status: "removed" });
  });
});
