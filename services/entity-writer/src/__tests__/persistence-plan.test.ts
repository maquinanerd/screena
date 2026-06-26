/**
 * Testes da logica PURA de persistencia (archive + insert, mapeamento de
 * colunas reais, finalizacao de job). Sem Prisma, sem banco, sem rede.
 */

import { describe, expect, it } from "vitest";
import type { ContentBlockRecord, EntityWriterLogInput, JobCompletionInput } from "../ports.js";
import type { GenerationProvenance } from "../types.js";
import {
  planBlockPersistence,
  planJobUpdate,
  planLog,
  type ExistingBlock,
} from "../pipeline/persistence-plan.js";

const provenance: GenerationProvenance = {
  promptVersion: "0.2.0",
  modelProvider: "fake",
  modelName: "fake-1",
  inputHash: "a".repeat(64),
  outputHash: "b".repeat(64),
};

const candidate: ContentBlockRecord = {
  entityType: "movie",
  entityId: "10",
  languageCode: "pt-BR",
  blockType: "editorial_intro",
  content: "Introducao editorial.",
  reviewStatus: "ai_generated",
  provenance,
  warnings: [],
};

/** Colunas reais de entity_writer_logs (chaves do create-data do planner). */
const REAL_LOG_KEYS = new Set([
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

describe("planBlockPersistence (archive + insert)", () => {
  it("mapeia o record para colunas reais com source_type=ai", () => {
    const { create } = planBlockPersistence([], candidate);
    expect(create.sourceType).toBe("ai");
    expect(create.blockType).toBe("editorial_intro");
    expect(create.modelProvider).toBe("fake");
    expect(create.promptVersion).toBe("0.2.0");
    expect(create.inputHash).toHaveLength(64);
    expect(create.outputHash).toHaveLength(64);
    expect(create.reviewStatus).toBe("ai_generated");
  });

  it("sem versao anterior: nada a arquivar", () => {
    expect(planBlockPersistence([], candidate).archiveBlockIds).toEqual([]);
  });

  it("arquiva versoes ATIVAS de IA (ai_generated/needs_review) do mesmo alvo", () => {
    const existing: ExistingBlock[] = [
      { id: "1", reviewStatus: "ai_generated" },
      { id: "2", reviewStatus: "needs_review" },
    ];
    expect(planBlockPersistence(existing, candidate).archiveBlockIds).toEqual(["1", "2"]);
  });

  it("NUNCA arquiva versao human_reviewed/published/blocked/archived (decisao humana)", () => {
    const existing: ExistingBlock[] = [
      { id: "3", reviewStatus: "human_reviewed" },
      { id: "4", reviewStatus: "published" },
      { id: "5", reviewStatus: "blocked" },
      { id: "6", reviewStatus: "archived" },
    ];
    expect(planBlockPersistence(existing, candidate).archiveBlockIds).toEqual([]);
  });

  it("insere needs_review quando o candidato vem com warnings", () => {
    const flagged: ContentBlockRecord = {
      ...candidate,
      reviewStatus: "needs_review",
      warnings: ["fato fora do payload: Zendaya"],
    };
    const { create } = planBlockPersistence([], flagged);
    expect(create.reviewStatus).toBe("needs_review");
    expect(create.warnings).toContain("fato fora do payload: Zendaya");
  });

  it("rejeita persistir published/human_reviewed (defesa em profundidade)", () => {
    const illegal = { ...candidate, reviewStatus: "published" } as unknown as ContentBlockRecord;
    expect(() => planBlockPersistence([], illegal)).toThrow();
  });
});

describe("planLog", () => {
  it("usa apenas colunas reais; sem step/status/latency_ms/block_type", () => {
    const input: EntityWriterLogInput = {
      jobId: "7",
      entityType: "movie",
      entityId: "10",
      languageCode: "pt-BR",
      validationStatus: "warnings",
      warnings: ["x"],
    };
    const data = planLog(input);
    for (const key of Object.keys(data)) {
      expect(REAL_LOG_KEYS.has(key)).toBe(true);
    }
    for (const forbidden of ["step", "status", "latency_ms", "block_type"]) {
      expect(Object.prototype.hasOwnProperty.call(data, forbidden)).toBe(false);
    }
  });

  it("normaliza opcionais ausentes para null", () => {
    const data = planLog({
      jobId: "7",
      entityType: "tv",
      entityId: "11",
      languageCode: "pt-BR",
    });
    expect(data.modelProvider).toBeNull();
    expect(data.outputHash).toBeNull();
    expect(data.errorMessage).toBeNull();
    expect(data.warnings).toEqual([]);
  });
});

describe("planJobUpdate", () => {
  it("completed e terminal (carimba completed_at) e leva result_block_id", () => {
    const input: JobCompletionInput = { jobId: "7", status: "completed", resultBlockId: "99" };
    const data = planJobUpdate(input);
    expect(data.status).toBe("completed");
    expect(data.setCompletedAt).toBe(true);
    expect(data.resultBlockId).toBe("99");
    expect(data.lastError).toBeNull();
  });

  it("blocked e terminal e leva last_error", () => {
    const data = planJobUpdate({ jobId: "7", status: "blocked", lastError: "saida vazia" });
    expect(data.setCompletedAt).toBe(true);
    expect(data.lastError).toBe("saida vazia");
    expect(data.resultBlockId).toBeNull();
  });

  it("failed NAO e terminal (retentavel): nao carimba completed_at", () => {
    const data = planJobUpdate({ jobId: "7", status: "failed", lastError: "timeout" });
    expect(data.setCompletedAt).toBe(false);
    expect(data.lastError).toBe("timeout");
  });
});
