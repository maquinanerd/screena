/**
 * inspect-cli.ts — Parsing/resolucao PURA do CLI de inspecao read-only.
 *
 * Mantem o `bin/inspect.ts` fino: aqui ficam o parse de argv, a resolucao do
 * comando (ok | erro de uso) e a checagem de `DATABASE_URL` — tudo sem efeito
 * colateral (sem process.exit, sem IO, sem banco, sem Gemini), logo 100%
 * testavel.
 *
 * Inspecao e somente leitura: ao contrario do enqueue (que so escreve pt-BR),
 * aqui qualquer idioma e aceito como FILTRO (default pt-BR), pois inspecionar
 * rascunhos en/es e legitimo.
 */

import type { EntityType } from "../types.js";

/** Tipos de entidade aceitos como filtro (espelha o enum EntityType). */
const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set([
  "movie",
  "tv",
  "season",
  "episode",
  "person",
]);

/** Idioma default do recorte. */
export const DEFAULT_LANGUAGE = "pt-BR";

/** Limite default seguro das listas recentes. */
export const DEFAULT_LIMIT = 20;

/** Teto do limite, para evitar listas/queries pesadas. */
export const MAX_LIMIT = 200;

/** Argumentos crus do CLI (apos parse de argv). */
export interface InspectCliArgs {
  readonly entityType?: string;
  readonly language: string;
  readonly limit: number;
  readonly json: boolean;
}

/** Comando resolvido: pronto para executar ou erro de uso. */
export type InspectCommand =
  | {
      readonly kind: "ok";
      readonly entityType?: EntityType;
      readonly languageCode: string;
      readonly limit: number;
      readonly json: boolean;
    }
  | { readonly kind: "error"; readonly message: string };

/**
 * Parse PURO de argv (sem efeitos colaterais). Defaults: language pt-BR,
 * limit 20, json false. `--limit` invalido/ausente cai no default; a validacao
 * final (clamp/teto) acontece em `resolveInspectCommand`.
 */
export function parseInspectArgs(argv: readonly string[]): InspectCliArgs {
  let entityType: string | undefined;
  let language = DEFAULT_LANGUAGE;
  let limit = DEFAULT_LIMIT;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--json") {
      json = true;
    } else if (flag === "--entity-type") {
      entityType = argv[i + 1];
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

  return { entityType, language, limit, json };
}

/** Resolve o comando a executar (ou erro de uso) a partir dos args. */
export function resolveInspectCommand(args: InspectCliArgs): InspectCommand {
  if (args.entityType !== undefined && !VALID_ENTITY_TYPES.has(args.entityType)) {
    return {
      kind: "error",
      message: "--entity-type invalido (movie|tv|season|episode|person).",
    };
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) {
    return { kind: "error", message: "--limit deve ser um inteiro positivo." };
  }
  if (args.language.trim() === "") {
    return { kind: "error", message: "--language nao pode ser vazio." };
  }

  const limit = Math.min(Math.floor(args.limit), MAX_LIMIT);
  return {
    kind: "ok",
    entityType: args.entityType as EntityType | undefined,
    languageCode: args.language,
    limit,
    json: args.json,
  };
}

/** Resultado da checagem de env: ok ou mensagem de erro. */
export type EnvCheck = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Exige `DATABASE_URL` ANTES de qualquer query. Worker-only: a inspecao le o
 * PostgreSQL. Sem a env, aborta com mensagem clara (nunca abre conexao).
 */
export function requireDatabaseUrl(env: Record<string, string | undefined>): EnvCheck {
  const value = env.DATABASE_URL;
  if (value === undefined || value.trim() === "") {
    return {
      ok: false,
      message: "DATABASE_URL ausente (worker-only; a inspecao read-only le o PostgreSQL).",
    };
  }
  return { ok: true };
}
