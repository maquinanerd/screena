/**
 * Testes de ELEGIBILIDADE: exclusoes obrigatorias (secao 9), fail-closed de
 * flags/estado, sinais numericos invalidos e regras por contexto (discovery /
 * continue_watching / rewatch / similar nunca se misturam).
 */

import { describe, expect, it } from "vitest";
import { evaluateEligibility } from "../eligibility.js";
import type { RecommendationCandidate, RecommendationContext } from "../types.js";

function candidate(overrides: Partial<RecommendationCandidate> = {}): RecommendationCandidate {
  return {
    ref: { entityType: "movie", entityId: 1n },
    genres: ["drama"],
    locales: ["pt-BR"],
    popularity: 0.5,
    similarity: 0.5,
    recency: 0.5,
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

function evalIn(c: RecommendationCandidate, context: RecommendationContext = "discovery") {
  return evaluateEligibility({ candidate: c, context });
}

describe("evaluateEligibility - flags e ref", () => {
  it("(1) candidato valido passa em discovery", () => {
    expect(evalIn(candidate())).toEqual({ eligible: true });
  });

  it("(2) tipo nao recomendavel (person) e excluido", () => {
    const r = evalIn(candidate({ ref: { entityType: "person", entityId: 1n } }));
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("type_not_recommendable");
  });

  it("(3) ref invalida (id <= 0) e excluida", () => {
    const r = evalIn(candidate({ ref: { entityType: "movie", entityId: 0n } }));
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("invalid_ref");
  });

  it("(4) displayEligible/licenseEligible/territoryEligible false excluem", () => {
    expect(evalIn(candidate({ displayEligible: false })).eligible).toBe(false);
    expect(evalIn(candidate({ licenseEligible: false })).eligible).toBe(false);
    expect(evalIn(candidate({ territoryEligible: false })).eligible).toBe(false);
  });

  it("(5) flag ausente (undefined) falha fechado", () => {
    const r = evalIn(candidate({ displayEligible: undefined as unknown as boolean }));
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("display_ineligible");
  });

  it("(6) blocked, not_interested e hidden excluem", () => {
    expect(evalIn(candidate({ blocked: true })).eligible).toBe(false);
    expect(evalIn(candidate({ notInterested: true })).eligible).toBe(false);
    expect(evalIn(candidate({ hidden: true })).eligible).toBe(false);
  });

  it("(7) not_interested via watchState tambem exclui (exclusao dura)", () => {
    const r = evalIn(candidate({ watchState: "not_interested" }));
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("not_interested");
  });

  it("(8) sinal NaN/Infinity/fora-de-faixa e excluido (invalid_signal)", () => {
    expect(evalIn(candidate({ popularity: Number.NaN })).eligible).toBe(false);
    expect(evalIn(candidate({ similarity: Number.POSITIVE_INFINITY })).eligible).toBe(false);
    expect(evalIn(candidate({ recency: 1.5 })).eligible).toBe(false);
    expect(evalIn(candidate({ popularity: -0.1 })).eligible).toBe(false);
  });

  it("(9) sinal null (ausente) e permitido", () => {
    expect(evalIn(candidate({ popularity: null, similarity: null, recency: null })).eligible).toBe(true);
  });

  it("(10) estado de acompanhamento desconhecido falha fechado", () => {
    const r = evalIn(candidate({ watchState: "frozen" as never }));
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("unknown_state");
  });
});

describe("evaluateEligibility - contexto (nao mistura)", () => {
  it("(11) discovery exclui watched (secao 9) e in-progress", () => {
    for (const ws of ["watched", "watching", "paused", "rewatching"] as const) {
      const r = evalIn(candidate({ watchState: ws }), "discovery");
      expect(r.eligible, ws).toBe(false);
      if (!r.eligible) expect(r.reason).toBe("engaged_in_discovery");
    }
  });

  it("(12) discovery permite null, planned e dropped", () => {
    for (const ws of [null, "planned", "dropped"] as const) {
      expect(evalIn(candidate({ watchState: ws }), "discovery").eligible, String(ws)).toBe(true);
    }
  });

  it("(13) continue_watching exige progresso (watching/paused + hasProgress)", () => {
    expect(
      evalIn(candidate({ watchState: "watching", hasProgress: true }), "continue_watching").eligible,
    ).toBe(true);
    const r = evalIn(candidate({ watchState: "watching", hasProgress: false }), "continue_watching");
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("not_in_progress");
    expect(evalIn(candidate({ watchState: null }), "continue_watching").eligible).toBe(false);
  });

  it("(14) continue_watching aceita season/episode; discovery nao", () => {
    const season = candidate({ ref: { entityType: "season", entityId: 3n }, watchState: "watching", hasProgress: true });
    expect(evalIn(season, "continue_watching").eligible).toBe(true);
    const seasonDisc = candidate({ ref: { entityType: "season", entityId: 3n } });
    const r = evalIn(seasonDisc, "discovery");
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("type_not_recommendable");
  });

  it("(15) rewatch exige ter assistido (watched/rewatching)", () => {
    expect(evalIn(candidate({ watchState: "watched" }), "rewatch").eligible).toBe(true);
    const r = evalIn(candidate({ watchState: "planned" }), "rewatch");
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("not_watched");
  });

  it("(16) similar exclui a propria entidade de contexto", () => {
    const r = evaluateEligibility({
      candidate: candidate({ ref: { entityType: "movie", entityId: 42n } }),
      context: "similar",
      contextEntityRef: { entityType: "movie", entityId: 42n },
    });
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toBe("context_entity");
  });

  it("(17) mesmo watched: excluido em discovery, elegivel em rewatch", () => {
    const c = candidate({ watchState: "watched" });
    expect(evalIn(c, "discovery").eligible).toBe(false);
    expect(evalIn(c, "rewatch").eligible).toBe(true);
  });
});
