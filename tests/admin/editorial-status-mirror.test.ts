/**
 * Trava de espelhamento: as regras de licenca/revisao/corpo do admin read-only
 * DEVEM coincidir com os helpers confiaveis do app publico
 * (`apps/web/src/lib/news-presenter.ts`). O admin nao importa `apps/web` em
 * runtime (fronteira limpa entre apps); este teste garante que as duas
 * definicoes nao divergem — se o app publico mudar a regra, este teste quebra e
 * forca o alinhamento do admin, cumprindo "reutilizar helper confiavel, nao
 * duplicar regra critica".
 */

import { describe, expect, it } from "vitest";

import {
  DISPLAYABLE_LICENSE_STATUSES,
  MIN_ARTICLE_BODY_CHARS as ADMIN_MIN_BODY,
  PUBLISHABLE_REVIEW_STATUSES,
  isDisplayableLicense as adminIsDisplayableLicense,
  isPublishableReview as adminIsPublishableReview,
  isSufficientBody as adminIsSufficientBody,
} from "../../apps/admin/src/lib/editorial-status";
import {
  MIN_ARTICLE_BODY_CHARS as WEB_MIN_BODY,
  NEWS_RENDERABLE_REVIEW_STATUSES,
  isDisplayableLicense as webIsDisplayableLicense,
  isPubliclyRenderableNewsReview,
  isSufficientBody as webIsSufficientBody,
} from "../../apps/web/src/lib/news-presenter";

/** Universo de LicenseStatus do schema (packages/db enum LicenseStatus). */
const ALL_LICENSE_STATUSES = ["official", "licensed", "third_party", "unknown", "blocked"];

/** Universo de ReviewStatus do schema (packages/db enum ReviewStatus). */
const ALL_REVIEW_STATUSES = [
  "draft",
  "ai_generated",
  "needs_review",
  "human_reviewed",
  "published",
  "needs_update",
  "blocked",
  "archived",
];

describe("admin espelha news-presenter (sem duplicar regra critica)", () => {
  it("limiar de corpo minimo identico", () => {
    expect(ADMIN_MIN_BODY).toBe(WEB_MIN_BODY);
  });

  it("isDisplayableLicense concorda para todo LicenseStatus", () => {
    for (const status of ALL_LICENSE_STATUSES) {
      expect(adminIsDisplayableLicense(status)).toBe(webIsDisplayableLicense(status));
    }
  });

  it("review publicavel concorda com o render publico para todo ReviewStatus", () => {
    for (const status of ALL_REVIEW_STATUSES) {
      expect(adminIsPublishableReview(status)).toBe(isPubliclyRenderableNewsReview(status));
    }
  });

  it("conjunto de review publicavel identico ao do render publico", () => {
    expect([...PUBLISHABLE_REVIEW_STATUSES].sort()).toEqual(
      [...NEWS_RENDERABLE_REVIEW_STATUSES].sort(),
    );
  });

  it("conjunto de licenca exibivel cobre exatamente official/licensed/third_party", () => {
    expect([...DISPLAYABLE_LICENSE_STATUSES].sort()).toEqual(
      ["licensed", "official", "third_party"].sort(),
    );
  });

  it("isSufficientBody concorda com o render publico", () => {
    const samples = ["", "   ", "x".repeat(WEB_MIN_BODY - 1), "x".repeat(WEB_MIN_BODY), null];
    for (const sample of samples) {
      expect(adminIsSufficientBody(sample)).toBe(webIsSufficientBody(sample));
    }
  });
});
