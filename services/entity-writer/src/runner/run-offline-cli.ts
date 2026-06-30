/**
 * run-offline-cli.ts — Parsing e resolucao PURA do CLI do ciclo offline.
 *
 * Mantem o `bin/run-offline.ts` fino: aqui ficam o parse de argv e a resolucao
 * (comando valido ou erro de uso), sem efeito colateral (sem process.exit/IO),
 * logo 100% testavel. Tambem decide se o Gemini REAL deve ser usado — so com
 * `--confirm-live`, e NUNCA em dry-run ou com `--fake` (fake e o default seguro).
 */

/** Tipos de entidade aceitos no ciclo offline (so os que tem payload). */
const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set(["movie", "tv"]);

/** Idioma suportado nesta fase. */
const LANGUAGE = "pt-BR";

/** Argumentos crus do CLI (apos parse de argv). */
export interface RunOfflineArgs {
  readonly entityType?: string;
  readonly language: string;
  readonly missing: boolean;
  readonly limit?: number;
  readonly dryRun: boolean;
  readonly fake: boolean;
  readonly confirmLive: boolean;
}

/** Opcoes resolvidas e validadas do ciclo offline. */
export interface RunOfflineResolvedOptions {
  readonly entityType: "movie" | "tv";
  readonly languageCode: "pt-BR";
  readonly limit: number;
  readonly dryRun: boolean;
}

/** Comando resolvido: pronto para executar (com escolha de Gemini) ou erro. */
export type RunOfflineCommand =
  | { readonly kind: "ok"; readonly options: RunOfflineResolvedOptions; readonly useRealGemini: boolean }
  | { readonly kind: "error"; readonly message: string };

/** Parse PURO de argv (sem efeitos colaterais). Default de idioma: pt-BR. */
export function parseRunOfflineArgs(argv: readonly string[]): RunOfflineArgs {
  let entityType: string | undefined;
  let language = LANGUAGE;
  let missing = false;
  let limit: number | undefined;
  let dryRun = false;
  let fake = false;
  let confirmLive = false;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--missing") {
      missing = true;
    } else if (flag === "--dry-run") {
      dryRun = true;
    } else if (flag === "--fake") {
      fake = true;
    } else if (flag === "--confirm-live") {
      confirmLive = true;
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

  return { entityType, language, missing, limit, dryRun, fake, confirmLive };
}

/**
 * Decide se o Gemini REAL deve ser usado. Default e FAKE: o real so entra com
 * `--confirm-live` explicito, e NUNCA quando ha `--dry-run` (seguro) ou `--fake`
 * (override explicito para fake).
 */
export function shouldUseRealGemini(args: RunOfflineArgs): boolean {
  return args.confirmLive && !args.dryRun && !args.fake;
}

/** Resolve o comando a executar (ou um erro de uso) a partir dos args. */
export function resolveRunOfflineCommand(args: RunOfflineArgs): RunOfflineCommand {
  if (args.entityType === undefined || args.entityType.trim() === "") {
    return { kind: "error", message: "--entity-type obrigatorio (movie|tv)." };
  }
  if (!VALID_ENTITY_TYPES.has(args.entityType)) {
    return { kind: "error", message: "--entity-type invalido: so movie|tv nesta fase." };
  }
  if (!args.missing) {
    return { kind: "error", message: "--missing obrigatorio: run-offline processa entidades faltantes em lote." };
  }
  if (args.limit === undefined || !Number.isFinite(args.limit) || args.limit <= 0) {
    return { kind: "error", message: "--limit N obrigatorio (inteiro positivo)." };
  }
  if (args.language !== LANGUAGE) {
    return { kind: "error", message: `--language invalido: so ${LANGUAGE} nesta fase.` };
  }
  return {
    kind: "ok",
    options: {
      entityType: args.entityType as "movie" | "tv",
      languageCode: LANGUAGE,
      limit: Math.floor(args.limit),
      dryRun: args.dryRun,
    },
    useRealGemini: shouldUseRealGemini(args),
  };
}
