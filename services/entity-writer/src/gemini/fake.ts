/**
 * fake.ts — `FakeGeminiPort` determinístico para CI/testes.
 *
 * Implementa `GeminiPort` SEM rede e SEM modelo real: dado um payload, monta um
 * `EntityWriterOutput` flat determinístico e o serializa como `raw` (JSON em
 * texto), exatamente como um adapter real devolveria. Permite simular sucesso,
 * warnings, saida vazia e JSON invalido para exercitar a validacao/decisao.
 *
 * Zero rede, zero Gemini real. O adapter Gemini real (worker-only) entra em
 * fase posterior, atras do mesmo `GeminiPort`.
 */

import type { EntityPayload, EntityWriterOutput } from "../types.js";
import type { GeminiGenerateInput, GeminiGenerateOutput, GeminiPort } from "../ports.js";

/** Cenarios determinísticos que o fake pode produzir. */
export type FakeGeminiMode = "success" | "warnings" | "empty" | "invalid-json";

/** Opcoes do fake (todas determinísticas). */
export interface FakeGeminiOptions {
  readonly mode?: FakeGeminiMode;
  readonly modelProvider?: string;
  readonly modelName?: string;
}

const DEFAULT_PROVIDER = "fake";
const DEFAULT_MODEL = "fake-gemini-2026";

/** Constroi um `EntityWriterOutput` flat determinístico a partir do payload. */
function buildOutput(mode: FakeGeminiMode, payload: EntityPayload): EntityWriterOutput {
  if (mode === "empty") {
    return { warnings: [] };
  }
  const base: EntityWriterOutput = {
    editorial_intro: `Dirigido por ${payload.director}, este titulo reune um elenco de destaque.`,
    cast_intro: `No elenco: ${payload.cast.join(", ")}.`,
    warnings: [],
  };
  if (mode === "warnings") {
    return { ...base, warnings: ["dado faltante: contexto adicional indisponivel no payload"] };
  }
  return base;
}

/**
 * `GeminiPort` fake: determinístico e offline. Para `invalid-json`, retorna um
 * `raw` deliberadamente nao parseavel, simulando saida malformada do modelo.
 */
export class FakeGeminiPort implements GeminiPort {
  private readonly mode: FakeGeminiMode;
  private readonly modelProvider: string;
  private readonly modelName: string;

  constructor(options: FakeGeminiOptions = {}) {
    this.mode = options.mode ?? "success";
    this.modelProvider = options.modelProvider ?? DEFAULT_PROVIDER;
    this.modelName = options.modelName ?? DEFAULT_MODEL;
  }

  generate(input: GeminiGenerateInput): Promise<GeminiGenerateOutput> {
    const raw =
      this.mode === "invalid-json"
        ? "{ esta saida nao e json valido "
        : JSON.stringify(buildOutput(this.mode, input.payload));

    return Promise.resolve({
      raw,
      modelProvider: this.modelProvider,
      modelName: this.modelName,
      tokenInput: input.prompt.length,
      tokenOutput: raw.length,
    });
  }
}
