/**
 * Testes de EXPLICABILIDADE: razoes so aparecem quando o sinal contribuiu
 * (>= reasonThreshold); razao falsa nunca aparece; popularity vira
 * cold_start_popular em cold start; razoes de contexto so no contexto certo;
 * codigos sao union fechada e a contribuicao corresponde ao valor usado.
 */

import { describe, expect, it } from "vitest";
import { deriveReasons } from "../reasons.js";
import { RECOMMENDATION_REASON_CODES, type SignalKey } from "../types.js";

const THRESHOLD = 0.15;

function derive(
  contributions: Partial<Record<SignalKey, number>>,
  context: Parameters<typeof deriveReasons>[0]["context"] = "discovery",
  coldStart = false,
) {
  return deriveReasons({ contributions, context, coldStart, reasonThreshold: THRESHOLD });
}

describe("deriveReasons", () => {
  it("(1) razao aparece so quando o sinal contribuiu acima do limiar", () => {
    const reasons = derive({ genreAffinity: 0.3, similarity: 0.05 });
    const codes = reasons.map((r) => r.code);
    expect(codes).toContain("genre_affinity");
    expect(codes).not.toContain("similar_to_watched"); // 0.05 < 0.15
  });

  it("(2) sem afinidade de genero => nunca gera genre_affinity (razao honesta)", () => {
    const reasons = derive({ similarity: 0.5 });
    expect(reasons.map((r) => r.code)).not.toContain("genre_affinity");
  });

  it("(3) contribuicoes vazias => nenhuma razao de sinal (score zero sem razao positiva)", () => {
    expect(derive({})).toEqual([]);
  });

  it("(4) popularity vira popular_in_catalog; em cold start vira cold_start_popular", () => {
    expect(derive({ popularity: 0.5 }, "discovery", false).map((r) => r.code)).toContain(
      "popular_in_catalog",
    );
    expect(derive({ popularity: 0.5 }, "discovery", true).map((r) => r.code)).toContain(
      "cold_start_popular",
    );
  });

  it("(5) continue_series so em continue_watching; rewatch_pattern so em rewatch", () => {
    expect(derive({}, "continue_watching").map((r) => r.code)).toEqual(["continue_series"]);
    expect(derive({}, "rewatch").map((r) => r.code)).toEqual(["rewatch_pattern"]);
    expect(derive({ similarity: 0.5 }, "discovery").map((r) => r.code)).not.toContain("continue_series");
  });

  it("(6) todos os codigos pertencem a union fechada RECOMMENDATION_REASON_CODES", () => {
    const reasons = derive({ genreAffinity: 0.3, similarity: 0.4, popularity: 0.2, recency: 0.2, entityTypeAffinity: 0.2, localeAffinity: 0.2 });
    for (const r of reasons) {
      expect(RECOMMENDATION_REASON_CODES).toContain(r.code);
    }
  });

  it("(7) a contribuicao reportada corresponde ao valor do sinal usado", () => {
    const reasons = derive({ similarity: 0.42 });
    const similar = reasons.find((r) => r.code === "similar_to_watched");
    expect(similar?.contribution).toBe(0.42);
  });

  it("(8) razao nao contem userId, historico bruto nem review (so code + contribution)", () => {
    const reasons = derive({ genreAffinity: 0.9 }, "continue_watching");
    for (const r of reasons) {
      expect(Object.keys(r).sort()).toEqual(["code", "contribution"]);
    }
  });
});
