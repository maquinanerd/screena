/**
 * smoke-gemini.ts — Nucleo TESTAVEL do smoke manual do Gemini real.
 *
 * Responde a UMA pergunta: "com uma entidade real do banco, o Gemini real
 * devolve JSON valido e passa pela validacao do Entity Writer?". Aqui ficam o
 * parse/guard dos argumentos, a orquestracao (payload -> runGeneration) e a
 * formatacao do resumo SEGURO — tudo dirigido por ports, sem rede direta e SEM
 * NENHUMA porta de persistencia nas deps: por construcao, o smoke NAO salva
 * content_block, NAO grava log e NAO finaliza job.
 *
 * Seguranca: o resumo nunca inclui a `GEMINI_API_KEY`, nem o payload completo,
 * nem a resposta crua do modelo. Erros sao resumidos sem vazar chave/segredo.
 */

import { runGeneration } from "../pipeline/run-generation.js";
import {
  GeminiCircuitOpenError,
  GeminiConfigError,
  GeminiHttpError,
  GeminiResponseError,
} from "../gemini/adapter.js";
import type { GeminiPort, PayloadSourcePort } from "../ports.js";
import type { SelectedPrompt } from "../prompt/select-prompt.js";

/** Tipos de entidade suportados pelo smoke nesta fase. */
const SMOKE_ENTITY_TYPES: ReadonlySet<string> = new Set(["movie", "tv"]);

/** Idioma suportado nesta fase (pt-BR primeiro). */
const SMOKE_LANGUAGE = "pt-BR";

/** Argumentos crus do smoke (apos parse de argv). */
export interface SmokeGeminiArgs {
  readonly entityType?: string;
  readonly entityId?: string;
  readonly language: string;
  readonly confirmLive: boolean;
}

/** Opcoes resolvidas e validadas do smoke. */
export interface SmokeGeminiOptions {
  readonly entityType: "movie" | "tv";
  readonly entityId: string;
  readonly languageCode: "pt-BR";
}

/** Resolucao: pronta para executar, ou erro de uso (sem efeito colateral). */
export type SmokeGeminiResolution =
  | { readonly kind: "ok"; readonly options: SmokeGeminiOptions }
  | { readonly kind: "error"; readonly message: string };

/** Dependencias do smoke: SO payload source + Gemini. Nenhuma persistencia. */
export interface SmokeGeminiDeps {
  readonly payloadSource: PayloadSourcePort;
  readonly gemini: GeminiPort;
  /** Injetavel para teste; default = selectEntityIntroPrompt (via runGeneration). */
  readonly selectPrompt?: () => SelectedPrompt;
}

/** Resumo SEGURO do smoke (nunca contem chave, payload cru ou raw response). */
export interface SmokeGeminiReport {
  readonly entityType: "movie" | "tv";
  readonly entityId: string;
  readonly language: string;
  readonly modelProvider: string;
  readonly modelName: string;
  readonly promptVersion: string;
  /** O modelo devolveu JSON parseavel? (false = falha de parse controlada.) */
  readonly jsonValid: boolean;
  readonly validationStatus: string;
  readonly reviewStatus: string;
  /** Atalho: a validacao terminou em `failed`? */
  readonly validationFailed: boolean;
  readonly blockTypes: readonly string[];
  readonly blockCount: number;
  readonly warnings: readonly string[];
  readonly tokenInput?: number;
  readonly tokenOutput?: number;
  readonly inputHash: string;
  readonly outputHash: string;
}

const MAX_WARNING_LEN = 300;

/** Trunca uma string longa (defesa contra dump acidental de raw/verbosidade). */
function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Parse PURO de argv (sem efeitos colaterais). Default de idioma: pt-BR. */
export function parseSmokeGeminiArgs(argv: readonly string[]): SmokeGeminiArgs {
  let entityType: string | undefined;
  let entityId: string | undefined;
  let language = SMOKE_LANGUAGE;
  let confirmLive = false;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--confirm-live") {
      confirmLive = true;
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
    }
  }

  return { entityType, entityId, language, confirmLive };
}

/**
 * Resolve e VALIDA os argumentos. A guarda `--confirm-live` e a ULTIMA checada:
 * sem ela, retorna erro — garantindo que nada externo (Gemini/banco) seja tocado
 * quando o chamador respeita a resolucao antes de qualquer IO.
 */
export function resolveSmokeGeminiOptions(args: SmokeGeminiArgs): SmokeGeminiResolution {
  if (args.entityType === undefined || args.entityType.trim() === "") {
    return { kind: "error", message: "--entity-type obrigatorio (movie|tv)." };
  }
  if (!SMOKE_ENTITY_TYPES.has(args.entityType)) {
    return { kind: "error", message: "--entity-type invalido: so movie|tv nesta fase (person/season/episode fora)." };
  }
  if (args.entityId === undefined || args.entityId.trim() === "") {
    return { kind: "error", message: "--entity-id obrigatorio." };
  }
  if (args.language !== SMOKE_LANGUAGE) {
    return { kind: "error", message: `--language invalido: so ${SMOKE_LANGUAGE} nesta fase.` };
  }
  if (!args.confirmLive) {
    return {
      kind: "error",
      message:
        "--confirm-live obrigatorio: o smoke chama o Gemini REAL (API externa). Abortando ANTES de qualquer chamada externa.",
    };
  }
  return {
    kind: "ok",
    options: { entityType: args.entityType as "movie" | "tv", entityId: args.entityId, languageCode: SMOKE_LANGUAGE },
  };
}

/**
 * Executa o smoke: monta o payload controlado (PayloadSourcePort real), chama
 * `runGeneration` com o Gemini injetado e devolve o resumo seguro. NAO toca
 * persistencia (nao ha portas de save/log/job nas deps). Erros do adapter
 * (config/HTTP/circuito/envelope) propagam para o chamador formatar com seguranca.
 */
export async function runSmokeGemini(
  deps: SmokeGeminiDeps,
  options: SmokeGeminiOptions,
): Promise<SmokeGeminiReport> {
  const payload = await deps.payloadSource.buildPayload({
    entityType: options.entityType,
    entityId: options.entityId,
    languageCode: options.languageCode,
  });

  const outcome = await runGeneration({
    entityType: options.entityType,
    entityId: options.entityId,
    languageCode: options.languageCode,
    payload,
    gemini: deps.gemini,
    jobId: "smoke", // job sintetico: nada e persistido nem finalizado
    ...(deps.selectPrompt ? { selectPrompt: deps.selectPrompt } : {}),
  });

  return formatSmokeGeminiReport(options, outcome);
}

/** Forma o resumo seguro a partir do resultado de `runGeneration`. */
export function formatSmokeGeminiReport(
  options: SmokeGeminiOptions,
  outcome: Awaited<ReturnType<typeof runGeneration>>,
): SmokeGeminiReport {
  const { result, blockCandidates, logCandidate } = outcome;
  // Falha de PARSE (JSON invalido) e sinalizada por runGeneration via errorMessage
  // com prefixo estavel; forma invalida/saida vazia NAO sao falha de parse.
  const jsonValid = !(typeof logCandidate.errorMessage === "string" && logCandidate.errorMessage.startsWith("JSON invalido"));

  return {
    entityType: options.entityType,
    entityId: options.entityId,
    language: options.languageCode,
    modelProvider: result.provenance.modelProvider,
    modelName: result.provenance.modelName,
    promptVersion: result.provenance.promptVersion,
    jsonValid,
    validationStatus: result.validationStatus,
    reviewStatus: result.reviewStatus,
    validationFailed: result.validationStatus === "failed",
    blockTypes: blockCandidates.map((block) => block.blockType),
    blockCount: blockCandidates.length,
    warnings: result.warnings.map((warning) => truncate(warning, MAX_WARNING_LEN)),
    ...(logCandidate.tokenInput !== undefined ? { tokenInput: logCandidate.tokenInput } : {}),
    ...(logCandidate.tokenOutput !== undefined ? { tokenOutput: logCandidate.tokenOutput } : {}),
    inputHash: result.provenance.inputHash,
    outputHash: result.provenance.outputHash,
  };
}

/**
 * Resume um erro de execucao em UMA linha SEGURA (nunca vaza chave nem corpo
 * sensivel). Cobre os erros do GeminiAdapter e cai num resumo generico para o
 * resto (ex.: payload ausente, falha de rede).
 */
export function formatSmokeError(error: unknown): string {
  if (error instanceof GeminiConfigError) {
    return `Erro de configuracao: ${error.message}`;
  }
  if (error instanceof GeminiHttpError) {
    // Corpo OMITIDO de proposito: nunca ecoar a resposta crua do provedor.
    return `Erro HTTP do Gemini: status ${error.status}${error.permanent ? " (permanente)" : " (transitorio; retries esgotados)"}. Corpo omitido por seguranca.`;
  }
  if (error instanceof GeminiCircuitOpenError) {
    return "Erro: circuito do Gemini aberto (fonte degradada); tente apos o cooldown.";
  }
  if (error instanceof GeminiResponseError) {
    return `Erro de resposta do Gemini: ${error.message}`;
  }
  if (error instanceof Error) {
    return `Erro de payload/execucao: ${truncate(error.message, MAX_WARNING_LEN)}`;
  }
  return "Erro desconhecido na execucao do smoke.";
}
