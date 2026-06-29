#!/usr/bin/env node
/**
 * bin/run.ts — Runner offline do Entity Writer (CLI). EXCLUIDO do typecheck.
 *
 * Worker-only/offline — NUNCA no render, NUNCA daemon/systemd/cron nesta fase.
 * Processa ate N jobs de `entity_writer_jobs`: claim -> payload -> runGeneration
 * -> persiste content_blocks/log -> finaliza job. NUNCA publica automaticamente.
 *
 * Uso:
 *   tsx services/entity-writer/bin/run.ts --dry-run            # peek, sem mutar, sempre fake
 *   tsx services/entity-writer/bin/run.ts --fake --limit 5     # fake, persiste
 *   tsx services/entity-writer/bin/run.ts --limit 3            # Gemini real (exige GEMINI_API_KEY/MODEL)
 *   tsx services/entity-writer/bin/run.ts --job-id 42          # um job especifico
 *
 * Env (worker-only; nunca no front): GEMINI_API_KEY, GEMINI_MODEL (modo real) +
 * DATABASE_URL. Em --dry-run/--fake o Gemini real NAO e chamado.
 */

import { disconnectPrisma } from "@screena/db/server";
import { createGeminiAdapterFromEnv } from "../src/gemini/adapter.js";
import { FakeGeminiPort } from "../src/gemini/fake.js";
import { createEntityWriterPersistence } from "../src/persistence/index.js";
import type { GeminiPort } from "../src/ports.js";
import { processJobs } from "../src/runner/run-jobs.js";

interface CliArgs {
  limit: number;
  dryRun: boolean;
  fake: boolean;
  jobId?: string;
  language: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { limit: 10, dryRun: false, fake: false, language: "pt-BR" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--dry-run") {
      args.dryRun = true;
    } else if (flag === "--fake") {
      args.fake = true;
    } else if (flag === "--limit") {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) args.limit = Math.floor(value);
      i += 1;
    } else if (flag === "--job-id") {
      const value = argv[i + 1];
      if (value !== undefined) args.jobId = value;
      i += 1;
    } else if (flag === "--language") {
      const value = argv[i + 1];
      if (value !== undefined) args.language = value;
      i += 1;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.language !== "pt-BR") {
    console.warn(`Aviso: Fase 3A processa apenas pt-BR; "${args.language}" sera ignorado.`);
  }

  // Em dry-run ou --fake, usa o fake deterministico (Gemini real nunca e chamado).
  const useFake = args.fake || args.dryRun;
  const gemini: GeminiPort = useFake ? new FakeGeminiPort() : createGeminiAdapterFromEnv();

  const persistence = createEntityWriterPersistence();
  try {
    const summary = await processJobs(
      {
        claim: persistence.claim,
        payloadSource: persistence.payloadSource,
        gemini,
        contentBlocks: persistence.contentBlocks,
        logs: persistence.logs,
        jobs: persistence.jobs,
        logger: (message) => console.log(message),
      },
      { limit: args.limit, dryRun: args.dryRun, jobId: args.jobId },
    );
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  // Nunca despeja a chave: GeminiConfigError/GeminiHttpError nao a contem.
  console.error("Falha no runner do Entity Writer:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
