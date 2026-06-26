/**
 * Testes da orquestracao pura `runGeneration` (sem rede, sem Prisma, sem Gemini
 * real). Usa FakeGeminiPort e stubs de GeminiPort/selectPrompt em memoria.
 */

import { describe, expect, it } from "vitest";
import type { EntityPayload } from "@screena/schemas";
import { FakeGeminiPort } from "../gemini/fake.js";
import { EMPTY_OUTPUT_WARNING } from "../pipeline/decide-status.js";
import { runGeneration, type RunGenerationInput } from "../pipeline/run-generation.js";
import type { GeminiGenerateInput, GeminiGenerateOutput, GeminiPort } from "../ports.js";
import type { SelectedPrompt } from "../prompt/select-prompt.js";

const payload: EntityPayload = {
  director: "Denis Villeneuve",
  cast: ["Timothee Chalamet", "Rebecca Ferguson"],
};

/** Campos que o schema real de entity_writer_logs aceita (EntityWriterLogInput). */
const ALLOWED_LOG_KEYS = new Set([
  "jobId",
  "entityType",
  "entityId",
  "languageCode",
  "modelProvider",
  "modelName",
  "promptVersion",
  "inputHash",
  "outputHash",
  "tokenInput",
  "tokenOutput",
  "validationStatus",
  "warnings",
  "errorMessage",
]);

const FORBIDDEN_LOG_KEYS = ["step", "status", "latency_ms", "block_type"];

/** GeminiPort em memoria que devolve um `raw` fixo. */
function stubGemini(raw: string): GeminiPort {
  return {
    generate(_input: GeminiGenerateInput): Promise<GeminiGenerateOutput> {
      return Promise.resolve({
        raw,
        modelProvider: "fake",
        modelName: "fake-1",
        tokenInput: 7,
        tokenOutput: raw.length,
      });
    },
  };
}

/** selectPrompt injetavel (evita IO em testes que nao verificam a versao real). */
function stubPrompt(promptVersion = "0.2.0"): () => SelectedPrompt {
  return () => ({ promptVersion, content: "PROMPT DE TESTE" });
}

function baseInput(overrides: Partial<RunGenerationInput>): RunGenerationInput {
  return {
    entityType: "movie",
    entityId: "mv_1",
    languageCode: "pt-BR",
    payload,
    gemini: new FakeGeminiPort({ mode: "success" }),
    jobId: "job_1",
    ...overrides,
  };
}

describe("runGeneration", () => {
  it("sucesso (FakeGeminiPort) gera candidatos para editorial_intro e cast_intro", async () => {
    const outcome = await runGeneration(baseInput({ selectPrompt: stubPrompt() }));

    const types = outcome.blockCandidates.map((c) => c.blockType);
    expect(types).toContain("editorial_intro");
    expect(types).toContain("cast_intro");
    expect(outcome.blockCandidates).toHaveLength(2);
    for (const candidate of outcome.blockCandidates) {
      expect(candidate.reviewStatus).toBe("ai_generated");
      expect(candidate.content.length).toBeGreaterThan(0);
    }
  });

  it("sucesso retorna GenerationResult ai_generated/passed com hashes preenchidos", async () => {
    const outcome = await runGeneration(baseInput({ selectPrompt: stubPrompt() }));

    expect(outcome.result.reviewStatus).toBe("ai_generated");
    expect(outcome.result.validationStatus).toBe("passed");
    expect(outcome.result.provenance.inputHash).toHaveLength(64);
    expect(outcome.result.provenance.outputHash).toHaveLength(64);
    expect(outcome.result.provenance.inputHash).not.toBe(outcome.result.provenance.outputHash);
  });

  it("promptVersion vem de prompts/entity_intro_pt.md quando selectPrompt nao e injetado", async () => {
    const outcome = await runGeneration(baseInput({}));
    expect(outcome.result.provenance.promptVersion).toBe("0.2.0");
    expect(outcome.logCandidate.promptVersion).toBe("0.2.0");
  });

  it("warning anti-alucinacao -> needs_review, com candidato e warnings propagados", async () => {
    const raw = JSON.stringify({
      cast_intro: "No elenco, Timothee Chalamet, Rebecca Ferguson e Zendaya aparecem.",
      warnings: [],
    });
    const outcome = await runGeneration(
      baseInput({ gemini: stubGemini(raw), selectPrompt: stubPrompt() }),
    );

    expect(outcome.result.reviewStatus).toBe("needs_review");
    expect(outcome.result.validationStatus).toBe("warnings");
    expect(outcome.result.warnings).toContain("fato fora do payload: Zendaya");
    expect(outcome.blockCandidates).toHaveLength(1);
    expect(outcome.blockCandidates[0]?.blockType).toBe("cast_intro");
    expect(outcome.blockCandidates[0]?.reviewStatus).toBe("needs_review");
    expect(outcome.blockCandidates[0]?.warnings).toContain("fato fora do payload: Zendaya");
    expect(outcome.logCandidate.warnings).toContain("fato fora do payload: Zendaya");
  });

  it("saida vazia -> blocked, sem candidatos, log com aviso e sem errorMessage", async () => {
    const outcome = await runGeneration(
      baseInput({ gemini: new FakeGeminiPort({ mode: "empty" }), selectPrompt: stubPrompt() }),
    );

    expect(outcome.result.reviewStatus).toBe("blocked");
    expect(outcome.result.validationStatus).toBe("failed");
    expect(outcome.blockCandidates).toEqual([]);
    expect(outcome.result.warnings).toContain(EMPTY_OUTPUT_WARNING);
    expect(outcome.logCandidate.warnings).toContain(EMPTY_OUTPUT_WARNING);
    expect(outcome.logCandidate.errorMessage).toBeUndefined();
  });

  it("JSON invalido -> blocked/failed com errorMessage e sem candidatos", async () => {
    const outcome = await runGeneration(
      baseInput({
        gemini: new FakeGeminiPort({ mode: "invalid-json" }),
        selectPrompt: stubPrompt(),
      }),
    );

    expect(outcome.result.reviewStatus).toBe("blocked");
    expect(outcome.result.validationStatus).toBe("failed");
    expect(outcome.blockCandidates).toEqual([]);
    expect(outcome.logCandidate.validationStatus).toBe("failed");
    expect(outcome.logCandidate.errorMessage).toBeDefined();
    expect(outcome.logCandidate.errorMessage).toContain("JSON invalido");
    // provenance ainda rastreia a tentativa (modelo respondeu; o raw e que falhou).
    expect(outcome.result.provenance.inputHash).toHaveLength(64);
    expect(outcome.result.provenance.outputHash).toHaveLength(64);
  });

  it("logCandidate usa apenas campos compativeis com o schema real", async () => {
    const outcome = await runGeneration(baseInput({ selectPrompt: stubPrompt() }));
    for (const key of Object.keys(outcome.logCandidate)) {
      expect(ALLOWED_LOG_KEYS.has(key)).toBe(true);
    }
    for (const forbidden of FORBIDDEN_LOG_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(outcome.logCandidate, forbidden)).toBe(false);
    }
  });

  it("nunca retorna published nem human_reviewed (todos os cenarios)", async () => {
    const halluc = JSON.stringify({ cast_intro: "Com Zendaya em cena.", warnings: [] });
    const outcomes = [
      await runGeneration(baseInput({ selectPrompt: stubPrompt() })),
      await runGeneration(
        baseInput({ gemini: stubGemini(halluc), selectPrompt: stubPrompt() }),
      ),
      await runGeneration(
        baseInput({ gemini: new FakeGeminiPort({ mode: "empty" }), selectPrompt: stubPrompt() }),
      ),
      await runGeneration(
        baseInput({
          gemini: new FakeGeminiPort({ mode: "invalid-json" }),
          selectPrompt: stubPrompt(),
        }),
      ),
    ];
    for (const outcome of outcomes) {
      expect(outcome.result.reviewStatus).not.toBe("published");
      expect(outcome.result.reviewStatus).not.toBe("human_reviewed");
      expect(["ai_generated", "needs_review", "blocked"]).toContain(outcome.result.reviewStatus);
      for (const candidate of outcome.blockCandidates) {
        expect(candidate.reviewStatus).not.toBe("published");
        expect(candidate.reviewStatus).not.toBe("human_reviewed");
      }
    }
  });
});
