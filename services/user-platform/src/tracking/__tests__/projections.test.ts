/**
 * Testes de projecoes: progresso de temporada/serie (sem div/0), dedup de
 * episodios, especiais (season 0) sem corromper temporada, rewatches, retomada,
 * ultima atividade, determinismo e fail-closed em vazio.
 */

import { describe, expect, it } from "vitest";
import {
  buildTrackingActivitySummary,
  computeSeasonProgress,
  computeSeriesProgress,
  countCompletedEpisodes,
  countRewatches,
  deriveResumePoint,
  type EpisodeProgressEntry,
  groupSeasonProgress,
  lastActivityAt,
} from "../projections.js";
import type { StoredViewingEvent } from "../types.js";

function ep(overrides: Partial<EpisodeProgressEntry>): EpisodeProgressEntry {
  return {
    episodeId: 1n,
    seasonNumber: 1,
    watched: false,
    progressSeconds: null,
    durationSeconds: null,
    lastActivityAt: null,
    ...overrides,
  };
}

describe("computeSeasonProgress / computeSeriesProgress", () => {
  it("(1) temporada sem episodios => fraction 0, complete false (nunca NaN)", () => {
    const p = computeSeasonProgress([]);
    expect(p).toEqual({ totalEpisodes: 0, watchedEpisodes: 0, fraction: 0, complete: false });
    expect(Number.isNaN(p.fraction)).toBe(false);
  });

  it("(2) progresso correto e completo quando todos assistidos", () => {
    const p = computeSeasonProgress([
      ep({ episodeId: 1n, watched: true }),
      ep({ episodeId: 2n, watched: true }),
    ]);
    expect(p).toEqual({ totalEpisodes: 2, watchedEpisodes: 2, fraction: 1, complete: true });
  });

  it("(3) episodios DUPLICADos por id NAO inflam a contagem", () => {
    const p = computeSeasonProgress([
      ep({ episodeId: 1n, watched: true }),
      ep({ episodeId: 1n, watched: false }), // mesmo id: OR => watched
      ep({ episodeId: 2n, watched: false }),
    ]);
    expect(p.totalEpisodes).toBe(2);
    expect(p.watchedEpisodes).toBe(1);
  });

  it("(4) serie vazia => estado seguro", () => {
    expect(computeSeriesProgress([]).fraction).toBe(0);
  });
});

describe("groupSeasonProgress (especiais)", () => {
  it("(1) especiais (season 0) formam grupo proprio e NAO corrompem a temporada principal", () => {
    const groups = groupSeasonProgress([
      ep({ episodeId: 1n, seasonNumber: 1, watched: true }),
      ep({ episodeId: 2n, seasonNumber: 1, watched: true }),
      ep({ episodeId: 9n, seasonNumber: 0, watched: false }), // especial
    ]);
    expect(groups.map((g) => g.seasonNumber)).toEqual([0, 1]); // ordem canonica asc
    const s1 = groups.find((g) => g.seasonNumber === 1)?.progress;
    expect(s1?.complete).toBe(true); // especial nao corrompe a temporada 1
    const s0 = groups.find((g) => g.seasonNumber === 0)?.progress;
    expect(s0?.complete).toBe(false);
  });
});

describe("countCompletedEpisodes / countRewatches / lastActivityAt", () => {
  const T1 = new Date("2026-07-10T00:00:00.000Z");
  const T3 = new Date("2026-07-20T00:00:00.000Z");

  function sv(overrides: Partial<StoredViewingEvent>): StoredViewingEvent {
    return {
      eventId: 1n,
      userId: 1n,
      entityType: "tv",
      entityId: 10n,
      eventType: "progress_updated",
      occurredAt: T1,
      idempotencyKey: "k",
      source: "app",
      ...overrides,
    };
  }

  it("(1) episodios concluidos sem duplicidade", () => {
    expect(
      countCompletedEpisodes([
        ep({ episodeId: 1n, watched: true }),
        ep({ episodeId: 1n, watched: true }),
        ep({ episodeId: 2n, watched: false }),
      ]),
    ).toBe(1);
  });

  it("(2) rewatches contados por chave distinta", () => {
    expect(
      countRewatches([
        sv({ eventType: "rewatch_started", idempotencyKey: "r1" }),
        sv({ eventType: "rewatch_started", idempotencyKey: "r1" }), // dup
        sv({ eventType: "rewatch_started", idempotencyKey: "r2" }),
        sv({ eventType: "watch_completed", idempotencyKey: "w1" }),
      ]),
    ).toBe(2);
  });

  it("(3) ultima atividade = maior occurredAt; evento antigo NAO rebaixa", () => {
    expect(lastActivityAt([sv({ occurredAt: T3 }), sv({ occurredAt: T1 })])).toBe(T3.toISOString());
    expect(lastActivityAt([])).toBeNull();
  });
});

describe("deriveResumePoint", () => {
  const T1 = new Date("2026-07-10T00:00:00.000Z");
  const T2 = new Date("2026-07-15T00:00:00.000Z");

  it("(1) escolhe o episodio nao concluido com progresso e atividade mais recente", () => {
    const r = deriveResumePoint([
      ep({ episodeId: 1n, watched: false, progressSeconds: 100, durationSeconds: 1000, lastActivityAt: T1 }),
      ep({ episodeId: 2n, watched: false, progressSeconds: 500, durationSeconds: 1000, lastActivityAt: T2 }),
      ep({ episodeId: 3n, watched: true, progressSeconds: 1000, durationSeconds: 1000, lastActivityAt: T2 }),
    ]);
    expect(r?.episodeId).toBe("2");
    expect(r?.progressSeconds).toBe(500);
    expect(r?.fraction).toBeCloseTo(0.5);
  });

  it("(2) nenhum candidato => null", () => {
    expect(deriveResumePoint([ep({ watched: true, progressSeconds: 100 })])).toBeNull();
    expect(deriveResumePoint([])).toBeNull();
  });
});

describe("buildTrackingActivitySummary (neutro para stats)", () => {
  it("(1) resumo deterministico; entrada embaralhada => mesma saida", () => {
    const episodes = [
      ep({ episodeId: 1n, seasonNumber: 1, watched: true }),
      ep({ episodeId: 2n, seasonNumber: 1, watched: true }),
    ];
    const events: StoredViewingEvent[] = [
      {
        eventId: 1n,
        userId: 1n,
        entityType: "tv",
        entityId: 10n,
        eventType: "rewatch_started",
        occurredAt: new Date("2026-07-20T00:00:00.000Z"),
        idempotencyKey: "r1",
        source: "app",
      },
    ];
    const a = buildTrackingActivitySummary({ episodes, events });
    const b = buildTrackingActivitySummary({ episodes: [...episodes].reverse(), events });
    expect(a).toEqual(b);
    expect(a.completedEpisodes).toBe(2);
    expect(a.rewatches).toBe(1);
    expect(a.seasonsComplete).toBe(1);
  });
});
