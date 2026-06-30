#!/usr/bin/env node
/**
 * bin/enqueue.ts — CLI manual de enqueue de jobs do Entity Writer. EXCLUIDO do typecheck.
 *
 * Worker-only/offline — NUNCA no render, NUNCA daemon/systemd/cron. Cria jobs de
 * geracao editorial em `entity_writer_jobs`. NAO chama Gemini, NAO roda o runner,
 * NAO gera content_block e NAO publica: apenas enfileira. O runner (`bin/run.ts`)
 * consome o job depois, em separado.
 *
 * Modos:
 *  - SINGLE (por id): enqueue de UM alvo explicito.
 *      tsx services/entity-writer/bin/enqueue.ts --entity-type movie --entity-id 42
 *      tsx services/entity-writer/bin/enqueue.ts --entity-type tv --entity-id 7 --force
 *      tsx services/entity-writer/bin/enqueue.ts --entity-type movie --entity-id 42 --dry-run
 *  - MISSING (lote controlado): enqueue dos faltantes de um tipo, limitado.
 *      tsx services/entity-writer/bin/enqueue.ts --entity-type movie --missing --limit 50 --dry-run
 *      tsx services/entity-writer/bin/enqueue.ts --entity-type movie --missing --limit 50
 *      tsx services/entity-writer/bin/enqueue.ts --entity-type tv --missing --limit 25
 *
 * Flags: --entity-type movie|tv (single tambem aceita season|episode|person, que
 *        sao pulados pelo planner), --entity-id ID (single), --missing, --limit N
 *        (obrigatorio com --missing), --language pt-BR (default), --force, --dry-run.
 *
 * A logica de parse/resolucao mora em src/runner/enqueue-cli.ts (testavel). Env:
 * DATABASE_URL. NAO imprime payload, prompt nem segredo — so o resumo estruturado.
 */

import { disconnectPrisma } from "@screena/db/server";
import { createEntityWriterPersistence } from "../src/persistence/index.js";
import { enqueueMissing, enqueueOne } from "../src/runner/enqueue-jobs.js";
import { parseEnqueueArgs, resolveEnqueueCommand } from "../src/runner/enqueue-cli.js";

function usage(message: string): never {
  console.error(`Erro: ${message}`);
  console.error("Uso (single): tsx services/entity-writer/bin/enqueue.ts --entity-type movie|tv --entity-id ID [--force] [--dry-run]");
  console.error("Uso (lote):   tsx services/entity-writer/bin/enqueue.ts --entity-type movie|tv --missing --limit N [--dry-run]");
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseEnqueueArgs(process.argv.slice(2));
  const command = resolveEnqueueCommand(args);
  if (command.kind === "error") {
    usage(command.message);
  }
  if (args.language !== "pt-BR") {
    console.warn(`Aviso: Fase 3B enfileira apenas pt-BR; "${args.language}" sera recusado.`);
  }

  const persistence = createEntityWriterPersistence();
  try {
    if (command.kind === "missing") {
      const summary = await enqueueMissing(
        {
          payloadSource: persistence.payloadSource,
          read: persistence.enqueueRead,
          enqueue: persistence.jobEnqueue,
          candidates: persistence.candidateSource,
          logger: (message) => console.log(message),
        },
        { dryRun: command.dryRun, limit: command.limit },
        { entityType: command.entityType, languageCode: command.languageCode },
      );
      console.log(JSON.stringify(summary, null, 2));
    } else {
      const result = await enqueueOne(
        {
          payloadSource: persistence.payloadSource,
          read: persistence.enqueueRead,
          enqueue: persistence.jobEnqueue,
          logger: (message) => console.log(message),
        },
        { dryRun: command.dryRun },
        {
          entityType: command.entityType,
          entityId: command.entityId,
          languageCode: command.languageCode,
          force: command.force,
        },
      );
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    await disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  console.error("Falha no enqueue do Entity Writer:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
