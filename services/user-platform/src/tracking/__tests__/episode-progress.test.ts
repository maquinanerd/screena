/**
 * Testes de progresso de episodio: validacao (posicao/duracao/tolerancia),
 * no-op, regressao (rejeitada sem intencao; aceita com allowRegression),
 * conclusao manual, gate de conta, e derivacao de watch state de serie.
 */

import { describe, expect, it } from "vitest";
import {
  applyEpisodeProgress,
  type ApplyEpisodeProgressInput,
  deriveSeriesWatchState,
  type EpisodeProgressSnapshot,
} from "../episode-progress.js";
import { OVER_DURATION_TOLERANCE_SECONDS } from "../policy.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const KEY = "idem-key-episode-001";

function snap(overrides: Partial<EpisodeProgressSnapshot> = {}): EpisodeProgressSnapshot {
  return { watched: false, watchedAt: null, progressSeconds: null, durationSeconds: null, version: 1, ...overrides };
}

function input(overrides: Partial<ApplyEpisodeProgressInput> = {}): ApplyEpisodeProgressInput {
  return {
    current: snap(),
    patch: {},
    now: NOW,
    expectedVersion: 1,
    idempotencyKey: KEY,
    accountStatus: "active",
    ...overrides,
  };
}

describe("applyEpisodeProgress: validacao", () => {
  it("(1) posicao negativa rejeitada", () => {
    expect(applyEpisodeProgress(input({ patch: { progressSeconds: -1 } })).ok).toBe(false);
  });

  it("(2) duracao <= 0 rejeitada", () => {
    expect(applyEpisodeProgress(input({ patch: { durationSeconds: 0 } })).ok).toBe(false);
    expect(applyEpisodeProgress(input({ patch: { durationSeconds: -5 } })).ok).toBe(false);
  });

  it("(3) posicao acima da duracao segue tolerancia explicita", () => {
    // dentro da tolerancia: aceito
    const within = applyEpisodeProgress(
      input({ patch: { progressSeconds: 1000 + OVER_DURATION_TOLERANCE_SECONDS, durationSeconds: 1000 } }),
    );
    expect(within.ok).toBe(true);
    // alem da tolerancia: rejeitado
    const beyond = applyEpisodeProgress(
      input({ patch: { progressSeconds: 1000 + OVER_DURATION_TOLERANCE_SECONDS + 1, durationSeconds: 1000 } }),
    );
    expect(beyond.ok).toBe(false);
  });

  it("(4) gate de conta: conta nao-active nao atualiza progresso (A8)", () => {
    for (const status of ["pending_deletion", "deleted", "disabled"] as const) {
      const r = applyEpisodeProgress(input({ accountStatus: status, patch: { progressSeconds: 10 } }));
      expect(r.ok, status).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("forbidden");
    }
  });
});

describe("applyEpisodeProgress: transicoes", () => {
  it("(1) progresso crescente atualiza e gera progress_updated", () => {
    const r = applyEpisodeProgress(
      input({ current: snap({ progressSeconds: 100, durationSeconds: 1000 }), patch: { progressSeconds: 300 } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.next.progressSeconds).toBe(300);
    expect(r.value.events.map((e) => e.eventType)).toContain("progress_updated");
  });

  it("(2) patch identico e no-op (sem evento, versao inalterada)", () => {
    const current = snap({ progressSeconds: 300, durationSeconds: 1000, version: 4 });
    const r = applyEpisodeProgress(input({ current, patch: { progressSeconds: 300 }, expectedVersion: 4 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.events).toEqual([]);
    expect(r.value.next.version).toBe(4);
  });

  it("(3) progresso regressivo e rejeitado sem intencao explicita", () => {
    const current = snap({ progressSeconds: 500, durationSeconds: 1000 });
    const r = applyEpisodeProgress(input({ current, patch: { progressSeconds: 200 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("precondition_failed");
  });

  it("(4) regressao EXPLICITA (allowRegression) e aceita (correcao/rewatch)", () => {
    const current = snap({ progressSeconds: 500, durationSeconds: 1000 });
    const r = applyEpisodeProgress(input({ current, patch: { progressSeconds: 0 }, allowRegression: true }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.next.progressSeconds).toBe(0);
  });

  it("(5) conclusao manual (watched=true) seta watchedAt e gera episode_watched", () => {
    const r = applyEpisodeProgress(input({ patch: { watched: true } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.next.watched).toBe(true);
    expect(r.value.next.watchedAt).toEqual(NOW);
    expect(r.value.events.map((e) => e.eventType)).toContain("episode_watched");
  });

  it("(6) versao errada retorna version_conflict", () => {
    const r = applyEpisodeProgress(
      input({ current: snap({ version: 7 }), expectedVersion: 6, patch: { progressSeconds: 5 } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("version_conflict");
  });
});

describe("deriveSeriesWatchState", () => {
  it("(1) >=1 assistido a partir de planned/null -> watching", () => {
    expect(deriveSeriesWatchState({ currentSeriesStatus: null, totalKnownEpisodes: 10, watchedEpisodes: 1 })).toBe(
      "watching",
    );
    expect(
      deriveSeriesWatchState({ currentSeriesStatus: "planned", totalKnownEpisodes: 10, watchedEpisodes: 3 }),
    ).toBe("watching");
  });

  it("(2) todos assistidos -> watched (de watching/planned/null)", () => {
    expect(
      deriveSeriesWatchState({ currentSeriesStatus: "watching", totalKnownEpisodes: 5, watchedEpisodes: 5 }),
    ).toBe("watched");
  });

  it("(3) NUNCA rebaixa estado escolhido pelo usuario (dropped/paused/etc.)", () => {
    for (const s of ["watched", "paused", "dropped", "rewatching", "not_interested"] as const) {
      expect(deriveSeriesWatchState({ currentSeriesStatus: s, totalKnownEpisodes: 5, watchedEpisodes: 2 })).toBeNull();
    }
  });

  it("(4) entradas anomalas -> null (sem mudanca)", () => {
    expect(deriveSeriesWatchState({ currentSeriesStatus: null, totalKnownEpisodes: -1, watchedEpisodes: 1 })).toBeNull();
    expect(deriveSeriesWatchState({ currentSeriesStatus: null, totalKnownEpisodes: 5, watchedEpisodes: 1.5 })).toBeNull();
  });
});
