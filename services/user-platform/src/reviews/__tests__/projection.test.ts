/**
 * Testes da projecao PUBLICA de review: gate de renderizacao (approved + public
 * + nao deletada), protecao de corpo por spoiler (default esconde), datas ISO
 * UTC e NAO vazamento de IDs internos, deletedAt, status ou nota de moderacao.
 */

import { describe, expect, it } from "vitest";
import { toPublicReview, type ReviewForProjection } from "../projection.js";

const CREATED = new Date("2026-07-01T00:00:00.000Z");
const UPDATED = new Date("2026-07-05T00:00:00.000Z");

function review(overrides: Partial<ReviewForProjection> = {}): ReviewForProjection {
  return {
    entityType: "movie",
    title: "Titulo publico",
    body: "Corpo completo da review sem spoiler.",
    containsSpoiler: false,
    status: "approved",
    visibility: "public",
    deletedAt: null,
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...overrides,
  };
}

const stable = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

describe("toPublicReview — gate de visibilidade", () => {
  it("(1) review approved + public + nao deletada rende", () => {
    const dto = toPublicReview(review());
    expect(dto).not.toBeNull();
    expect(dto?.body).toContain("Corpo completo");
    expect(dto?.entityType).toBe("movie");
  });

  it("(2) review privada e unlisted NAO rendem (null)", () => {
    expect(toPublicReview(review({ visibility: "private" }))).toBeNull();
    expect(toPublicReview(review({ visibility: "unlisted" }))).toBeNull();
  });

  it("(3) pending / rejected / removed NAO rendem (null)", () => {
    expect(toPublicReview(review({ status: "pending" }))).toBeNull();
    expect(toPublicReview(review({ status: "rejected" }))).toBeNull();
    expect(toPublicReview(review({ status: "removed" }))).toBeNull();
  });

  it("(4) review retirada (deletedAt != null) NAO rende (null)", () => {
    expect(toPublicReview(review({ deletedAt: UPDATED }))).toBeNull();
  });
});

describe("toPublicReview — spoiler", () => {
  it("(5) review sem spoiler expoe o corpo", () => {
    const dto = toPublicReview(review({ containsSpoiler: false }));
    expect(dto?.bodyHidden).toBe(false);
    expect(dto?.body).toContain("Corpo completo");
  });

  it("(6) review com spoiler esconde o corpo por default (body null, bodyHidden true)", () => {
    const dto = toPublicReview(review({ containsSpoiler: true, body: "REVELACAO: o vilao morre." }));
    expect(dto?.bodyHidden).toBe(true);
    expect(dto?.body).toBeNull();
    expect(dto?.containsSpoiler).toBe(true);
    // Nenhum trecho/snippet do corpo protegido vaza no JSON publico.
    expect(stable(dto).includes("vilao morre")).toBe(false);
  });

  it("(7) includeSpoilerBody=true (consentimento explicito) libera o corpo", () => {
    const dto = toPublicReview(review({ containsSpoiler: true, body: "REVELACAO." }), {
      includeSpoilerBody: true,
    });
    expect(dto?.bodyHidden).toBe(false);
    expect(dto?.body).toBe("REVELACAO.");
  });

  it("(8) qualquer valor falsy/omisso de includeSpoilerBody mantem escondido", () => {
    for (const opt of [undefined, {}, { includeSpoilerBody: false }, { includeSpoilerBody: 1 as never }]) {
      const dto = toPublicReview(review({ containsSpoiler: true }), opt);
      expect(dto?.bodyHidden, JSON.stringify(opt)).toBe(true);
    }
  });
});

describe("toPublicReview — nao vazamento", () => {
  it("(9) datas em ISO 8601 UTC (string, nunca Date/BigInt)", () => {
    const dto = toPublicReview(review());
    expect(dto?.createdAt).toBe("2026-07-01T00:00:00.000Z");
    expect(dto?.updatedAt).toBe("2026-07-05T00:00:00.000Z");
    expect(typeof dto?.createdAt).toBe("string");
  });

  it("(10) DTO publico NAO contem IDs internos, deletedAt, status nem nota de moderacao", () => {
    const dto = toPublicReview(review(), { authorPublicHandle: "@fulano" });
    const s = stable(dto);
    for (const forbidden of [
      "userId",
      "entityId",
      "reviewId",
      "reporterId",
      "moderatorId",
      "deletedAt",
      "publishedAt",
      "moderationNote",
      "internalReason",
    ]) {
      expect(s.includes(forbidden), `DTO nao pode conter ${forbidden}`).toBe(false);
    }
  });

  it("(11) expoe apenas handle publico do autor (nunca userId derivado)", () => {
    const dto = toPublicReview(review(), { authorPublicHandle: "@fulano" });
    expect(dto?.authorHandle).toBe("@fulano");
    const dtoSem = toPublicReview(review());
    expect(dtoSem?.authorHandle).toBeNull();
  });
});
