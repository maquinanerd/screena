/**
 * enqueue-plan.test.ts — Testes PUROS do planner de enqueue (Fase 3B.4).
 *
 * Zero IO, zero banco, zero Gemini. Cobre as regras de decisao: criar quando
 * faltam blocos, nao duplicar job ativo, pular quando atualizado, `force`,
 * en/es e entityType nao suportados, e selecao de generate vs regenerate.
 */

import { describe, expect, it } from "vitest";
import {
  ENQUEUE_TARGET_BLOCK_TYPES,
  planEnqueue,
  type EnqueuePlanInput,
} from "../runner/enqueue-plan.js";
import type { ExistingBlockRef } from "../ports.js";

/** Bloco existente de referencia (editorial_intro ai_generated, h1/v1). */
function block(overrides: Partial<ExistingBlockRef> = {}): ExistingBlockRef {
  return {
    blockType: "editorial_intro",
    reviewStatus: "ai_generated",
    inputHash: "h1",
    promptVersion: "v1",
    ...overrides,
  };
}

/** Conjunto de blocos "atualizados" para todos os tipos-alvo (h1/v1). */
function upToDateBlocks(): ExistingBlockRef[] {
  return ENQUEUE_TARGET_BLOCK_TYPES.map((blockType) =>
    block({ blockType, inputHash: "h1", promptVersion: "v1" }),
  );
}

/** Entrada base: movie, pt-BR, prompt v1, payload hash h1. */
function input(overrides: Partial<EnqueuePlanInput> = {}): EnqueuePlanInput {
  return {
    entityType: "movie",
    languageCode: "pt-BR",
    promptVersion: "v1",
    inputHash: "h1",
    existingBlocks: [],
    hasActiveJob: false,
    force: false,
    ...overrides,
  };
}

describe("planEnqueue", () => {
  it("cria generate_block quando nao ha blocos nem job ativo", () => {
    const plan = planEnqueue(input());
    expect(plan).toEqual({ action: "create", jobType: "generate_block", reason: "missing_blocks" });
  });

  it("cria job quando faltam blocos parcialmente (so editorial_intro presente)", () => {
    const plan = planEnqueue(input({ existingBlocks: [block({ blockType: "editorial_intro" })] }));
    // Ha bloco vivo do alvo -> regeneracao; cast_intro ainda falta -> missing_blocks.
    expect(plan).toEqual({ action: "create", jobType: "regenerate_block", reason: "missing_blocks" });
  });

  it("nao cria job quando ja existe job ativo (mesmo sem blocos)", () => {
    const plan = planEnqueue(input({ hasActiveJob: true }));
    expect(plan).toEqual({ action: "skip", reason: "existing_active_job" });
  });

  it("nao cria job quando os blocos estao atualizados (mesmo input/prompt)", () => {
    const plan = planEnqueue(input({ existingBlocks: upToDateBlocks() }));
    expect(plan).toEqual({ action: "skip", reason: "up_to_date" });
  });

  it("force cria regenerate_block quando atualizado e sem job ativo", () => {
    const plan = planEnqueue(input({ existingBlocks: upToDateBlocks(), force: true }));
    expect(plan).toEqual({ action: "create", jobType: "regenerate_block", reason: "forced" });
  });

  it("force NAO duplica job ativo (job ativo vence o force)", () => {
    const plan = planEnqueue(input({ existingBlocks: upToDateBlocks(), force: true, hasActiveJob: true }));
    expect(plan).toEqual({ action: "skip", reason: "existing_active_job" });
  });

  it("bloqueia en e es (unsupported_language)", () => {
    expect(planEnqueue(input({ languageCode: "en" }))).toEqual({
      action: "skip",
      reason: "unsupported_language",
    });
    expect(planEnqueue(input({ languageCode: "es" }))).toEqual({
      action: "skip",
      reason: "unsupported_language",
    });
  });

  it("bloqueia entityType nao suportado (person, season)", () => {
    expect(planEnqueue(input({ entityType: "person" }))).toEqual({
      action: "skip",
      reason: "unsupported_entity",
    });
    expect(planEnqueue(input({ entityType: "season" }))).toEqual({
      action: "skip",
      reason: "unsupported_entity",
    });
  });

  it("trata bloco com inputHash diferente como desatualizado (cria job)", () => {
    const blocks = upToDateBlocks().map((b) => ({ ...b, inputHash: "OUTRO" }));
    const plan = planEnqueue(input({ existingBlocks: blocks }));
    expect(plan.action).toBe("create");
  });

  it("trata bloco com promptVersion diferente como desatualizado (cria job)", () => {
    const blocks = upToDateBlocks().map((b) => ({ ...b, promptVersion: "v0" }));
    const plan = planEnqueue(input({ existingBlocks: blocks }));
    expect(plan.action).toBe("create");
  });

  it("ignora blocos arquivados (nao contam como atuais nem como vivos)", () => {
    const blocks = upToDateBlocks().map((b) => ({ ...b, reviewStatus: "archived" }));
    const plan = planEnqueue(input({ existingBlocks: blocks }));
    // Nenhum bloco vivo -> generate_block, e nao up_to_date -> cria.
    expect(plan).toEqual({ action: "create", jobType: "generate_block", reason: "missing_blocks" });
  });

  it("nunca decide published/human_reviewed e so usa job_type generate/regenerate", () => {
    const scenarios: EnqueuePlanInput[] = [
      input(),
      input({ existingBlocks: [block()] }),
      input({ existingBlocks: upToDateBlocks(), force: true }),
    ];
    for (const scenario of scenarios) {
      const plan = planEnqueue(scenario);
      const serialized = JSON.stringify(plan);
      expect(serialized).not.toContain("published");
      expect(serialized).not.toContain("human_reviewed");
      if (plan.action === "create") {
        expect(["generate_block", "regenerate_block"]).toContain(plan.jobType);
      }
    }
  });
});
