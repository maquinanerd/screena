/**
 * Testes do diario: historico vazio valido; ordem por occurredAt; desempate
 * determinista por eventId; dedup por idempotencyKey; rewatches separados;
 * exclusao de outro usuario; entrada embaralhada -> mesma saida; DTO minimo.
 */

import { describe, expect, it } from "vitest";
import { buildDiary } from "../diary.js";
import type { StoredViewingEvent } from "../types.js";

function ev(overrides: Partial<StoredViewingEvent>): StoredViewingEvent {
  return {
    eventId: 1n,
    userId: 1n,
    entityType: "movie",
    entityId: 10n,
    eventType: "watch_completed",
    occurredAt: new Date("2026-07-17T12:00:00.000Z"),
    idempotencyKey: "k1",
    source: "app",
    ...overrides,
  };
}

const T1 = new Date("2026-07-10T00:00:00.000Z");
const T2 = new Date("2026-07-15T00:00:00.000Z");
const T3 = new Date("2026-07-20T00:00:00.000Z");

describe("buildDiary", () => {
  it("(1) historico vazio produz projecao valida", () => {
    const d = buildDiary({ events: [], userId: 1n });
    expect(d.entries).toEqual([]);
    expect(d.totalEvents).toBe(0);
  });

  it("(2) ordena por occurredAt desc (mais recente primeiro) por padrao", () => {
    const d = buildDiary({
      events: [
        ev({ eventId: 1n, idempotencyKey: "a", occurredAt: T1 }),
        ev({ eventId: 2n, idempotencyKey: "b", occurredAt: T3 }),
        ev({ eventId: 3n, idempotencyKey: "c", occurredAt: T2 }),
      ],
      userId: 1n,
    });
    expect(d.entries.map((e) => e.occurredAt)).toEqual([T3.toISOString(), T2.toISOString(), T1.toISOString()]);
  });

  it("(3) entrada EMBARALHADA gera a MESMA saida (nao depende da ordem)", () => {
    const events = [
      ev({ eventId: 3n, idempotencyKey: "c", occurredAt: T2 }),
      ev({ eventId: 1n, idempotencyKey: "a", occurredAt: T1 }),
      ev({ eventId: 2n, idempotencyKey: "b", occurredAt: T3 }),
    ];
    const forward = buildDiary({ events, userId: 1n });
    const reversed = buildDiary({ events: [...events].reverse(), userId: 1n });
    expect(reversed.entries).toEqual(forward.entries);
  });

  it("(4) desempate por eventId quando occurredAt empata (determinista)", () => {
    const d = buildDiary({
      events: [
        ev({ eventId: 5n, idempotencyKey: "x", occurredAt: T2 }),
        ev({ eventId: 2n, idempotencyKey: "y", occurredAt: T2 }),
      ],
      userId: 1n,
      order: "asc",
    });
    // mesmo occurredAt -> ordena por eventId asc: 2 antes de 5
    expect(d.entries.map((e) => e.entityId)).toEqual(["10", "10"]);
    expect(d.totalEvents).toBe(2);
  });

  it("(5) eventos duplicados por idempotencyKey aparecem UMA vez", () => {
    const d = buildDiary({
      events: [
        ev({ eventId: 1n, idempotencyKey: "dup", occurredAt: T1 }),
        ev({ eventId: 2n, idempotencyKey: "dup", occurredAt: T1 }),
      ],
      userId: 1n,
    });
    expect(d.totalEvents).toBe(1);
  });

  it("(5b) eventos de TIPOS distintos com a MESMA chave (uma operacao) sobrevivem", () => {
    // watch-state.ts emite state_changed + watch_completed com a MESMA chave.
    const d = buildDiary({
      events: [
        ev({ eventId: 1n, idempotencyKey: "op-1", eventType: "state_changed", occurredAt: T1 }),
        ev({ eventId: 2n, idempotencyKey: "op-1", eventType: "watch_completed", occurredAt: T1 }),
      ],
      userId: 1n,
    });
    expect(d.totalEvents).toBe(2);
    expect(new Set(d.entries.map((e) => e.eventType))).toEqual(
      new Set(["state_changed", "watch_completed"]),
    );
  });

  it("(6) rewatches legitimos (chaves distintas) aparecem separadamente", () => {
    const d = buildDiary({
      events: [
        ev({ eventId: 1n, idempotencyKey: "watch-1", eventType: "watch_completed", occurredAt: T1 }),
        ev({ eventId: 2n, idempotencyKey: "rewatch-1", eventType: "rewatch_started", occurredAt: T3 }),
      ],
      userId: 1n,
    });
    expect(d.totalEvents).toBe(2);
  });

  it("(7) eventos de OUTRO usuario sao excluidos", () => {
    const d = buildDiary({
      events: [
        ev({ eventId: 1n, userId: 1n, idempotencyKey: "mine" }),
        ev({ eventId: 2n, userId: 99n, idempotencyKey: "theirs" }),
      ],
      userId: 1n,
    });
    expect(d.totalEvents).toBe(1);
  });

  it("(8) DTO nao expoe PK interna, userId nem idempotencyKey", () => {
    const d = buildDiary({ events: [ev({})], userId: 1n });
    const text = JSON.stringify(d.entries);
    expect(text).not.toContain("eventId");
    expect(text).not.toContain("userId");
    expect(text).not.toContain("idempotencyKey");
    expect(Object.keys(d.entries[0] ?? {}).sort()).toEqual(
      ["entityId", "entityType", "eventType", "occurredAt"].sort(),
    );
  });
});
