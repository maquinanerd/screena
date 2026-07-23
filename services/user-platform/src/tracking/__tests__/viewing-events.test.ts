/**
 * Testes de registro de eventos: entidade rastreavel, tipo/source validos,
 * gate de conta, evento futuro fora da tolerancia, e idempotencia (mesma chave
 * + mesmo conteudo = no-op; mesma chave + conteudo divergente = conflict).
 */

import { describe, expect, it } from "vitest";
import { registerViewingEvent } from "../viewing-events.js";
import { FUTURE_EVENT_TOLERANCE_SECONDS } from "../policy.js";
import type { StoredViewingEvent, ViewingEventInput } from "../types.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const OCCURRED = new Date("2026-07-17T11:00:00.000Z");
const KEY = "idem-key-viewevent-1";

function candidate(overrides: Partial<ViewingEventInput> = {}): ViewingEventInput {
  return {
    userId: 1n,
    entityType: "movie",
    entityId: 42n,
    eventType: "watch_completed",
    occurredAt: OCCURRED,
    idempotencyKey: KEY,
    source: "app",
    ...overrides,
  };
}

function stored(overrides: Partial<StoredViewingEvent> = {}): StoredViewingEvent {
  return {
    eventId: 100n,
    userId: 1n,
    entityType: "movie",
    entityId: 42n,
    eventType: "watch_completed",
    occurredAt: OCCURRED,
    idempotencyKey: KEY,
    source: "app",
    ...overrides,
  };
}

function base(overrides: Partial<Parameters<typeof registerViewingEvent>[0]> = {}) {
  return { candidate: candidate(), existingWithSameKey: null, now: NOW, accountStatus: "active" as const, ...overrides };
}

describe("registerViewingEvent: validacao", () => {
  it("(1) evento valido novo e aceito (append)", () => {
    const r = registerViewingEvent(base());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.action).toBe("append");
  });

  it("(2) entidade nao rastreavel (person) e rejeitada", () => {
    const r = registerViewingEvent(base({ candidate: candidate({ entityType: "person" as never }) }));
    expect(r.ok).toBe(false);
  });

  it("(3) tipo de evento desconhecido e rejeitado", () => {
    const r = registerViewingEvent(base({ candidate: candidate({ eventType: "exploded" as never }) }));
    expect(r.ok).toBe(false);
  });

  it("(4) gate de conta: conta nao-active nao registra (A7)", () => {
    for (const status of ["pending_deletion", "deleted", "disabled"] as const) {
      const r = registerViewingEvent(base({ accountStatus: status }));
      expect(r.ok, status).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("forbidden");
    }
  });

  it("(5) evento futuro alem da tolerancia e rejeitado", () => {
    const future = new Date(NOW.getTime() + (FUTURE_EVENT_TOLERANCE_SECONDS + 10) * 1000);
    const r = registerViewingEvent(base({ candidate: candidate({ occurredAt: future }) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("precondition_failed");
  });

  it("(6) evento levemente futuro DENTRO da tolerancia e aceito", () => {
    const nearFuture = new Date(NOW.getTime() + (FUTURE_EVENT_TOLERANCE_SECONDS - 10) * 1000);
    expect(registerViewingEvent(base({ candidate: candidate({ occurredAt: nearFuture }) })).ok).toBe(true);
  });
});

describe("registerViewingEvent: idempotencia", () => {
  it("(1) mesma chave + MESMO conteudo = no-op (completed repetido sem rewatch)", () => {
    const r = registerViewingEvent(base({ existingWithSameKey: stored() }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.action).toBe("noop");
  });

  it("(2) mesma chave + conteudo DIVERGENTE = conflict", () => {
    // mesma chave, mas occurredAt diferente => divergente
    const divergent = stored({ occurredAt: new Date(OCCURRED.getTime() + 60_000) });
    const r = registerViewingEvent(base({ existingWithSameKey: divergent }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("conflict");
  });

  it("(2b) mesma chave + mesma identidade mas metadata DIVERGENTE = conflict", () => {
    const withDevice = candidate({ metadata: { device: "phone" } });
    const storedTv = stored({ metadata: { device: "tv" } });
    const r = registerViewingEvent(base({ candidate: withDevice, existingWithSameKey: storedTv }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("conflict");
  });

  it("(2c) mesma chave + tudo identico (inclusive metadata) = no-op", () => {
    const withDevice = candidate({ metadata: { device: "phone" } });
    const storedSame = stored({ metadata: { device: "phone" } });
    const r = registerViewingEvent(base({ candidate: withDevice, existingWithSameKey: storedSame }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.action).toBe("noop");
  });

  it("(3) rewatch explicito (chave nova, tipo rewatch_started) gera nova ocorrencia", () => {
    const rewatch = candidate({ idempotencyKey: "idem-key-rewatch-2", eventType: "rewatch_started" });
    const r = registerViewingEvent(base({ candidate: rewatch, existingWithSameKey: null }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.action).toBe("append");
  });

  it("(4) payload de erro nao ecoa o evento completo (sem metadata/ids)", () => {
    const divergent = stored({ eventType: "episode_watched" });
    const r = registerViewingEvent(base({ existingWithSameKey: divergent }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const text = JSON.stringify(r.error);
      expect(text).not.toContain("42"); // entityId nao vaza no erro
      expect(text).not.toContain("idem-key-viewevent-1");
    }
  });
});
