/**
 * enqueue-jobs.test.ts — Testes do orquestrador de enqueue (Fase 3B.4).
 *
 * Usa apenas fakes em memoria: zero rede, zero banco, zero Gemini (o enqueue nem
 * tem GeminiPort nas deps). Cobre create, dry-run sem escrita, payload ausente,
 * skips (idioma/entidade/job ativo/atualizado), corrida e estabilidade do hash.
 */

import { describe, expect, it } from "vitest";
import { enqueueOne, type EnqueueDeps } from "../runner/enqueue-jobs.js";
import { hashPayload } from "../utils/hash.js";
import { ENQUEUE_TARGET_BLOCK_TYPES } from "../runner/enqueue-plan.js";
import type {
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

function okPayloadSource(payload: EntityPayload = PAYLOAD): PayloadSourcePort {
  return { buildPayload: async () => payload };
}

/** PayloadSource que falha se chamado — prova que o guard curto-circuitou antes. */
function poisonPayloadSource(): PayloadSourcePort {
  return {
    buildPayload: async () => {
      throw new Error("buildPayload NAO deveria ter sido chamado");
    },
  };
}

function throwingPayloadSource(message: string): PayloadSourcePort {
  return {
    buildPayload: async () => {
      throw new Error(message);
    },
  };
}

function fakeRead(blocks: readonly ExistingBlockRef[] = [], hasActiveJob = false): EnqueueReadPort {
  return {
    findActiveBlocks: async () => blocks,
    hasActiveJob: async () => hasActiveJob,
  };
}

function recordingEnqueue(result: { created: boolean; jobId: string | null } = { created: true, jobId: "99" }) {
  const calls: EnqueueJobInput[] = [];
  const port: JobEnqueuePort = {
    createJob: async (input) => {
      calls.push(input);
      return result;
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

/** Blocos atualizados para todos os tipos-alvo, no hash/prompt correntes. */
function upToDateBlocks(): ExistingBlockRef[] {
  return ENQUEUE_TARGET_BLOCK_TYPES.map((blockType) => ({
    blockType,
    reviewStatus: "ai_generated",
    inputHash: hashPayload(PAYLOAD),
    promptVersion: PROMPT_VERSION,
  }));
}

function deps(overrides: Partial<EnqueueDeps> = {}): EnqueueDeps {
  return {
    payloadSource: okPayloadSource(),
    read: fakeRead(),
    enqueue: recordingEnqueue().port,
    selectPrompt,
    ...overrides,
  };
}

const MOVIE_42 = { entityType: "movie" as const, entityId: "42", languageCode: "pt-BR" };

describe("enqueueOne", () => {
  it("cria job (generate_block) no caminho feliz, com payloadHash/promptVersion reais", async () => {
    const enqueue = recordingEnqueue();
    const result = await enqueueOne(deps({ enqueue: enqueue.port }), { dryRun: false }, MOVIE_42);

    expect(result.status).toBe("created");
    expect(result.persisted).toBe(true);
    expect(result.jobType).toBe("generate_block");
    expect(result.jobId).toBe("99");
    expect(result.payloadHash).toBe(hashPayload(PAYLOAD));
    expect(result.promptVersion).toBe(PROMPT_VERSION);

    expect(enqueue.calls).toHaveLength(1);
    expect(enqueue.calls[0]).toEqual({
      entityType: "movie",
      entityId: "42",
      languageCode: "pt-BR",
      jobType: "generate_block",
      payloadHash: hashPayload(PAYLOAD),
      promptVersion: PROMPT_VERSION,
    });
  });

  it("dry-run NAO escreve no banco (createJob nunca e chamado)", async () => {
    const result = await enqueueOne(
      deps({ enqueue: forbiddenEnqueue() }),
      { dryRun: true },
      MOVIE_42,
    );
    expect(result.status).toBe("created");
    expect(result.persisted).toBe(false);
    expect(result.jobType).toBe("generate_block");
    expect(result.jobId).toBeUndefined();
  });

  it("payload ausente => failed e nenhum job criado", async () => {
    const result = await enqueueOne(
      deps({ payloadSource: throwingPayloadSource("movie id=42 nao encontrado"), enqueue: forbiddenEnqueue() }),
      { dryRun: false },
      MOVIE_42,
    );
    expect(result.status).toBe("failed");
    expect(result.persisted).toBe(false);
    expect(result.error).toContain("nao encontrado");
  });

  it("idioma en/es e barrado ANTES de montar payload", async () => {
    const result = await enqueueOne(
      deps({ payloadSource: poisonPayloadSource(), enqueue: forbiddenEnqueue() }),
      { dryRun: false },
      { ...MOVIE_42, languageCode: "en" },
    );
    expect(result.status).toBe("skipped_unsupported_language");
    expect(result.persisted).toBe(false);
  });

  it("entityType nao suportado e barrado ANTES de montar payload", async () => {
    const result = await enqueueOne(
      deps({ payloadSource: poisonPayloadSource(), enqueue: forbiddenEnqueue() }),
      { dryRun: false },
      { entityType: "person", entityId: "5", languageCode: "pt-BR" },
    );
    expect(result.status).toBe("skipped_unsupported_entity");
    expect(result.persisted).toBe(false);
  });

  it("job ativo existente => skip e nenhum job criado", async () => {
    const result = await enqueueOne(
      deps({ read: fakeRead([], true), enqueue: forbiddenEnqueue() }),
      { dryRun: false },
      MOVIE_42,
    );
    expect(result.status).toBe("skipped_existing_active_job");
    expect(result.persisted).toBe(false);
  });

  it("blocos atualizados sem force => skip up_to_date e nenhum job criado", async () => {
    const result = await enqueueOne(
      deps({ read: fakeRead(upToDateBlocks(), false), enqueue: forbiddenEnqueue() }),
      { dryRun: false },
      MOVIE_42,
    );
    expect(result.status).toBe("skipped_up_to_date");
    expect(result.persisted).toBe(false);
  });

  it("corrida (createJob created=false) => skip seguro, sem persistir", async () => {
    const result = await enqueueOne(
      deps({ enqueue: recordingEnqueue({ created: false, jobId: null }).port }),
      { dryRun: false },
      MOVIE_42,
    );
    expect(result.status).toBe("skipped_existing_active_job");
    expect(result.persisted).toBe(false);
    expect(result.jobId).toBeUndefined();
  });

  it("payloadHash e estavel e igual a hashPayload(payload)", async () => {
    const a = await enqueueOne(deps(), { dryRun: true }, MOVIE_42);
    const b = await enqueueOne(deps(), { dryRun: true }, MOVIE_42);
    expect(a.payloadHash).toBe(b.payloadHash);
    expect(a.payloadHash).toBe(hashPayload(PAYLOAD));
  });

  it("nunca enfileira published/human_reviewed e so usa generate/regenerate", async () => {
    const enqueue = recordingEnqueue();
    const result = await enqueueOne(deps({ enqueue: enqueue.port }), { dryRun: false }, MOVIE_42);
    const serialized = JSON.stringify(result) + JSON.stringify(enqueue.calls);
    expect(serialized).not.toContain("published");
    expect(serialized).not.toContain("human_reviewed");
    expect(["generate_block", "regenerate_block"]).toContain(enqueue.calls[0]?.jobType);
  });
});
