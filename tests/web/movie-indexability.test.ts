/**
 * Testes puros do gate anti-thin da pagina de filme (Fase 4A).
 *
 * Cobrem a invariante 5 a partir da camada de @screena/web:
 *  - blocos so contam quando o `review_status` e publicavel (human_reviewed/
 *    published); ai_generated/needs_review/etc. nunca contam;
 *  - `< 2` blocos renderizaveis -> noindex; `>= 2` -> index.
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

describe("evaluateMovieIndexability (gate anti-thin)", () => {
  it("0 blocos renderizaveis -> noindex", () => {
    const result = evaluateMovieIndexability({ renderableBlockCount: 0 });
    expect(result.decision).toBe("noindex");
    expect(result.hasUniqueValue).toBe(false);
  });

  it("1 bloco renderizavel -> noindex", () => {
    const result = evaluateMovieIndexability({ renderableBlockCount: 1 });
    expect(result.decision).toBe("noindex");
    expect(result.hasUniqueValue).toBe(false);
  });

  it(`${MIN_RENDERABLE_BLOCKS} blocos renderizaveis -> index`, () => {
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

  it("contagem negativa e tratada como zero -> noindex", () => {
    expect(evaluateMovieIndexability({ renderableBlockCount: -3 }).decision).toBe(
      "noindex",
    );
  });
});
