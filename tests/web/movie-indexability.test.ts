/**
 * Testes puros da indexabilidade da pagina de filme.
 *
 * Cobrem a invariante 5 (politica 2026-07 — indexacao total) a partir da camada
 * de @screena/web:
 *  - blocos so contam para o sinal de qualidade quando o `review_status` e
 *    publicavel (human_reviewed/published); ai_generated/needs_review/etc. nao;
 *  - um filme sincronizado indexa SEMPRE (a ficha canonica basta); a contagem
 *    de blocos so alimenta `hasUniqueValue`, nao gate mais a indexacao.
 */

import { describe, expect, it } from "vitest";

import {
  evaluateMovieIndexability,
  isPubliclyRenderableBlock,
  MIN_RENDERABLE_BLOCKS,
} from "../../apps/web/src/lib/movie-indexability";

describe("isPubliclyRenderableBlock", () => {
  it("conta apenas human_reviewed e published", () => {
    expect(isPubliclyRenderableBlock("published")).toBe(true);
    expect(isPubliclyRenderableBlock("human_reviewed")).toBe(true);
  });

  it("nunca conta blocos nao revisados/publicaveis", () => {
    const nonPublishable = [
      "draft",
      "ai_generated",
      "needs_review",
      "needs_update",
      "blocked",
      "archived",
    ];
    for (const status of nonPublishable) {
      expect(isPubliclyRenderableBlock(status)).toBe(false);
    }
  });
});

describe("evaluateMovieIndexability (indexacao total)", () => {
  it("0 blocos renderizaveis -> index (so a ficha crua ja basta)", () => {
    const result = evaluateMovieIndexability({ renderableBlockCount: 0 });
    expect(result.decision).toBe("index");
    expect(result.hasUniqueValue).toBe(false);
  });

  it("1 bloco renderizavel -> index (blocos nao gateiam mais)", () => {
    const result = evaluateMovieIndexability({ renderableBlockCount: 1 });
    expect(result.decision).toBe("index");
    expect(result.hasUniqueValue).toBe(false);
  });

  it(`${MIN_RENDERABLE_BLOCKS} blocos renderizaveis -> index e pagina "rica"`, () => {
    const result = evaluateMovieIndexability({
      renderableBlockCount: MIN_RENDERABLE_BLOCKS,
    });
    expect(result.decision).toBe("index");
    expect(result.hasUniqueValue).toBe(true);
  });

  it("mais blocos continuam index", () => {
    expect(evaluateMovieIndexability({ renderableBlockCount: 5 }).decision).toBe(
      "index",
    );
  });

  it("contagem negativa e tratada como zero -> index", () => {
    expect(evaluateMovieIndexability({ renderableBlockCount: -3 }).decision).toBe(
      "index",
    );
  });
});
