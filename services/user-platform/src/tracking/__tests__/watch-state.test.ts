/**
 * Testes de governanca — maquina de watch state (tracking).
 *
 * Provam: idempotencia (mesmo estado = no-op), optimistic lock (versao
 * errada = version_conflict), carimbos nunca destrutivos, eventos de
 * primeira ida, undo append-only (evento original nunca apagado).
 */

import { describe, expect, it } from "vitest";
import {
  applyWatchStateChange,
  buildUndo,
  isValidWatchTransition,
  type ApplyWatchStateChangeInput,
  type WatchStateSnapshot,
} from "../watch-state.js";
import { WATCH_STATES } from "../../core/types.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const EARLIER = new Date("2026-07-01T08:00:00.000Z");
const KEY = "idem-key-00000001";

function baseSnapshot(overrides: Partial<WatchStateSnapshot> = {}): WatchStateSnapshot {
  return {
    status: "planned",
    startedAt: null,
    completedAt: null,
    rewatchCount: 0,
    version: 1,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<ApplyWatchStateChangeInput> = {},
): ApplyWatchStateChangeInput {
  return {
    current: baseSnapshot(),
    target: "watching",
    now: NOW,
    expectedVersion: 1,
    idempotencyKey: KEY,
    accountStatus: "active",
    ...overrides,
  };
}

describe("isValidWatchTransition", () => {
  it("(1) aceita from null para qualquer estado (primeiro estado)", () => {
    for (const to of WATCH_STATES) {
      expect(isValidWatchTransition(null, to)).toBe(true);
    }
  });

  it("(2) aceita from === to (idempotente)", () => {
    for (const state of WATCH_STATES) {
      expect(isValidWatchTransition(state, state)).toBe(true);
    }
  });

  it("(3) permite sair de not_interested para qualquer estado (decisao explicita do usuario)", () => {
    for (const to of WATCH_STATES) {
      expect(isValidWatchTransition("not_interested", to)).toBe(true);
    }
  });

  it("(4) tabela liberal: qualquer par from/to e valido", () => {
    for (const from of WATCH_STATES) {
      for (const to of WATCH_STATES) {
        expect(isValidWatchTransition(from, to)).toBe(true);
      }
    }
  });
});

describe("applyWatchStateChange", () => {
  it("(5) mesmo status = no-op: events vazio, next identico, versao inalterada", () => {
    const current = baseSnapshot({ status: "watching", startedAt: EARLIER, version: 3 });
    const result = applyWatchStateChange(
      baseInput({ current, target: "watching", expectedVersion: 3 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.events).toEqual([]);
    expect(result.value.next).toEqual(current);
    expect(result.value.next.version).toBe(3);
  });

  it("(6) versao errada retorna version_conflict (optimistic lock)", () => {
    const result = applyWatchStateChange(
      baseInput({ current: baseSnapshot({ version: 5 }), expectedVersion: 4 }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("version_conflict");
  });

  it("(7) expectedVersion null pula o lock otimista", () => {
    const result = applyWatchStateChange(
      baseInput({ current: baseSnapshot({ version: 9 }), expectedVersion: null }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.next.version).toBe(10);
  });

  it("(8) primeira ida a watching seta startedAt e gera state_changed + watch_started", () => {
    const result = applyWatchStateChange(baseInput({ target: "watching" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.next.startedAt).toEqual(NOW);
    expect(result.value.next.version).toBe(2);
    const types = result.value.events.map((e) => e.eventType);
    expect(types).toContain("state_changed");
    expect(types).toContain("watch_started");
  });

  it("(9) volta a watching NAO sobrescreve startedAt e NAO repete watch_started", () => {
    const current = baseSnapshot({ status: "paused", startedAt: EARLIER, version: 2 });
    const result = applyWatchStateChange(
      baseInput({ current, target: "watching", expectedVersion: 2 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.next.startedAt).toEqual(EARLIER);
    const types = result.value.events.map((e) => e.eventType);
    expect(types).toEqual(["state_changed"]);
  });

  it("(10) primeira ida a watched seta completedAt e gera watch_completed", () => {
    const current = baseSnapshot({ status: "watching", startedAt: EARLIER });
    const result = applyWatchStateChange(baseInput({ current, target: "watched" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.next.completedAt).toEqual(NOW);
    const types = result.value.events.map((e) => e.eventType);
    expect(types).toContain("state_changed");
    expect(types).toContain("watch_completed");
  });

  it("(11) ida a watched com completedAt existente preserva o carimbo (nao destrutivo)", () => {
    const current = baseSnapshot({ status: "rewatching", completedAt: EARLIER, rewatchCount: 1 });
    const result = applyWatchStateChange(baseInput({ current, target: "watched" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.next.completedAt).toEqual(EARLIER);
    const types = result.value.events.map((e) => e.eventType);
    expect(types).toEqual(["state_changed"]);
  });

  it("(12) rewatching incrementa rewatchCount e gera rewatch_started", () => {
    const current = baseSnapshot({ status: "watched", completedAt: EARLIER, rewatchCount: 1 });
    const result = applyWatchStateChange(baseInput({ current, target: "rewatching" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.next.rewatchCount).toBe(2);
    const types = result.value.events.map((e) => e.eventType);
    expect(types).toContain("state_changed");
    expect(types).toContain("rewatch_started");
  });

  it("(13) current null cria estado com versao 1 e gera state_changed", () => {
    const result = applyWatchStateChange(
      baseInput({ current: null, target: "planned", expectedVersion: null }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.next.version).toBe(1);
    expect(result.value.next.status).toBe("planned");
    expect(result.value.next.rewatchCount).toBe(0);
    const types = result.value.events.map((e) => e.eventType);
    expect(types).toEqual(["state_changed"]);
  });

  it("(14) idempotencyKey invalida retorna validation_failed", () => {
    const result = applyWatchStateChange(baseInput({ idempotencyKey: "ab" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
  });

  it("(14b) conta bloqueada/pending_deletion/deleted NAO altera estado (fail-closed)", () => {
    for (const status of ["pending_deletion", "deleted", "disabled"] as const) {
      const result = applyWatchStateChange(baseInput({ accountStatus: status }));
      expect(result.ok, status).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    }
  });

  it("(15) todos os eventos carregam occurredAt = now e a idempotencyKey da chamada", () => {
    const result = applyWatchStateChange(baseInput({ target: "watched" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.events.length).toBeGreaterThan(0);
    for (const event of result.value.events) {
      expect(event.occurredAt).toEqual(NOW);
      expect(event.idempotencyKey).toBe(KEY);
    }
  });
});

describe("buildUndo", () => {
  it("(16) restaura o estado anterior e gera SOMENTE o evento undo (original nunca apagado)", () => {
    const previous = baseSnapshot({ status: "watching", startedAt: EARLIER, version: 2 });
    const result = buildUndo({ previous, now: NOW, idempotencyKey: KEY, accountStatus: "active" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.next).toEqual(previous);
    // plano appenda exatamente 1 evento novo (undo); nada e removido
    expect(result.value.events).toHaveLength(1);
    expect(result.value.events[0]?.eventType).toBe("undo");
    expect(result.value.events[0]?.occurredAt).toEqual(NOW);
    expect(result.value.events[0]?.idempotencyKey).toBe(KEY);
  });

  it("(17) previous null restaura inexistencia (next null) e ainda gera undo", () => {
    const result = buildUndo({ previous: null, now: NOW, idempotencyKey: KEY, accountStatus: "active" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.next).toBeNull();
    expect(result.value.events.map((e) => e.eventType)).toEqual(["undo"]);
  });

  it("(18) idempotencyKey invalida retorna validation_failed", () => {
    const result = buildUndo({ previous: null, now: NOW, idempotencyKey: "x", accountStatus: "active" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
  });
});
