#!/usr/bin/env node
/**
 * bin/enqueue.ts — CLI manual de enqueue de jobs do Entity Writer. EXCLUIDO do typecheck.
 *
 * Worker-only/offline — NUNCA no render, NUNCA daemon/systemd/cron. Cria UM job
 * de geracao editorial em `entity_writer_jobs` para um alvo explicito (por id).
 * NAO chama Gemini, NAO roda o runner, NAO gera content_block e NAO publica:
 * apenas enfileira. O runner (`bin/run.ts`) consome o job depois, em separado.
 *
 * Uso:
 *   tsx services/entity-writer/bin/enqueue.ts --entity-type movie --entity-id 42
 *   tsx services/entity-writer/bin/enqueue.ts --entity-type tv --entity-id 7 --force
 *   tsx services/entity-writer/bin/enqueue.ts --entity-type movie --entity-id 42 --dry-run
 *
 * Flags: --entity-type movie|tv (person/season/episode sao recusados nesta fase),
 *        --entity-id ID, --language pt-BR (default), --force, --dry-run.
 *
 * Escopo: SEM busca em lote (`--missing`/`--limit`) — apenas enqueue explicito
 * por id, para nao depender de query de descoberta nesta fatia. Env: DATABASE_URL.
 */

import { disconnectPrisma } from "@screena/db/server";
import { createEntityWriterPersistence } from "../src/persistence/index.js";
import { enqueueOne } from "../src/runner/enqueue-jobs.js";

/** Tipos de entidade aceitos no flag (validacao de entrada; nem todos geram job). */
const VALID_ENTITY_TYPES = new Set(["movie", "tv", "season", "episode", "person"]);

interface CliArgs {
  entityType?: string;
  entityId?: string;
  language: string;
  force: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { language: "pt-BR", force: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--force") {
      args.force = true;
    } else if (flag === "--dry-run") {
      args.dryRun = true;
    } else if (flag === "--entity-type") {
      args.entityType = argv[i + 1];
      i += 1;
    } else if (flag === "--entity-id") {
      args.entityId = argv[i + 1];
      i += 1;
    } else if (flag === "--language") {
      const value = argv[i + 1];
      if (value !== undefined) args.language = value;
      i += 1;
    }
  }
  return args;
}

function usage(message: string): never {
  console.error(`Erro: ${message}`);
  console.error(
    "Uso: tsx services/entity-writer/bin/enqueue.ts --entity-type movie|tv --entity-id ID [--language pt-BR] [--force] [--dry-run]",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.entityType === undefined || !VALID_ENTITY_TYPES.has(args.entityType)) {
    usage("--entity-type obrigatorio (movie|tv|season|episode|person).");
  }
  if (args.entityId === undefined || args.entityId.trim() === "") {
    usage("--entity-id obrigatorio.");
  }
  if (args.language !== "pt-BR") {
    console.warn(`Aviso: Fase 3B.4 enfileira apenas pt-BR; "${args.language}" sera recusado.`);
  }

  const persistence = createEntityWriterPersistence();
  try {
    const result = await enqueueOne(
      {
        payloadSource: persistence.payloadSource,
        read: persistence.enqueueRead,
        enqueue: persistence.jobEnqueue,
        logger: (message) => console.log(message),
      },
      { dryRun: args.dryRun },
      {
        entityType: args.entityType as "movie" | "tv",
        entityId: args.entityId as string,
        languageCode: args.language,
        force: args.force,
      },
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  console.error("Falha no enqueue do Entity Writer:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
