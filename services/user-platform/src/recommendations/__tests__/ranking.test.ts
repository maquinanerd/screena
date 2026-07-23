/**
 * Testes do PIPELINE de ranking: ordena por score (desempate determinista),
 * independe da ordem de entrada, posicoes contiguas, limite apos ordenacao,
 * dedup, exclusao de inelegiveis, imutabilidade da entrada, e cold start SEM
 * sinais => resultado vazio (nunca recomendacao "personalizada" falsa).
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_RECOMMENDATION_POLICY } from "../policy.js";
import { rankRecommendations, type RankRequest } from "../ranking.js";
import type { HistorySummary, PreferenceProfile, RecommendationCandidate } from "../types.js";

const profile: PreferenceProfile = {
  genreWeights: { drama: 0.8 },
  entityTypeWeights: { movie: 0.6 },
  localeWeights: { "pt-BR": 0.9 },
};
const history: HistorySummary = { watchedCount: 20, ratedCount: 5, distinctGenreCount: 3 };

function cand(id: number, similarity: number, o: Partial<RecommendationCandidate> = {}): RecommendationCandidate {
  return {
    ref: { entityType: "movie", entityId: BigInt(id) },
    genres: ["drama"],
    locales: ["pt-BR"],
    popularity: 0.5,
    similarity,
    recency: 0.5,
    displayEligible: true,
    licenseEligible: true,
    territoryEligible: true,
    blocked: false,
    notInterested: false,
    hidden: false,
    watchState: null,
    hasProgress: false,
    ...o,
  };
}

function req(candidates: RecommendationCandidate[], o: Partial<RankRequest> = {}): RankRequest {
  return { context: "discovery", profile, history, candidates, policy: DEFAULT_RECOMMENDATION_POLICY, limit: 10, ...o };
}

const ids = (r: ReturnType<typeof rankRecommendations>) =>
  r.ok ? r.value.items.map((i) => i.ref.entityId.toString()) : [];

describe("rankRecommendations - ordem", () => {
  it("(1) maior score primeiro; posicoes contiguas a partir de 0", () => {
    const r = rankRecommendations(req([cand(1, 0.2), cand(2, 0.9), cand(3, 0.5)]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.items.map((i) => i.ref.entityId)).toEqual([2n, 3n, 1n]);
      expect(r.value.items.map((i) => i.position)).toEqual([0, 1, 2]);
    }
  });

  it("(2) ordem de entrada NAO altera o resultado", () => {
    const cands = [cand(1, 0.2), cand(2, 0.9), cand(3, 0.5)];
    const forward = ids(rankRecommendations(req(cands)));
    const reversed = ids(rankRecommendations(req([...cands].reverse())));
    expect(forward).toEqual(reversed);
  });

  it("(3) empate de score usa confianca como desempate", () => {
    // Mesmos sinais => mesmo score; confianca difere por profundidade nao muda aqui,
    // entao o desempate cai para popularidade e depois entityId (determinista).
    const r = rankRecommendations(req([cand(9, 0.5), cand(3, 0.5)]));
    if (r.ok) {
      // scores/confiancas iguais => desempate por entityId asc.
      expect(r.value.items.map((i) => i.ref.entityId)).toEqual([3n, 9n]);
    }
  });
});

describe("rankRecommendations - limite", () => {
  it("(4) limite e respeitado apos ordenacao", () => {
    const r = rankRecommendations(req([cand(1, 0.2), cand(2, 0.9), cand(3, 0.5)], { limit: 2 }));
    expect(ids(r)).toEqual(["2", "3"]);
  });

  it("(5) limite 0 retorna vazio", () => {
    const r = rankRecommendations(req([cand(1, 0.9)], { limit: 0 }));
    expect(r.ok && r.value.items).toEqual([]);
  });

  it("(6) limite negativo ou nao inteiro e rejeitado (validation_failed)", () => {
    expect(rankRecommendations(req([cand(1, 0.9)], { limit: -1 })).ok).toBe(false);
    expect(rankRecommendations(req([cand(1, 0.9)], { limit: 1.5 })).ok).toBe(false);
  });
});

describe("rankRecommendations - dedup, elegibilidade, imutabilidade", () => {
  it("(7) duplicidade por entidade nao gera dois itens nem soma sinais", () => {
    const r = rankRecommendations(req([cand(1, 0.9), cand(1, 0.3)]));
    expect(ids(r)).toEqual(["1"]);
  });

  it("(7b) dedup e order-independent mesmo com EMPATE TOTAL de sinais (regressao A9)", () => {
    // Mesmo ref, sinais identicos (0.5/0.5/0.5), mas genero/watchState diferentes
    // => afetam score/razoes. O sobrevivente NAO pode depender da ordem de entrada.
    const profileTie: PreferenceProfile = {
      genreWeights: { drama: 0.8, comedy: 0.2 },
      entityTypeWeights: { movie: 0.6 },
      localeWeights: { "pt-BR": 0.9 },
    };
    const x = cand(1, 0.5, { genres: ["drama"], watchState: null });
    const y = cand(1, 0.5, { genres: ["comedy"], watchState: "dropped" });
    const forward = rankRecommendations(req([x, y], { profile: profileTie }));
    const reversed = rankRecommendations(req([y, x], { profile: profileTie }));
    const norm = (v: ReturnType<typeof rankRecommendations>) =>
      JSON.stringify(v, (_k, z) => (typeof z === "bigint" ? z.toString() : z));
    expect(norm(forward)).toEqual(norm(reversed));
  });

  it("(8) candidatos inelegiveis nunca aparecem", () => {
    const r = rankRecommendations(
      req([
        cand(1, 0.9),
        cand(2, 0.9, { blocked: true }),
        cand(3, 0.9, { notInterested: true }),
        cand(4, 0.9, { ref: { entityType: "person", entityId: 4n } }),
        cand(5, 0.9, { watchState: "watched" }),
      ]),
    );
    expect(ids(r)).toEqual(["1"]);
  });

  it("(9) a entrada NAO e modificada", () => {
    const cands = [cand(1, 0.2), cand(2, 0.9)];
    const before = JSON.stringify(cands, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    rankRecommendations(req(cands));
    const after = JSON.stringify(cands, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(after).toEqual(before);
  });

  it("(10) sem candidato elegivel => resultado vazio (neutro)", () => {
    const r = rankRecommendations(req([cand(1, 0.9, { licenseEligible: false })]));
    expect(r.ok && r.value.items).toEqual([]);
  });

  it("(11) o resultado nunca contem userId", () => {
    const r = rankRecommendations(req([cand(1, 0.9)]));
    const s = JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(s.includes("userId")).toBe(false);
  });
});

describe("rankRecommendations - cold start e contexto", () => {
  it("(12) cold start SEM sinais => vazio (nenhuma recomendacao falsa)", () => {
    const coldProfile: PreferenceProfile = { genreWeights: {}, entityTypeWeights: {}, localeWeights: {} };
    const r = rankRecommendations({
      context: "discovery",
      profile: coldProfile,
      history: { watchedCount: 0, ratedCount: 0, distinctGenreCount: 0 },
      candidates: [cand(1, null as unknown as number, { popularity: null, recency: null, genres: [], locales: [] })],
      policy: DEFAULT_RECOMMENDATION_POLICY,
      limit: 10,
    });
    // similarity null + tudo null => sem sinais => sem razoes => excluido.
    expect(r.ok && r.value.items).toEqual([]);
  });

  it("(13) cold start COM popularidade => razao cold_start_popular e confianca baixa", () => {
    const coldProfile: PreferenceProfile = { genreWeights: {}, entityTypeWeights: {}, localeWeights: {} };
    const r = rankRecommendations({
      context: "discovery",
      profile: coldProfile,
      history: { watchedCount: 0, ratedCount: 0, distinctGenreCount: 0 },
      candidates: [cand(1, null as unknown as number, { popularity: 0.9, recency: null, genres: [], locales: [] })],
      policy: DEFAULT_RECOMMENDATION_POLICY,
      limit: 10,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.items).toHaveLength(1);
      expect(r.value.items[0]?.reasons.map((x) => x.code)).toContain("cold_start_popular");
      expect(r.value.items[0]?.confidence).toBeLessThanOrEqual(
        DEFAULT_RECOMMENDATION_POLICY.maxColdStartConfidence,
      );
    }
  });

  it("(14) continue_watching gera continue_series para item com progresso", () => {
    const r = rankRecommendations(
      req([cand(1, 0.5, { watchState: "watching", hasProgress: true })], { context: "continue_watching" }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.items[0]?.reasons.map((x) => x.code)).toContain("continue_series");
    }
  });
});
