/**
 * Testes de SINAIS: afinidades derivadas do perfil (max), ausencia vira null
 * (nunca zero), repasse de popularity/similarity/recency ja validados, e clamp
 * de pesos fora de faixa. Escalas nunca se misturam (tudo 0..1).
 */

import { describe, expect, it } from "vitest";
import { computeSignals } from "../signals.js";
import type { PreferenceProfile, RecommendationCandidate } from "../types.js";

const profile: PreferenceProfile = {
  genreWeights: { drama: 0.8, comedy: 0.3 },
  entityTypeWeights: { movie: 0.6 },
  localeWeights: { "pt-BR": 0.9 },
};

function candidate(overrides: Partial<RecommendationCandidate> = {}): RecommendationCandidate {
  return {
    ref: { entityType: "movie", entityId: 1n },
    genres: ["drama", "comedy"],
    locales: ["pt-BR"],
    popularity: 0.4,
    similarity: 0.7,
    recency: 0.2,
    displayEligible: true,
    licenseEligible: true,
    territoryEligible: true,
    blocked: false,
    notInterested: false,
    hidden: false,
    watchState: null,
    hasProgress: false,
    ...overrides,
  };
}

describe("computeSignals", () => {
  it("(1) genreAffinity e a MAIOR afinidade entre os generos do candidato", () => {
    expect(computeSignals(candidate(), profile).genreAffinity).toBe(0.8);
  });

  it("(2) genero sem peso conhecido => genreAffinity null (ausencia, nao zero)", () => {
    expect(computeSignals(candidate({ genres: ["horror"] }), profile).genreAffinity).toBeNull();
  });

  it("(3) entityTypeAffinity vem do perfil; tipo sem peso => null", () => {
    expect(computeSignals(candidate(), profile).entityTypeAffinity).toBe(0.6);
    expect(
      computeSignals(candidate({ ref: { entityType: "tv", entityId: 2n } }), profile).entityTypeAffinity,
    ).toBeNull();
  });

  it("(4) similarity/popularity/recency sao repassados (ja validados)", () => {
    const s = computeSignals(candidate(), profile);
    expect(s.similarity).toBe(0.7);
    expect(s.popularity).toBe(0.4);
    expect(s.recency).toBe(0.2);
  });

  it("(5) sinal null permanece null (nunca vira zero)", () => {
    const s = computeSignals(candidate({ popularity: null, similarity: null, recency: null }), profile);
    expect(s.popularity).toBeNull();
    expect(s.similarity).toBeNull();
    expect(s.recency).toBeNull();
  });

  it("(6) peso de perfil fora de 0..1 e clampado (nunca domina por escala)", () => {
    const wild: PreferenceProfile = {
      genreWeights: { drama: 5 },
      entityTypeWeights: { movie: 2 },
      localeWeights: { "pt-BR": -1 },
    };
    const s = computeSignals(candidate(), wild);
    expect(s.genreAffinity).toBe(1);
    expect(s.entityTypeAffinity).toBe(1);
    expect(s.localeAffinity).toBe(0);
  });

  it("(7) localeAffinity vem do perfil; sem locale conhecido => null", () => {
    expect(computeSignals(candidate(), profile).localeAffinity).toBe(0.9);
    expect(computeSignals(candidate({ locales: ["en"] }), profile).localeAffinity).toBeNull();
  });
});
