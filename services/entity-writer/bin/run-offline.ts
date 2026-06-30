#!/usr/bin/env node
/**
 * bin/run-offline.ts — Ciclo OFFLINE encadeado do Entity Writer (CLI). EXCLUIDO do typecheck.
 *
 * Worker-only/offline — NUNCA no render, NUNCA daemon/systemd/cron. Encadeia numa
 * unica passada: enqueue dos FALTANTES (`enqueueMissing`) -> runner (`processJobs`).
 * Serve para exercitar o ciclo offline completo SEM depender de chave Gemini real
 * (fake por padrao). NUNCA publica.
 *
 * Gemini: FAKE por padrao (e sempre em --dry-run/--fake). O Gemini REAL so e usado
 * com `--confirm-live` explicito (e exige GEMINI_API_KEY/GEMINI_MODEL).
 *
 * Uso:
 *   tsx services/entity-writer/bin/run-offline.ts --entity-type movie --missing --limit 10 --fake --dry-run
 *   tsx services/entity-writer/bin/run-offline.ts --entity-type movie --missing --limit 10 --fake
 *   tsx services/entity-writer/bin/run-offline.ts --entity-type tv --missing --limit 25 --confirm-live   # Gemini REAL
 *
 * Env: DATABASE_URL (sempre). GEMINI_API_KEY/GEMINI_MODEL apenas com --confirm-live.
 */

import { disconnectPrisma } from "@screena/db/server";
import { createGeminiAdapterFromEnv } from "../src/gemini/adapter.js";
import { FakeGeminiPort } from "../src/gemini/fake.js";
import { createEntityWriterPersistence } from "../src/persistence/index.js";
import type { GeminiPort } from "../src/ports.js";
import { runOffline } from "../src/runner/run-offline.js";
import { parseRunOfflineArgs, resolveRunOfflineCommand } from "../src/runner/run-offline-cli.js";

/** Env exigida apenas quando o Gemini REAL e usado (--confirm-live). */
const REQUIRED_LIVE_ENV = ["GEMINI_API_KEY", "GEMINI_MODEL"] as const;

function missingEnv(names: readonly string[]): string[] {
  return names.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === "";
  });
}

async function main(): Promise<void> {
  const args = parseRunOfflineArgs(process.argv.slice(2));
  const command = resolveRunOfflineCommand(args);
  if (command.kind === "error") {
    console.error(`Erro: ${command.message}`);
    process.exitCode = 1;
    return;
  }

  // DATABASE_URL e sempre necessario (o ciclo le/escreve o PostgreSQL).
  if (missingEnv(["DATABASE_URL"]).length > 0) {
    console.error("Erro: DATABASE_URL ausente (worker-only; o ciclo offline le/escreve o PostgreSQL).");
    process.exitCode = 1;
    return;
  }

  // Gemini: FAKE por padrao; REAL so com --confirm-live (e nao dry-run/--fake) + env.
  let gemini: GeminiPort;
  if (command.useRealGemini) {
    const missing = missingEnv(REQUIRED_LIVE_ENV);
    if (missing.length > 0) {
      console.error(`Erro: --confirm-live exige ${missing.join(", ")} (worker-only; defina em env var).`);
      process.exitCode = 1;
      return;
    }
    console.warn("[run-offline] AVISO: chamando o Gemini REAL (--confirm-live). Persiste content_blocks (NUNCA published).");
    gemini = createGeminiAdapterFromEnv();
  } else {
    gemini = new FakeGeminiPort();
  }

  const persistence = createEntityWriterPersistence();
  try {
    const summary = await runOffline(
      {
        payloadSource: persistence.payloadSource,
        read: persistence.enqueueRead,
        enqueue: persistence.jobEnqueue,
        candidates: persistence.candidateSource,
        claim: persistence.claim,
        gemini,
        contentBlocks: persistence.contentBlocks,
        logs: persistence.logs,
        jobs: persistence.jobs,
        logger: (message) => console.log(message),
      },
      { dryRun: command.options.dryRun, limit: command.options.limit },
      { entityType: command.options.entityType, languageCode: command.options.languageCode },
    );
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error("Falha no run-offline:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  console.error("Falha no run-offline:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
