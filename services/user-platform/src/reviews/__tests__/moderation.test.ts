/**
 * Testes de MODERACAO de review: maquina de estados, plano `planModeration`
 * (moderate/noop/conflict), decisao humana obrigatoria, motivo/nota internos
 * limitados, validacao e resolucao de denuncias e bloqueios.
 */

import { describe, expect, it } from "vitest";
import {
  applyModerationDecision,
  isValidModerationTransition,
  MODERATION_NOTE_MAX_LENGTH,
  planModeration,
  resolveReport,
  validateBlock,
  validateReport,
} from "../moderation.js";

const NOW = new Date("2026-07-20T12:00:00.000Z");
const APPROVED_AT = new Date("2026-07-10T00:00:00.000Z");

describe("isValidModerationTransition", () => {
  it("(1) aceita as transicoes canonicas", () => {
    expect(isValidModerationTransition("pending", "approved")).toBe(true);
    expect(isValidModerationTransition("pending", "rejected")).toBe(true);
    expect(isValidModerationTransition("approved", "removed")).toBe(true);
    expect(isValidModerationTransition("rejected", "pending")).toBe(true);
  });

  it("(2) rejeita transicoes invalidas e o estado terminal removed", () => {
    expect(isValidModerationTransition("approved", "pending")).toBe(false);
    expect(isValidModerationTransition("rejected", "approved")).toBe(false);
    expect(isValidModerationTransition("removed", "approved")).toBe(false);
    expect(isValidModerationTransition("pending", "pending")).toBe(false);
  });
});

describe("planModeration", () => {
  it("(3) aprovar (pending -> approved) produz moderate com publishedAt = now", () => {
    const result = planModeration({
      currentStatus: "pending",
      currentPublishedAt: null,
      decision: "approved",
      decidedBy: "mod-humano-1",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("moderate");
      expect(result.value.changes.status).toBe("approved");
      expect(result.value.changes.publishedAt).toBe(NOW);
    }
  });

  it("(4) remover (approved -> removed) despublica (publishedAt null)", () => {
    const result = planModeration({
      currentStatus: "approved",
      currentPublishedAt: APPROVED_AT,
      decision: "removed",
      decidedBy: "mod-humano-1",
      reasonCode: "illegal_content",
      now: NOW,
    });
    expect(result.ok && result.value.changes.status).toBe("removed");
    expect(result.ok && result.value.changes.publishedAt).toBeNull();
    expect(result.ok && result.value.reasonCode).toBe("illegal_content");
  });

  it("(5) decidir o estado atual e noop e PRESERVA publishedAt", () => {
    const result = planModeration({
      currentStatus: "approved",
      currentPublishedAt: APPROVED_AT,
      decision: "approved",
      decidedBy: "mod-humano-1",
      now: NOW,
    });
    expect(result.ok && result.value.kind).toBe("noop");
    expect(result.ok && result.value.changes.publishedAt).toBe(APPROVED_AT);
  });

  it("(6) transicao invalida produz conflict (nunca escondida)", () => {
    const result = planModeration({
      currentStatus: "approved",
      currentPublishedAt: APPROVED_AT,
      decision: "pending",
      decidedBy: "mod-humano-1",
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("conflict");
  });

  it("(7) removed e rejected nao voltam a approved sem transicao valida (conflict)", () => {
    expect(
      planModeration({
        currentStatus: "removed",
        currentPublishedAt: null,
        decision: "approved",
        decidedBy: "m",
        now: NOW,
      }).ok,
    ).toBe(false);
    expect(
      planModeration({
        currentStatus: "rejected",
        currentPublishedAt: null,
        decision: "approved",
        decidedBy: "m",
        now: NOW,
      }).ok,
    ).toBe(false);
  });

  it("(8) exige revisor humano identificado (decidedBy nao-vazio)", () => {
    const result = planModeration({
      currentStatus: "pending",
      currentPublishedAt: null,
      decision: "approved",
      decidedBy: "   ",
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_failed");
  });

  it("(9) reasonCode fora do enum e nota interna longa sao rejeitados", () => {
    expect(
      planModeration({
        currentStatus: "pending",
        currentPublishedAt: null,
        decision: "rejected",
        decidedBy: "m",
        reasonCode: "nao_existe" as never,
        now: NOW,
      }).ok,
    ).toBe(false);
    expect(
      planModeration({
        currentStatus: "pending",
        currentPublishedAt: null,
        decision: "rejected",
        decidedBy: "m",
        moderationNote: "x".repeat(MODERATION_NOTE_MAX_LENGTH + 1),
        now: NOW,
      }).ok,
    ).toBe(false);
  });
});

describe("applyModerationDecision", () => {
  it("(10) aprovar seta publishedAt=now; reprovar mantem null", () => {
    const approved = applyModerationDecision({
      current: "pending",
      decision: "approved",
      decidedBy: "m",
      now: NOW,
    });
    expect(approved.ok && approved.value.publishedAt).toBe(NOW);
    const rejected = applyModerationDecision({
      current: "pending",
      decision: "rejected",
      decidedBy: "m",
      now: NOW,
    });
    expect(rejected.ok && rejected.value.publishedAt).toBeNull();
  });
});

describe("validateReport", () => {
  it("(11) aceita reason canonica; rejeita reason fora do enum", () => {
    expect(validateReport({ reason: "spam" }).ok).toBe(true);
    expect(validateReport({ reason: "spoiler_unflagged" }).ok).toBe(true);
    expect(validateReport({ reason: "inventada" }).ok).toBe(false);
  });

  it("(12) rejeita detail acima do limite", () => {
    expect(validateReport({ reason: "other", detail: "x".repeat(2001) }).ok).toBe(false);
  });
});

describe("resolveReport", () => {
  it("(13) resolve open -> reviewed com resolvedBy humano", () => {
    const result = resolveReport({
      current: "open",
      resolution: "reviewed",
      resolvedBy: "mod-1",
      now: NOW,
    });
    expect(result.ok && result.value.status).toBe("reviewed");
    expect(result.ok && result.value.resolvedAt).toBe(NOW);
  });

  it("(14) denuncia ja resolvida nao reabre (conflict); resolvedBy vazio falha", () => {
    expect(
      resolveReport({ current: "reviewed", resolution: "dismissed", resolvedBy: "m", now: NOW }).ok,
    ).toBe(false);
    expect(
      resolveReport({ current: "open", resolution: "reviewed", resolvedBy: "  ", now: NOW }).ok,
    ).toBe(false);
  });
});

describe("validateBlock", () => {
  it("(15) proibe auto-bloqueio e ids nao positivos; aceita bloqueio valido", () => {
    expect(validateBlock({ blockerId: 5n, blockedId: 5n }).ok).toBe(false);
    expect(validateBlock({ blockerId: 0n, blockedId: 5n }).ok).toBe(false);
    expect(validateBlock({ blockerId: 5n, blockedId: 9n }).ok).toBe(true);
  });
});
