/**
 * relevance-gate.test.ts — o portao de RELEVANCIA (decisao do dono, 24/09/2026).
 *
 * Fica no indice: pais EUA, pais Brasil, >= 500 votos no TMDB, ou oferta no
 * Brasil. Qualquer outro sai, inclusive o SEM PAIS.
 */

import { describe, expect, it } from "vitest";

import { RELEVANCE_GATE_MIN_TMDB_VOTES } from "@screena/config";

import {
  evaluateLocalizationGate,
  evaluateRelevanceGate,
  firstFailedQualityGate,
  RELEVANCE_GATE_OFF_VERDICT,
  type RelevanceGateInput,
} from "./entity-quality-gates.js";

const CAUDA: RelevanceGateInput = {
  entityType: "movie",
  countries: ["TH"],
  voteCount: 0,
  hasBrazilOffer: false,
};

describe("evaluateRelevanceGate — cada ramo", () => {
  it("pais EUA fica (em qualquer posicao)", () => {
    const v = evaluateRelevanceGate({ ...CAUDA, countries: ["GB", "US"] });
    expect(v).toMatchObject({ passed: true, gate: "relevance", code: "anchor_country" });
    expect(v.reason).toContain("US");
  });

  it("pais Brasil fica", () => {
    expect(evaluateRelevanceGate({ ...CAUDA, countries: ["BR"] })).toMatchObject({
      passed: true,
      code: "anchor_country",
    });
  });

  it("votos >= 500 ficam, mesmo de fora de EUA/BR", () => {
    expect(evaluateRelevanceGate({ ...CAUDA, countries: ["GB"], voteCount: 600 })).toMatchObject({
      passed: true,
      code: "tmdb_votes",
    });
  });

  it("oferta no Brasil fica", () => {
    expect(evaluateRelevanceGate({ ...CAUDA, countries: ["KR"], hasBrazilOffer: true })).toMatchObject({
      passed: true,
      code: "brazil_offer",
    });
  });

  it("pais fora de EUA/BR, sem votos e sem oferta SAI — motivo nomeia o pais", () => {
    const v = evaluateRelevanceGate(CAUDA);
    expect(v).toMatchObject({ passed: false, gate: "relevance", code: "country_outside_anchor" });
    expect(v.reason).toContain("TH");
    expect(v.reason).toContain("fora do indice");
  });
});

describe("fronteira do limiar", () => {
  it("499 sai, 500 fica", () => {
    expect(RELEVANCE_GATE_MIN_TMDB_VOTES).toBe(500);
    expect(evaluateRelevanceGate({ ...CAUDA, voteCount: 499 }).passed).toBe(false);
    expect(evaluateRelevanceGate({ ...CAUDA, voteCount: 500 }).passed).toBe(true);
  });

  it("votos nulos contam como zero (o COALESCE do SQL)", () => {
    expect(evaluateRelevanceGate({ ...CAUDA, voteCount: null }).passed).toBe(false);
  });
});

describe("SEM PAIS — distinguido de pais fora de EUA/BR", () => {
  const SEM_PAIS: RelevanceGateInput = { entityType: "tv", countries: [], voteCount: 0, hasBrazilOffer: false };

  it("sem pais com 0 votos SAI, com motivo proprio", () => {
    const v = evaluateRelevanceGate(SEM_PAIS);
    expect(v).toMatchObject({ passed: false, code: "no_country" });
    expect(v.reason).toContain("SEM pais");
    expect(v.reason).toContain("Serie");
  });

  it("sem pais com oferta no Brasil FICA", () => {
    expect(evaluateRelevanceGate({ ...SEM_PAIS, hasBrazilOffer: true }).passed).toBe(true);
  });

  it("sem pais com 600 votos FICA", () => {
    expect(evaluateRelevanceGate({ ...SEM_PAIS, voteCount: 600 }).passed).toBe(true);
  });
});

describe("volta automatica ao indice", () => {
  it("titulo que ganha pais EUA volta", () => {
    const antes = evaluateRelevanceGate({ ...CAUDA, countries: [] });
    const depois = evaluateRelevanceGate({ ...CAUDA, countries: ["US"] });
    expect(antes.passed).toBe(false);
    expect(depois.passed).toBe(true);
  });

  it("titulo que chega a 500 votos volta; que ganha oferta BR volta", () => {
    expect(evaluateRelevanceGate({ ...CAUDA, voteCount: 500 }).passed).toBe(true);
    expect(evaluateRelevanceGate({ ...CAUDA, hasBrazilOffer: true }).passed).toBe(true);
  });
});

describe("chave de emergencia e composicao com a D3", () => {
  it("veredito desligado passa sempre", () => {
    expect(RELEVANCE_GATE_OFF_VERDICT).toMatchObject({ passed: true, gate: "relevance", code: "gate_off" });
  });

  const d3Reprovada = evaluateLocalizationGate({
    canonicalSlug: "tmdb-1",
    localizedTitle: null,
    originalTitle: "Τίποτα",
    hasLocalizedDescription: false,
  });
  const d3Aprovada = evaluateLocalizationGate({
    canonicalSlug: "nada",
    localizedTitle: "Nada",
    originalTitle: "Nada",
    hasLocalizedDescription: false,
  });

  it("o primeiro portao que reprova decide", () => {
    expect(firstFailedQualityGate([d3Reprovada, evaluateRelevanceGate(CAUDA)]).gate).toBe("localization");
    expect(firstFailedQualityGate([d3Aprovada, evaluateRelevanceGate(CAUDA)]).gate).toBe("relevance");
  });

  it("desligado, a composicao e exatamente a D3 de hoje", () => {
    expect(firstFailedQualityGate([d3Reprovada, RELEVANCE_GATE_OFF_VERDICT])).toBe(d3Reprovada);
    expect(firstFailedQualityGate([d3Aprovada, RELEVANCE_GATE_OFF_VERDICT]).passed).toBe(true);
  });
});
