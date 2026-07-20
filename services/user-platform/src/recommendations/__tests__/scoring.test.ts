/**
 * Testes de SCORING e CONFIANCA: score determinista em 0..1 (media ponderada
 * dos sinais presentes; ausentes fora do denominador; peso 0 remove; dropped
 * penaliza), contribuicoes que somam o score, e confianca SEPARADA (cold start
 * baixa, mais sinais eleva, sinais contraditorios reduzem).
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_RECOMMENDATION_POLICY } from "../policy.js";
import { computeConfidence, computeScore } from "../scoring.js";
import type {
  HistorySummary,
  RecommendationCandidate,
  RecommendationPolicy,
  SignalContributions,
} from "../types.js";

const POLICY = DEFAULT_RECOMMENDATION_POLICY;

function signals(overrides: Partial<SignalContributions> = {}): SignalContributions {
  return {
    genreAffinity: 0.5,
    entityTypeAffinity: 0.5,
    similarity: 0.5,
    popularity: 0.5,
    recency: 0.5,
    localeAffinity: 0.5,
    ...overrides,
  };
}

function candidate(watchState: RecommendationCandidate["watchState"] = null): RecommendationCandidate {
  return {
    ref: { entityType: "movie", entityId: 1n },
    genres: [],
    locales: [],
    popularity: null,
    similarity: null,
    recency: null,
    displayEligible: true,
    licenseEligible: true,
    territoryEligible: true,
    blocked: false,
    notInterested: false,
    hidden: false,
    watchState,
    hasProgress: false,
  };
}

const history = (watchedCount: number): HistorySummary => ({
  watchedCount,
  ratedCount: 0,
  distinctGenreCount: 0,
});

describe("computeScore", () => {
  it("(1) todos os sinais em 0.5 => score 0.5 (media ponderada)", () => {
    const r = computeScore({ signals: signals(), candidate: candidate(), policy: POLICY });
    expect(r.score).toBe(0.5);
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it("(2) mesma entrada => mesmo score (determinista)", () => {
    const a = computeScore({ signals: signals(), candidate: candidate(), policy: POLICY });
    const b = computeScore({ signals: signals(), candidate: candidate(), policy: POLICY });
    expect(a.score).toBe(b.score);
  });

  it("(3) score sempre em 0..1, nunca NaN/Infinity", () => {
    const r = computeScore({ signals: signals({ similarity: 1, popularity: 1 }), candidate: candidate(), policy: POLICY });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(Number.isNaN(r.score)).toBe(false);
  });

  it("(4) peso zero remove a contribuicao do sinal", () => {
    const zeroSim: RecommendationPolicy = {
      ...POLICY,
      weights: { ...POLICY.weights, similarity: 0 },
    };
    const r = computeScore({ signals: signals(), candidate: candidate(), policy: zeroSim });
    expect(r.contributions.similarity).toBeUndefined();
  });

  it("(5) sinais ausentes (null) ficam fora do denominador (nao viram zero)", () => {
    // So similarity presente em 0.9 => score = 0.9 (denominador so pesa similarity).
    const only = signals({
      genreAffinity: null,
      entityTypeAffinity: null,
      popularity: null,
      recency: null,
      localeAffinity: null,
      similarity: 0.9,
    });
    const r = computeScore({ signals: only, candidate: candidate(), policy: POLICY });
    expect(r.score).toBeCloseTo(0.9, 10);
    expect(r.usedSignalCount).toBe(1);
  });

  it("(6) contribuicoes normalizadas somam o score (pre-penalidade)", () => {
    const r = computeScore({ signals: signals(), candidate: candidate(), policy: POLICY });
    const sum = Object.values(r.contributions).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(r.score, 10);
  });

  it("(7) candidato dropped sofre penalidade no score", () => {
    const base = computeScore({ signals: signals(), candidate: candidate(null), policy: POLICY }).score;
    const dropped = computeScore({ signals: signals(), candidate: candidate("dropped"), policy: POLICY }).score;
    expect(dropped).toBeLessThan(base);
    expect(dropped).toBe(Math.max(0, base - POLICY.dropPenalty));
  });

  it("(8) sem nenhum sinal presente => score 0", () => {
    const none = signals({
      genreAffinity: null,
      entityTypeAffinity: null,
      similarity: null,
      popularity: null,
      recency: null,
      localeAffinity: null,
    });
    expect(computeScore({ signals: none, candidate: candidate(), policy: POLICY }).score).toBe(0);
  });
});

describe("computeConfidence", () => {
  it("(9) cold start tem confianca baixa (teto maxColdStartConfidence)", () => {
    const c = computeConfidence({
      signals: signals(),
      usedSignalCount: 6,
      history: history(0),
      coldStart: true,
      policy: POLICY,
    });
    expect(c).toBeLessThanOrEqual(POLICY.maxColdStartConfidence);
  });

  it("(10) mais sinais + historico suficiente elevam a confianca", () => {
    const few = computeConfidence({
      signals: signals({ genreAffinity: null, entityTypeAffinity: null, popularity: null, recency: null, localeAffinity: null }),
      usedSignalCount: 1,
      history: history(1),
      coldStart: false,
      policy: POLICY,
    });
    const many = computeConfidence({
      signals: signals(),
      usedSignalCount: 6,
      history: history(20),
      coldStart: false,
      policy: POLICY,
    });
    expect(many).toBeGreaterThan(few);
  });

  it("(11) sinais contraditorios (spread alto) nao produzem confianca maxima", () => {
    const contradictory = computeConfidence({
      signals: signals({ genreAffinity: 0, similarity: 1, popularity: 0, recency: 1, entityTypeAffinity: 0, localeAffinity: 1 }),
      usedSignalCount: 6,
      history: history(20),
      coldStart: false,
      policy: POLICY,
    });
    expect(contradictory).toBeLessThan(1);
  });

  it("(12) confianca sempre em 0..1 e sem historico e baixa", () => {
    const c = computeConfidence({
      signals: signals(),
      usedSignalCount: 6,
      history: history(0),
      coldStart: true,
      policy: POLICY,
    });
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
    expect(c).toBeLessThanOrEqual(POLICY.maxColdStartConfidence);
  });
});
