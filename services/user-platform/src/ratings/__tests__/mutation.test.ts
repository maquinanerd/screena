/**
 * Testes do planner de mutacao de AVALIACAO DE USUARIO: planos explicitos
 * create / update / remove / noop, gate de conta (forbidden), validacao
 * (validation_failed), idempotencia e SEPARACAO (o plano nunca carrega fonte
 * externa, Cinerie Score ou conteudo de review).
 */

import { describe, expect, it } from "vitest";
import type { UserStatus } from "../../core/types.js";
import { planRatingRemoval, planRatingSet } from "../mutation.js";
import type { UserRatingSnapshot } from "../types.js";

const NOW = new Date("2026-07-20T12:00:00.000Z");

function snapshot(value: number): UserRatingSnapshot {
  return { entityType: "movie", entityId: 42n, value, scale: 5 };
}

function setInput(overrides: Partial<Parameters<typeof planRatingSet>[0]> = {}) {
  return {
    accountStatus: "active" as UserStatus,
    entityType: "movie",
    entityId: 42n,
    value: 4.5,
    scale: 5,
    current: null,
    now: NOW,
    ...overrides,
  };
}

function removalInput(overrides: Partial<Parameters<typeof planRatingRemoval>[0]> = {}) {
  return {
    accountStatus: "active" as UserStatus,
    entityType: "movie",
    entityId: 42n,
    current: null,
    now: NOW,
    ...overrides,
  };
}

const ALLOWED_PLAN_KEYS = ["kind", "entityType", "entityId", "value", "scale", "events"].sort();

describe("planRatingSet — create / update / noop", () => {
  it("(1) create quando nao ha nota: kind create, scale 5, evento rating_set em now", () => {
    const result = planRatingSet(setInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("create");
      expect(result.value.entityType).toBe("movie");
      expect(result.value.entityId).toBe(42n);
      expect(result.value.value).toBe(4.5);
      expect(result.value.scale).toBe(5);
      expect(result.value.events).toEqual([{ eventType: "rating_set", occurredAt: NOW }]);
    }
  });

  it("(2) noop quando a nota ja e a mesma: nenhum evento, valor preservado", () => {
    const result = planRatingSet(setInput({ current: snapshot(4.5), value: 4.5 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("noop");
      expect(result.value.events).toEqual([]);
      expect(result.value.value).toBe(4.5);
    }
  });

  it("(3) noop com comparacao canonica de meia-estrela (4.0 vs 4)", () => {
    const result = planRatingSet(setInput({ current: snapshot(4.0), value: 4 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("noop");
    }
  });

  it("(4) update quando o valor muda: evento rating_set, novo valor", () => {
    const result = planRatingSet(setInput({ current: snapshot(3), value: 5 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("update");
      expect(result.value.value).toBe(5);
      expect(result.value.events).toEqual([{ eventType: "rating_set", occurredAt: NOW }]);
    }
  });

  it("(5) o plano expoe SOMENTE campos de nota de usuario (sem fonte externa/review)", () => {
    const result = planRatingSet(setInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value).sort()).toEqual(ALLOWED_PLAN_KEYS);
      const serialized = JSON.stringify(result.value, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v,
      );
      for (const forbidden of [
        "ratingSource",
        "providerApi",
        "sourceLicenseId",
        "attributionText",
        "scoreAllowed",
        "licenseStatus",
        "cinerieScore",
        "spoiler",
        "reviewBody",
        "moderationStatus",
      ]) {
        expect(serialized.includes(forbidden), `plano nao pode conter ${forbidden}`).toBe(false);
      }
    }
  });
});

describe("planRatingSet — gate e validacao (fail-closed)", () => {
  it("(6) conta bloqueada NAO cria (forbidden), mesmo com valor valido", () => {
    for (const status of ["disabled", "pending_deletion", "deleted"] as const) {
      const result = planRatingSet(setInput({ accountStatus: status }));
      expect(result.ok, `${status} deveria bloquear`).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("forbidden");
      }
    }
  });

  it("(7) estado desconhecido falha fechado (forbidden), antes de qualquer plano", () => {
    const result = planRatingSet(setInput({ accountStatus: "frozen" as UserStatus }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("forbidden");
    }
  });

  it("(8) tipo nao avaliavel (person) falha com validation_failed", () => {
    const result = planRatingSet(setInput({ entityType: "person" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_failed");
      expect(result.error.details?.some((d) => d.includes("entityType"))).toBe(true);
    }
  });

  it("(9) entityId nao positivo falha com validation_failed", () => {
    const result = planRatingSet(setInput({ entityId: 0n }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details?.some((d) => d.includes("entityId"))).toBe(true);
    }
  });

  it("(10) acumula erros: person + 4.75 + escala 10 => 3 detalhes", () => {
    const result = planRatingSet(setInput({ entityType: "person", value: 4.75, scale: 10 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details?.length).toBe(3);
    }
  });
});

describe("planRatingRemoval — remove / noop", () => {
  it("(11) remove nota existente: kind remove, evento rating_removed em now", () => {
    const result = planRatingRemoval(removalInput({ current: snapshot(4) }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("remove");
      expect(result.value.value).toBeNull();
      expect(result.value.events).toEqual([{ eventType: "rating_removed", occurredAt: NOW }]);
    }
  });

  it("(12) remover item inexistente e noop (sem evento, sem erro)", () => {
    const result = planRatingRemoval(removalInput({ current: null }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("noop");
      expect(result.value.events).toEqual([]);
    }
  });

  it("(13) remocao com conta bloqueada e forbidden", () => {
    const result = planRatingRemoval(removalInput({ accountStatus: "deleted", current: snapshot(4) }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("forbidden");
    }
  });

  it("(14) remocao de tipo nao avaliavel e validation_failed", () => {
    const result = planRatingRemoval(removalInput({ entityType: "person" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_failed");
    }
  });
});

describe("idempotencia e determinismo", () => {
  it("(15) mesma intencao (mesma entrada) produz sempre a mesma saida", () => {
    const first = planRatingSet(setInput({ current: snapshot(3), value: 5 }));
    const second = planRatingSet(setInput({ current: snapshot(3), value: 5 }));
    const stable = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
    expect(stable(first)).toEqual(stable(second));
  });

  it("(16) replay de noop nunca emite evento (nada a bumpar/registrar)", () => {
    const first = planRatingSet(setInput({ current: snapshot(4.5), value: 4.5 }));
    const second = planRatingSet(setInput({ current: snapshot(4.5), value: 4.5 }));
    expect(first.ok && first.value.events).toEqual([]);
    expect(second.ok && second.value.events).toEqual([]);
  });

  it("(17) mudanca real NAO e escondida como noop: vira update explicito", () => {
    const result = planRatingSet(setInput({ current: snapshot(2.5), value: 3 }));
    expect(result.ok && result.value.kind).toBe("update");
  });

  it("(18) remove repetido continua noop (idempotente), nunca erro residual", () => {
    const first = planRatingRemoval(removalInput({ current: null }));
    const second = planRatingRemoval(removalInput({ current: null }));
    expect(first.ok && first.value.kind).toBe("noop");
    expect(second.ok && second.value.kind).toBe("noop");
  });
});
