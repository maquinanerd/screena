/**
 * Teste de governanca (Fase 1, item 6) — rating_sources espelha RATING_SCALES.
 *
 * Invariante 1: cada fonte tem sua propria escala e nunca se converte entre
 * escalas. A seed de rating_sources DEVE espelhar exatamente RATING_SCALES de
 * @screena/config (imdb=10, rotten_tomatoes=100, metacritic=100, letterboxd=5,
 * filmaffinity=10). Drift entre a seed e a constante canonica e bug.
 */

import { describe, expect, it } from "vitest";
import { RATING_SCALES, RATING_SOURCES } from "@screena/config";
import { RATING_SOURCE_SEED } from "@screena/db";

describe("seed: rating_sources.scale espelha RATING_SCALES (invariante 1)", () => {
  it("cobre exatamente o conjunto canonico de fontes", () => {
    expect(RATING_SOURCE_SEED).toHaveLength(RATING_SOURCES.length);
    expect(RATING_SOURCE_SEED.map((s) => s.key).sort()).toEqual([...RATING_SOURCES].sort());
  });

  it("cada escala semeada bate com RATING_SCALES[key]", () => {
    for (const seed of RATING_SOURCE_SEED) {
      const key = seed.key as (typeof RATING_SOURCES)[number];
      expect(seed.scale).toBe(RATING_SCALES[key]);
    }
  });

  it("escalas canonicas conhecidas estao corretas", () => {
    const byKey = Object.fromEntries(RATING_SOURCE_SEED.map((s) => [s.key, s.scale]));
    expect(byKey["imdb"]).toBe(10);
    expect(byKey["rotten_tomatoes"]).toBe(100);
    expect(byKey["metacritic"]).toBe(100);
    expect(byKey["letterboxd"]).toBe(5);
    expect(byKey["filmaffinity"]).toBe(10);
  });
});
