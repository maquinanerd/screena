/**
 * enqueue-cli.ts — Parsing e resolucao PURA dos argumentos do CLI de enqueue.
 *
 * Mantem o `bin/enqueue.ts` fino: aqui ficam o parse de argv e a resolucao do
 * comando (single por id | missing em lote | erro de uso), tudo sem efeito
 * colateral (sem `process.exit`, sem IO), logo 100% testavel. NUNCA chama Gemini,
 * NUNCA toca banco — apenas decide a forma do comando.
 *
 * Dois modos:
 *  - SINGLE (default): exige `--entity-id`; aceita movie|tv|season|episode|person
 *    (tipos sem suporte de payload sao pulados depois pelo planner).
 *  - MISSING (`--missing`): enqueue em lote; exige `--entity-type movie|tv` e
 *    `--limit N`; `--entity-id` nao e exigido.
 */

import type { EntityType } from "../types.js";

/** Tipos aceitos no modo SINGLE (alguns nao geram job; o planner decide). */
const VALID_SINGLE_ENTITY_TYPES: ReadonlySet<string> = new Set([
  "movie",
  "tv",
  "season",
  "episode",
  "person",
]);

/** Tipos aceitos no modo MISSING (so os que o payload source sabe montar). */
const VALID_MISSING_ENTITY_TYPES: ReadonlySet<string> = new Set(["movie", "tv"]);

/** Argumentos crus do CLI (apos o parse de argv). */
export interface EnqueueCliArgs {
  readonly entityType?: string;
  readonly entityId?: string;
  readonly language: string;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly missing: boolean;
  readonly limit?: number;
}

/** Comando resolvido: enqueue de um alvo, enqueue em lote, ou erro de uso. */
export type EnqueueCommand =
  | {
      readonly kind: "single";
      readonly entityType: EntityType;
      readonly entityId: string;
      readonly languageCode: string;
      readonly force: boolean;
      readonly dryRun: boolean;
    }
  | {
      readonly kind: "missing";
      readonly entityType: "movie" | "tv";
      readonly languageCode: string;
      readonly limit: number;
      readonly dryRun: boolean;
    }
  | { readonly kind: "error"; readonly message: string };

/** Parse PURO de argv (sem efeitos colaterais). Flags desconhecidas sao ignoradas. */
export function parseEnqueueArgs(argv: readonly string[]): EnqueueCliArgs {
  let entityType: string | undefined;
  let entityId: string | undefined;
  let language = "pt-BR";
  let force = false;
  let dryRun = false;
  let missing = false;
  let limit: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--force") {
      force = true;
    } else if (flag === "--dry-run") {
      dryRun = true;
    } else if (flag === "--missing") {
      missing = true;
    } else if (flag === "--entity-type") {
      entityType = argv[i + 1];
      i += 1;
    } else if (flag === "--entity-id") {
      entityId = argv[i + 1];
      i += 1;
    } else if (flag === "--language") {
      const value = argv[i + 1];
      if (value !== undefined) language = value;
      i += 1;
    } else if (flag === "--limit") {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value)) limit = value;
      i += 1;
    }
  }

  return { entityType, entityId, language, force, dryRun, missing, limit };
}

/** Resolve o comando a executar (ou um erro de uso) a partir dos args. */
export function resolveEnqueueCommand(args: EnqueueCliArgs): EnqueueCommand {
  if (args.entityType === undefined) {
    return { kind: "error", message: "--entity-type obrigatorio (movie|tv|season|episode|person)." };
  }

  // Modo lote: --missing.
  if (args.missing) {
    if (!VALID_MISSING_ENTITY_TYPES.has(args.entityType)) {
      return {
        kind: "error",
        message: "--missing exige --entity-type movie|tv (person/season/episode nao suportados nesta fase).",
      };
    }
    if (args.limit === undefined || !Number.isFinite(args.limit) || args.limit <= 0) {
      return { kind: "error", message: "--missing exige --limit N (inteiro positivo)." };
    }
    return {
      kind: "missing",
      entityType: args.entityType as "movie" | "tv",
      languageCode: args.language,
      limit: Math.floor(args.limit),
      dryRun: args.dryRun,
    };
  }

  // Modo single: por --entity-id (comportamento historico).
  if (!VALID_SINGLE_ENTITY_TYPES.has(args.entityType)) {
    return { kind: "error", message: "--entity-type invalido (movie|tv|season|episode|person)." };
  }
  if (args.entityId === undefined || args.entityId.trim() === "") {
    return { kind: "error", message: "--entity-id obrigatorio (sem --missing)." };
  }
  return {
    kind: "single",
    entityType: args.entityType as EntityType,
    entityId: args.entityId,
    languageCode: args.language,
    force: args.force,
    dryRun: args.dryRun,
  };
}
