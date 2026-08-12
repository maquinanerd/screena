#!/usr/bin/env node
/**
 * bin/inspect.ts — CLI READ-ONLY de inspecao do Entity Writer. EXCLUIDO do typecheck.
 *
 * Worker-only/offline — NUNCA no render. Responde rapidamente ao estado
 * operacional: jobs por status, content_blocks por review_status, entidades com
 * blocos, falhas/logs recentes e fila acumulada. SOMENTE LEITURA: nao chama
 * Gemini, nao cria job, nao roda runner, nao publica, NAO persiste nada.
 *
 * Uso:
 *   tsx services/entity-writer/bin/inspect.ts --limit 20
 *   tsx services/entity-writer/bin/inspect.ts --entity-type movie --json
 *   pnpm --filter @screena/entity-writer inspect --limit 20
 *
 * Flags: --limit N (default 20), --entity-type movie|tv|season|episode|person
 *        (opcional), --language pt-BR (default), --json (saida estruturada).
 *
 * Env: exige DATABASE_URL — sem ela, aborta ANTES de qualquer query (nunca abre
 * conexao). NUNCA imprime API key, payload, resposta crua do Gemini, segredo
 * nem stack trace longo.
 */

import { disconnectPrisma, getPrismaClient } from "@screena/db/server";
import {
  parseInspectArgs,
  requireDatabaseUrl,
  resolveInspectCommand,
} from "../src/inspect/inspect-cli.js";
import { inspectEntityWriter } from "../src/inspect/inspect-entity-writer.js";
import { formatInspectionSummary, toInspectionJson } from "../src/inspect/inspect-format.js";
import { createPrismaInspectStore } from "../src/persistence/inspect-store.js";

async function main(): Promise<void> {
  const command = resolveInspectCommand(parseInspectArgs(process.argv.slice(2)));
  if (command.kind === "error") {
    console.error(`Erro: ${command.message}`);
    console.error(
      "Uso: tsx services/entity-writer/bin/inspect.ts [--limit N] [--entity-type movie|tv|season|episode|person] [--language pt-BR] [--json]",
    );
    process.exitCode = 1;
    return;
  }

  // DATABASE_URL exigido ANTES de tocar o banco (worker-only; read-only).
  const env = requireDatabaseUrl(process.env);
  if (!env.ok) {
    console.error(`Erro: ${env.message}`);
    process.exitCode = 1;
    return;
  }

  const store = createPrismaInspectStore(getPrismaClient());
  try {
    const report = await inspectEntityWriter(store, {
      limit: command.limit,
      entityType: command.entityType,
      languageCode: command.languageCode,
    });
    console.log(command.json ? toInspectionJson(report) : formatInspectionSummary(report));
  } catch (error) {
    console.error("Falha na inspecao:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  console.error("Falha na inspecao:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
