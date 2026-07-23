/**
 * Testes de FEEDBACK (C6B): planejamento idempotente (create/noop/conflict/
 * invalid/forbidden) e exclusoes derivadas. Provam que feedback nao vira rating/
 * review/watch state/lista/Cinerie Score, que not_interested gera exclusao dura,
 * que already_seen respeita contexto, que dismiss e temporal, que positivo e
 * inerte, que exclusoes independem da ordem e nao duplicam, e que nada vaza PII
 * nem texto livre.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_FEEDBACK_POLICY } from "../policy.js";
import {
  deriveFeedbackExclusions,
  type FeedbackCommand,
  planRecommendationFeedback,
  type StoredFeedback,
} from "../feedback.js";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;
const POLICY = DEFAULT_FEEDBACK_POLICY; // dismiss/notRelevant = 30d

function command(o: Partial<FeedbackCommand> = {}): FeedbackCommand {
  return {
    ownerUserId: 7n,
    entityType: "movie",
    entityId: 1n,
    feedbackType: "not_interested",
    context: null,
    occurredAt: NOW,
    idempotencyKey: "k1",
    source: "app",
    accountStatus: "active",
    ...o,
  };
}

function stored(o: Partial<StoredFeedback> = {}): StoredFeedback {
  return {
    ownerUserId: 7n,
    entityType: "movie",
    entityId: 1n,
    feedbackType: "not_interested",
    context: null,
    occurredAt: NOW,
    idempotencyKey: "k1",
    source: "app",
    ...o,
  };
}

function keysOf(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const el of value) keysOf(el, out);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  return out;
}

describe("planRecommendationFeedback: idempotencia e validacao", () => {
  it("feedback valido (sem pre-imagem) => create com occurredAt ISO", () => {
    const p = planRecommendationFeedback({ command: command(), existing: null });
    expect(p.kind).toBe("create");
    if (p.kind === "create") {
      expect(p.record.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(p.record.feedbackType).toBe("not_interested");
    }
  });

  it("replay identico => noop (nao cria nova versao)", () => {
    const p = planRecommendationFeedback({ command: command(), existing: stored() });
    expect(p.kind).toBe("noop");
  });

  it("mesma idempotencyKey com conteudo divergente => conflict", () => {
    const p = planRecommendationFeedback({
      command: command({ feedbackType: "hide" }),
      existing: stored({ feedbackType: "not_interested" }),
    });
    expect(p.kind).toBe("conflict");
  });

  it("occurredAt NAO quebra idempotencia (replay com outro instante ainda e noop)", () => {
    const p = planRecommendationFeedback({
      command: command({ occurredAt: NOW + 999 }),
      existing: stored({ occurredAt: NOW }),
    });
    expect(p.kind).toBe("noop");
  });

  it("tipo desconhecido, entidade invalida e origem invalida falham fechado", () => {
    expect(planRecommendationFeedback({ command: command({ feedbackType: "boo" as never }), existing: null }).kind).toBe("invalid");
    expect(planRecommendationFeedback({ command: command({ entityType: "person" }), existing: null }).kind).toBe("invalid");
    expect(planRecommendationFeedback({ command: command({ entityId: 0n }), existing: null }).kind).toBe("invalid");
    expect(planRecommendationFeedback({ command: command({ source: "bot" as never }), existing: null }).kind).toBe("invalid");
    expect(planRecommendationFeedback({ command: command({ idempotencyKey: "  " }), existing: null }).kind).toBe("invalid");
    expect(planRecommendationFeedback({ command: command({ occurredAt: -1 }), existing: null }).kind).toBe("invalid");
  });

  it("conta bloqueada falha (forbidden)", () => {
    expect(planRecommendationFeedback({ command: command({ accountStatus: "disabled" }), existing: null }).kind).toBe("forbidden");
    expect(planRecommendationFeedback({ command: command({ accountStatus: "deleted" }), existing: null }).kind).toBe("forbidden");
  });

  it("create NAO carrega rating/review/watch state/lista/Cinerie Score nem texto livre/PII", () => {
    const p = planRecommendationFeedback({ command: command(), existing: null });
    expect(p.kind).toBe("create");
    if (p.kind === "create") {
      const keys = keysOf(p);
      for (const banned of [
        "rating",
        "ratingValue",
        "review",
        "reviewBody",
        "watchState",
        "list",
        "cinerieScore",
        "email",
        "token",
        "note",
        "reason",
      ]) {
        expect(keys.has(banned)).toBe(false);
      }
    }
  });

  it("feedback positivo (like) => create valido, mas NUNCA vira rating", () => {
    const p = planRecommendationFeedback({ command: command({ feedbackType: "like" }), existing: null });
    expect(p.kind).toBe("create");
    if (p.kind === "create") expect(keysOf(p).has("ratingValue")).toBe(false);
  });
});

describe("deriveFeedbackExclusions", () => {
  it("not_interested => exclusao DURA em todos os contextos", () => {
    const { exclusions } = deriveFeedbackExclusions({ feedbacks: [stored()], now: NOW, policy: POLICY });
    expect(exclusions.length).toBe(1);
    expect(exclusions[0]!.strength).toBe("hard");
    expect(exclusions[0]!.contexts).toEqual(["discovery", "continue_watching", "rewatch", "similar"]);
    expect(exclusions[0]!.expiresAtMs).toBeNull();
    expect(exclusions[0]!.entityId).toBe("1");
  });

  it("already_seen respeita contexto (discovery/similar, NAO rewatch)", () => {
    const { exclusions } = deriveFeedbackExclusions({
      feedbacks: [stored({ feedbackType: "already_seen" })],
      now: NOW,
      policy: POLICY,
    });
    expect(exclusions[0]!.strength).toBe("soft");
    expect(exclusions[0]!.contexts).toContain("discovery");
    expect(exclusions[0]!.contexts).not.toContain("rewatch");
  });

  it("dismiss e temporal: ativo antes de expirar, ausente depois", () => {
    const active = deriveFeedbackExclusions({
      feedbacks: [stored({ feedbackType: "dismiss", occurredAt: NOW })],
      now: NOW + DAY,
      policy: POLICY,
    });
    expect(active.exclusions[0]!.strength).toBe("temporary");
    expect(active.exclusions[0]!.expiresAtMs).toBe(NOW + POLICY.dismissTtlMs);

    const expired = deriveFeedbackExclusions({
      feedbacks: [stored({ feedbackType: "dismiss", occurredAt: NOW })],
      now: NOW + POLICY.dismissTtlMs + 1,
      policy: POLICY,
    });
    expect(expired.exclusions.length).toBe(0);
  });

  it("dismiss com contexto restringe o escopo daquele contexto", () => {
    const { exclusions } = deriveFeedbackExclusions({
      feedbacks: [stored({ feedbackType: "dismiss", context: "continue_watching", occurredAt: NOW })],
      now: NOW + DAY,
      policy: POLICY,
    });
    expect(exclusions[0]!.contexts).toEqual(["continue_watching"]);
  });

  it("positivo (like/save) NAO gera exclusao", () => {
    const { exclusions } = deriveFeedbackExclusions({
      feedbacks: [stored({ feedbackType: "like" }), stored({ entityId: 2n, feedbackType: "save" })],
      now: NOW,
      policy: POLICY,
    });
    expect(exclusions).toEqual([]);
  });

  it("dominancia hard > soft: not_interested + already_seen na mesma entidade => 1 exclusao dura", () => {
    const { exclusions } = deriveFeedbackExclusions({
      feedbacks: [stored({ feedbackType: "not_interested" }), stored({ feedbackType: "already_seen" })],
      now: NOW,
      policy: POLICY,
    });
    expect(exclusions.length).toBe(1);
    expect(exclusions[0]!.strength).toBe("hard");
  });

  it("duplicidade nao gera multiplas exclusoes", () => {
    const { exclusions } = deriveFeedbackExclusions({
      feedbacks: [stored(), stored({ idempotencyKey: "k2" }), stored({ idempotencyKey: "k3" })],
      now: NOW,
      policy: POLICY,
    });
    expect(exclusions.length).toBe(1);
  });

  it("ordem dos feedbacks NAO altera as exclusoes derivadas", () => {
    const a = stored({ entityId: 1n, feedbackType: "not_interested" });
    const b = stored({ entityId: 2n, feedbackType: "already_seen", idempotencyKey: "k2" });
    const r1 = deriveFeedbackExclusions({ feedbacks: [a, b], now: NOW, policy: POLICY });
    const r2 = deriveFeedbackExclusions({ feedbacks: [b, a], now: NOW, policy: POLICY });
    expect(r1).toEqual(r2);
  });

  it("exclusoes sao JSON-safe (entityId string, sem PII/texto livre)", () => {
    const { exclusions } = deriveFeedbackExclusions({ feedbacks: [stored()], now: NOW, policy: POLICY });
    expect(typeof exclusions[0]!.entityId).toBe("string");
    expect(() => JSON.stringify(exclusions)).not.toThrow();
    const keys = keysOf(exclusions);
    for (const banned of ["ownerUserId", "userId", "email", "note", "reason", "idempotencyKey"]) {
      expect(keys.has(banned)).toBe(false);
    }
  });

  it("now invalido => sem exclusoes (fail-closed)", () => {
    expect(deriveFeedbackExclusions({ feedbacks: [stored()], now: -1, policy: POLICY }).exclusions).toEqual([]);
  });
});
