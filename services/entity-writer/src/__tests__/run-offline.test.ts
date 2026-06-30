/**
 * run-offline.test.ts — Testes da orquestracao do ciclo offline encadeado.
 *
 * 100% fakes em memoria: zero rede, zero banco, zero Gemini real. Uma fila de
 * jobs em memoria liga o enqueue (createJob) ao runner (claimNext), provando que
 * o ciclo enqueue -> runner funciona ponta a ponta, que `--dry-run` nada escreve
 * e que `limit` limita tanto a criacao quanto o processamento. Nunca publica.
 */

import { describe, expect, it } from "vitest";
import type { EntityPayload } from "@screena/schemas";
import { FakeGeminiPort } from "../gemini/fake.js";
import { runOffline, type RunOfflineDeps } from "../runner/run-offline.js";
import type {
  ContentBlockRecord,
  ContentBlockStorePort,
  EnqueueCandidateSourcePort,
  EnqueueReadPort,
  EntityWriterJobStorePort,
  EntityWriterLogInput,
  EntityWriterLogPort,
  JobClaimPort,
  JobCompletionInput,
  JobEnqueuePort,
  PayloadSourcePort,
} from "../ports.js";
import type { EntityType } from "../types.js";

const PAYLOAD: EntityPayload = {
  entityType: "movie",
  director: "Ana Lima",
  cast: ["Carlos Souza", "Bruna Dias"],
  title: "Filme de Teste",
};
const selectPrompt = () => ({ promptVersion: "0.2.0", content: "PROMPT" });
const MOVIE_REQ = { entityType: "movie" as const, languageCode: "pt-BR" };

function okPayloadSource(): PayloadSourcePort {
  return { buildPayload: async () => PAYLOAD };
}

function fakeRead(): EnqueueReadPort {
  return { findActiveBlocks: async () => [], hasActiveJob: async () => false };
}

function fakeCandidates(allIds: readonly string[]): EnqueueCandidateSourcePort {
  return {
    findCandidates: async (query) => {
      const start = query.afterId === undefined ? 0 : allIds.indexOf(query.afterId) + 1;
      return allIds.slice(start, start + query.limit);
    },
  };
}

/** Fila de jobs em memoria: liga createJob (enqueue) a claimNext (runner). */
function memoryJobQueue() {
  interface QJob {
    id: string;
    entityType: EntityType;
    entityId: string;
    languageCode: string;
  }
  const queued: QJob[] = [];
  const claimedIds: string[] = [];
  let seq = 1000;

  const enqueue: JobEnqueuePort = {
    createJob: async (input) => {
      const id = String(seq);
      seq += 1;
      queued.push({ id, entityType: input.entityType, entityId: input.entityId, languageCode: input.languageCode });
      return { created: true, jobId: id };
    },
  };
  const claim: JobClaimPort = {
    claimNext: async (opts) => {
      const match = (job: QJob) => opts.languageCode === undefined || job.languageCode === opts.languageCode;
      if (opts.dryRun) {
        const peek = queued.find(match);
        return peek ? { id: peek.id, entityType: peek.entityType, entityId: peek.entityId, languageCode: peek.languageCode } : null;
      }
      const idx = queued.findIndex(match);
      if (idx === -1) return null;
      const [job] = queued.splice(idx, 1);
      if (job === undefined) return null;
      claimedIds.push(job.id);
      return { id: job.id, entityType: job.entityType, entityId: job.entityId, languageCode: job.languageCode };
    },
  };
  return { enqueue, claim, queued, claimedIds };
}

function recordingContentBlocks() {
  const saved: ContentBlockRecord[] = [];
  let nextId = 500;
  const port: ContentBlockStorePort = {
    save: async (record) => {
      saved.push(record);
      const blockId = String(nextId);
      nextId += 1;
      return { blockId };
    },
  };
  return { port, saved };
}

function recordingLogs() {
  const written: EntityWriterLogInput[] = [];
  const port: EntityWriterLogPort = { write: async (input) => void written.push(input) };
  return { port, written };
}

function recordingJobStore() {
  const finished: JobCompletionInput[] = [];
  const port: EntityWriterJobStorePort = { finishJob: async (input) => void finished.push(input) };
  return { port, finished };
}

function buildDeps(candidateIds: readonly string[], dryRunGemini = new FakeGeminiPort({ mode: "success" })) {
  const memory = memoryJobQueue();
  const blocks = recordingContentBlocks();
  const logs = recordingLogs();
  const jobs = recordingJobStore();
  const deps: RunOfflineDeps = {
    payloadSource: okPayloadSource(),
    read: fakeRead(),
    enqueue: memory.enqueue,
    candidates: fakeCandidates(candidateIds),
    claim: memory.claim,
    gemini: dryRunGemini,
    contentBlocks: blocks.port,
    logs: logs.port,
    jobs: jobs.port,
    selectPrompt,
  };
  return { deps, memory, blocks, logs, jobs };
}

describe("runOffline", () => {
  it("encadeia enqueue -> runner: cria e processa os faltantes", async () => {
    const { deps, memory, blocks, logs, jobs } = buildDeps(["1", "2"]);
    const summary = await runOffline(deps, { dryRun: false, limit: 5 }, MOVIE_REQ);

    expect(summary.enqueue.created).toBe(2);
    expect(summary.run.claimed).toBe(2);
    expect(summary.run.persisted).toBe(2);
    expect(memory.claimedIds).toHaveLength(2);
    expect(memory.queued).toHaveLength(0); // fila esvaziada pelo runner

    // 2 blocos por job (editorial_intro + cast_intro), todos ai_generated.
    expect(blocks.saved).toHaveLength(4);
    expect(blocks.saved.every((b) => b.reviewStatus === "ai_generated")).toBe(true);
    expect(logs.written).toHaveLength(2);
    expect(jobs.finished.every((j) => j.status === "completed")).toBe(true);

    // Nunca publica.
    const serialized = JSON.stringify(summary) + JSON.stringify(blocks.saved) + JSON.stringify(jobs.finished);
    expect(serialized).not.toContain("published");
    expect(serialized).not.toContain("human_reviewed");
  });

  it("dry-run NAO escreve: enqueue conta o que criaria; runner so faz peek", async () => {
    const { deps, memory, blocks, logs, jobs } = buildDeps(["1", "2"]);
    const summary = await runOffline(deps, { dryRun: true, limit: 5 }, MOVIE_REQ);

    expect(summary.dryRun).toBe(true);
    expect(summary.enqueue.created).toBe(2); // "criaria" 2
    expect(summary.enqueue.createdJobIds).toEqual([]); // mas nao persistiu nenhum
    expect(memory.queued).toHaveLength(0); // createJob nunca chamado
    expect(summary.run.claimed).toBe(0); // peek em fila vazia
    expect(blocks.saved).toHaveLength(0);
    expect(logs.written).toHaveLength(0);
    expect(jobs.finished).toHaveLength(0);
  });

  it("respeita limit: cria e processa no maximo `limit` jobs", async () => {
    const { deps, memory, blocks } = buildDeps(["1", "2", "3", "4"]);
    const summary = await runOffline(deps, { dryRun: false, limit: 2 }, MOVIE_REQ);

    expect(summary.enqueue.created).toBe(2);
    expect(summary.run.claimed).toBe(2);
    expect(memory.claimedIds).toHaveLength(2);
    expect(blocks.saved).toHaveLength(4);
  });
});
