/**
 * Testes da orquestracao do runner offline (processJobs). 100% com fakes em
 * memoria — zero rede, zero banco, zero Gemini real.
 */

import { describe, expect, it } from "vitest";
import type { EntityPayload } from "@screena/schemas";
import { FakeGeminiPort } from "../gemini/fake.js";
import { processJobs, type RunnerDeps } from "../runner/run-jobs.js";
import type {
  ClaimOptions,
  ClaimedJob,
  ContentBlockRecord,
  EntityWriterLogInput,
  GeminiPort,
  JobClaimPort,
  JobCompletionInput,
  PayloadSourcePort,
} from "../ports.js";

const PAYLOAD: EntityPayload = {
  entityType: "movie",
  director: "Denis Villeneuve",
  cast: ["Timothee Chalamet"],
  title: "Duna",
};

function makeJob(over: Partial<ClaimedJob> = {}): ClaimedJob {
  return { id: "1", entityType: "movie", entityId: "10", languageCode: "pt-BR", ...over };
}

function fakeClaim(jobs: ClaimedJob[]): { port: JobClaimPort; options: ClaimOptions[] } {
  const queue = [...jobs];
  const options: ClaimOptions[] = [];
  return {
    options,
    port: {
      claimNext(opts) {
        options.push(opts);
        return Promise.resolve(queue.shift() ?? null);
      },
    },
  };
}

function fakePayloadSource(impl?: () => Promise<EntityPayload>): PayloadSourcePort {
  return { buildPayload: impl ?? (() => Promise.resolve(PAYLOAD)) };
}

const stubPrompt = () => ({ promptVersion: "0.2.0", content: "PROMPT" });

function setup(opts: {
  jobs?: ClaimedJob[];
  gemini?: GeminiPort;
  payloadSource?: PayloadSourcePort;
}) {
  const claim = fakeClaim(opts.jobs ?? [makeJob()]);
  const saved: ContentBlockRecord[] = [];
  const written: EntityWriterLogInput[] = [];
  const finished: JobCompletionInput[] = [];
  const deps: RunnerDeps = {
    claim: claim.port,
    payloadSource: opts.payloadSource ?? fakePayloadSource(),
    gemini: opts.gemini ?? new FakeGeminiPort({ mode: "success" }),
    contentBlocks: {
      save: (record) => {
        saved.push(record);
        return Promise.resolve();
      },
    },
    logs: {
      write: (input) => {
        written.push(input);
        return Promise.resolve();
      },
    },
    jobs: {
      finishJob: (input) => {
        finished.push(input);
        return Promise.resolve();
      },
    },
    selectPrompt: stubPrompt,
  };
  return { deps, claim, saved, written, finished };
}

const TERMINAL = ["completed", "blocked", "failed"];

describe("processJobs", () => {
  it("dry-run NAO persiste e faz claim em modo peek", async () => {
    const { deps, claim, saved, written, finished } = setup({});
    const summary = await processJobs(deps, { limit: 5, dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(saved).toEqual([]);
    expect(written).toEqual([]);
    expect(finished).toEqual([]);
    expect(claim.options[0]?.dryRun).toBe(true);
    expect(summary.jobs[0]?.outcome).toBe("dry-run");
  });

  it("sucesso (fake) salva os candidatos, grava log e finaliza job como completed", async () => {
    const { deps, saved, written, finished, claim } = setup({
      gemini: new FakeGeminiPort({ mode: "success" }),
    });
    const summary = await processJobs(deps, { limit: 5, dryRun: false });

    expect(saved.map((s) => s.blockType).sort()).toEqual(["cast_intro", "editorial_intro"]);
    expect(written).toHaveLength(1);
    expect(finished).toEqual([
      { jobId: "1", status: "completed", resultBlockId: null, lastError: null },
    ]);
    expect(summary.jobs[0]?.outcome).toBe("succeeded");
    expect(claim.options[0]?.dryRun).toBe(false);
  });

  it("respeita o limit", async () => {
    const jobs = ["1", "2", "3", "4", "5"].map((id) => makeJob({ id }));
    const { deps, finished } = setup({ jobs });
    const summary = await processJobs(deps, { limit: 2, dryRun: false });

    expect(summary.claimed).toBe(2);
    expect(finished).toHaveLength(2);
  });

  it("job sem payload vira falha controlada (blocked), sem content block", async () => {
    const payloadSource = fakePayloadSource(() => Promise.reject(new Error("movie nao encontrado")));
    const { deps, saved, written, finished } = setup({ payloadSource });
    const summary = await processJobs(deps, { limit: 1, dryRun: false });

    expect(saved).toEqual([]);
    expect(written).toHaveLength(1); // log da tentativa falha
    expect(finished[0]?.status).toBe("blocked");
    expect(summary.jobs[0]?.error).toContain("payload indisponivel");
  });

  it("JSON invalido do modelo nao gera content block e bloqueia o job", async () => {
    const { deps, saved, finished } = setup({ gemini: new FakeGeminiPort({ mode: "invalid-json" }) });
    await processJobs(deps, { limit: 1, dryRun: false });

    expect(saved).toEqual([]);
    expect(finished[0]?.status).toBe("blocked");
  });

  it("saida vazia nao gera content block e bloqueia o job", async () => {
    const { deps, saved, finished } = setup({ gemini: new FakeGeminiPort({ mode: "empty" }) });
    await processJobs(deps, { limit: 1, dryRun: false });

    expect(saved).toEqual([]);
    expect(finished[0]?.status).toBe("blocked");
  });

  it("erro tecnico do Gemini: job failed, sem content block e sem vazar a chave", async () => {
    const throwing: GeminiPort = {
      generate: () => Promise.reject(new Error("Gemini HTTP 500")),
    };
    const { deps, saved, finished } = setup({ gemini: throwing });
    const summary = await processJobs(deps, { limit: 1, dryRun: false });

    expect(saved).toEqual([]);
    expect(finished[0]?.status).toBe("failed");
    expect(summary.jobs[0]?.error).toContain("erro tecnico de geracao");
    expect(JSON.stringify(summary)).not.toContain("SECRET-API-KEY"); // sentinela: nada de chave
  });

  it("idioma fora de pt-BR e bloqueado antes de montar payload", async () => {
    const { deps, saved, finished } = setup({ jobs: [makeJob({ languageCode: "en" })] });
    const summary = await processJobs(deps, { limit: 1, dryRun: false });

    expect(saved).toEqual([]);
    expect(finished[0]?.status).toBe("blocked");
    expect(summary.jobs[0]?.error).toContain("idioma fora da Fase 3A");
  });

  it("NUNCA finaliza job como published/human_reviewed e nunca persiste esses status", async () => {
    const modes = ["success", "empty", "invalid-json"] as const;
    for (const mode of modes) {
      const { deps, saved, finished } = setup({ gemini: new FakeGeminiPort({ mode }) });
      await processJobs(deps, { limit: 1, dryRun: false });
      for (const f of finished) {
        expect(TERMINAL).toContain(f.status);
      }
      for (const block of saved) {
        expect(["ai_generated", "needs_review"]).toContain(block.reviewStatus);
      }
    }
  });
});
