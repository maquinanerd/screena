/**
 * enqueue-missing.test.ts — Testes do orquestrador de enqueue em LOTE (Fase 3B.5).
 *
 * Usa apenas fakes em memoria: zero rede, zero banco, zero Gemini (o enqueue em
 * lote nem tem GeminiPort nas deps). Cobre create de faltantes, limite de jobs
 * criados, dry-run sem escrita, skips (job ativo / up-to-date), cursor
 * determinístico, teto de avaliacao e guarda de tipo nao suportado.
 */

import { describe, expect, it } from "vitest";
import { enqueueMissing } from "../runner/enqueue-jobs.js";
import { hashPayload } from "../utils/hash.js";
import { ENQUEUE_TARGET_BLOCK_TYPES } from "../runner/enqueue-plan.js";
import type {
  EnqueueCandidateQuery,
  EnqueueCandidateSourcePort,
  EnqueueJobInput,
  EnqueueReadPort,
  ExistingBlockRef,
  JobEnqueuePort,
  PayloadSourcePort,
} from "../ports.js";
import type { EntityPayload } from "../types.js";

const PAYLOAD: EntityPayload = {
  entityType: "movie",
  director: "Jane Doe",
  cast: ["Ana Lima", "Beto Souza"],
  title: "Filme X",
};

const PROMPT_VERSION = "v-test";
const selectPrompt = () => ({ promptVersion: PROMPT_VERSION, content: "PROMPT" });

const MOVIE_REQ = { entityType: "movie" as const, languageCode: "pt-BR" };

function okPayloadSource(payload: EntityPayload = PAYLOAD): PayloadSourcePort {
  return { buildPayload: async () => payload };
}

function fakeRead(blocks: readonly ExistingBlockRef[] = [], hasActiveJob = false): EnqueueReadPort {
  return {
    findActiveBlocks: async () => blocks,
    hasActiveJob: async () => hasActiveJob,
  };
}

/** Enqueue que devolve ids de job sequenciais e registra as chamadas. */
function countingEnqueue(start = 100) {
  let n = start;
  const calls: EnqueueJobInput[] = [];
  const port: JobEnqueuePort = {
    createJob: async (input) => {
      calls.push(input);
      const jobId = String(n);
      n += 1;
      return { created: true, jobId };
    },
  };
  return { port, calls };
}

/** Enqueue que falha se chamado — prova que nenhum job foi criado. */
function forbiddenEnqueue(): JobEnqueuePort {
  return {
    createJob: async () => {
      throw new Error("createJob NAO deveria ter sido chamado");
    },
  };
}

/** Descoberta fake com paginacao por cursor (id ASC) e registro das chamadas. */
function fakeCandidates(allIds: readonly string[]) {
  const calls: Pick<EnqueueCandidateQuery, "afterId" | "limit" | "entityType">[] = [];
  const port: EnqueueCandidateSourcePort = {
    findCandidates: async (query) => {
      calls.push({ afterId: query.afterId, limit: query.limit, entityType: query.entityType });
      const startIndex = query.afterId === undefined ? 0 : allIds.indexOf(query.afterId) + 1;
      return allIds.slice(startIndex, startIndex + query.limit);
    },
  };
  return { port, calls };
}

/** Descoberta que falha se chamada — prova que a guarda curto-circuitou. */
function forbiddenCandidates(): EnqueueCandidateSourcePort {
  return {
    findCandidates: async () => {
      throw new Error("findCandidates NAO deveria ter sido chamado");
    },
  };
}

/** Blocos atualizados para todos os tipos-alvo, no hash/prompt correntes. */
function upToDateBlocks(): ExistingBlockRef[] {
  return ENQUEUE_TARGET_BLOCK_TYPES.map((blockType) => ({
    blockType,
    reviewStatus: "ai_generated",
    inputHash: hashPayload(PAYLOAD),
    promptVersion: PROMPT_VERSION,
  }));
}

describe("enqueueMissing", () => {
  it("cria jobs para todos os faltantes (sem job ativo, sem blocos)", async () => {
    const candidates = fakeCandidates(["1", "2", "3"]);
    const enqueue = countingEnqueue();
    const summary = await enqueueMissing(
      { payloadSource: okPayloadSource(), read: fakeRead(), enqueue: enqueue.port, candidates: candidates.port, selectPrompt },
      { dryRun: false, limit: 50 },
      MOVIE_REQ,
    );

    expect(summary.created).toBe(3);
    expect(summary.evaluated).toBe(3);
    expect(summary.exhausted).toBe(true);
    expect(summary.createdJobIds).toEqual(["100", "101", "102"]);
    expect(enqueue.calls.map((c) => c.entityId)).toEqual(["1", "2", "3"]);
    expect(enqueue.calls.every((c) => c.jobType === "generate_block")).toBe(true);
  });

  it("respeita o limit de jobs criados (para antes de esgotar candidatos)", async () => {
    const candidates = fakeCandidates(["1", "2", "3", "4", "5", "6"]);
    const enqueue = countingEnqueue();
    const summary = await enqueueMissing(
      { payloadSource: okPayloadSource(), read: fakeRead(), enqueue: enqueue.port, candidates: candidates.port, selectPrompt },
      { dryRun: false, limit: 2 },
      MOVIE_REQ,
    );

    expect(summary.created).toBe(2);
    expect(summary.evaluated).toBe(2);
    expect(summary.exhausted).toBe(false);
    expect(summary.createdJobIds).toEqual(["100", "101"]);
  });

  it("dry-run NAO cria job (createJob nunca chamado), mas conta o que criaria", async () => {
    const candidates = fakeCandidates(["1", "2", "3"]);
    const summary = await enqueueMissing(
      { payloadSource: okPayloadSource(), read: fakeRead(), enqueue: forbiddenEnqueue(), candidates: candidates.port, selectPrompt },
      { dryRun: true, limit: 50 },
      MOVIE_REQ,
    );

    expect(summary.dryRun).toBe(true);
    expect(summary.created).toBe(3);
    expect(summary.createdJobIds).toEqual([]);
  });

  it("pula entidades com job ativo (nenhum job criado)", async () => {
    const candidates = fakeCandidates(["1", "2", "3"]);
    const summary = await enqueueMissing(
      { payloadSource: okPayloadSource(), read: fakeRead([], true), enqueue: forbiddenEnqueue(), candidates: candidates.port, selectPrompt },
      { dryRun: false, limit: 50 },
      MOVIE_REQ,
    );

    expect(summary.created).toBe(0);
    expect(summary.skippedExistingActiveJob).toBe(3);
    expect(summary.exhausted).toBe(true);
  });

  it("pula entidades up-to-date (nenhum job criado)", async () => {
    const candidates = fakeCandidates(["1", "2", "3"]);
    const summary = await enqueueMissing(
      { payloadSource: okPayloadSource(), read: fakeRead(upToDateBlocks(), false), enqueue: forbiddenEnqueue(), candidates: candidates.port, selectPrompt },
      { dryRun: false, limit: 50 },
      MOVIE_REQ,
    );

    expect(summary.created).toBe(0);
    expect(summary.skippedUpToDate).toBe(3);
  });

  it("varre por cursor determinístico (id ASC) avancando afterId", async () => {
    const candidates = fakeCandidates(["1", "2", "3", "4"]);
    const summary = await enqueueMissing(
      { payloadSource: okPayloadSource(), read: fakeRead([], true), enqueue: forbiddenEnqueue(), candidates: candidates.port, selectPrompt },
      { dryRun: false, limit: 2 },
      MOVIE_REQ,
    );

    expect(summary.evaluated).toBe(4);
    expect(summary.exhausted).toBe(true);
    expect(candidates.calls.map((c) => c.afterId)).toEqual([undefined, "2", "4"]);
  });

  it("respeita o teto de candidatos avaliados (maxEvaluated)", async () => {
    const candidates = fakeCandidates(["1", "2", "3", "4", "5", "6"]);
    const summary = await enqueueMissing(
      { payloadSource: okPayloadSource(), read: fakeRead([], true), enqueue: forbiddenEnqueue(), candidates: candidates.port, selectPrompt },
      { dryRun: false, limit: 2, maxEvaluated: 3 },
      MOVIE_REQ,
    );

    expect(summary.evaluated).toBe(3);
    expect(summary.hitEvaluationCap).toBe(true);
    expect(summary.created).toBe(0);
  });

  it("entityType nao suportado (person) => guarda; descoberta NUNCA e chamada", async () => {
    const summary = await enqueueMissing(
      { payloadSource: okPayloadSource(), read: fakeRead(), enqueue: forbiddenEnqueue(), candidates: forbiddenCandidates(), selectPrompt },
      { dryRun: false, limit: 10 },
      { entityType: "person", languageCode: "pt-BR" },
    );

    expect(summary.created).toBe(0);
    expect(summary.evaluated).toBe(0);
  });

  it("resumo nunca menciona published/human_reviewed", async () => {
    const candidates = fakeCandidates(["1", "2"]);
    const summary = await enqueueMissing(
      { payloadSource: okPayloadSource(), read: fakeRead(), enqueue: countingEnqueue().port, candidates: candidates.port, selectPrompt },
      { dryRun: false, limit: 50 },
      MOVIE_REQ,
    );
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("published");
    expect(serialized).not.toContain("human_reviewed");
  });
});
