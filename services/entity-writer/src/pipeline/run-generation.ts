/**
 * run-generation.ts — Orquestracao PURA do core do Entity Writer (Fase 3A).
 *
 * Costura as pecas ja existentes, dirigida por ports (injetaveis), SEM Prisma e
 * SEM Gemini real:
 *   1. resolve o prompt versionado (selectEntityIntroPrompt, injetavel);
 *   2. chama `GeminiPort.generate` (FakeGeminiPort no CI);
 *   3. faz parse seguro do `raw` (JSON invalido -> falha controlada);
 *   4. valida forma (`validateEntityWriterOutput`);
 *   5. valida contra payload (`validateAgainstPayload`, anti-alucinacao);
 *   6. decide status (`decideStatus`) — NUNCA `published`/`human_reviewed`;
 *   7. calcula `input_hash`/`output_hash` e monta `GenerationProvenance`;
 *   8. monta candidatos de `content_blocks` (editorial_intro/cast_intro) — sem
 *      persistir — e um `EntityWriterLogInput` (uma tentativa) compativel com o
 *      schema real de `entity_writer_logs`.
 *
 * Nao toca rede, banco, filesystem (alem do prompt versionado) nem publica.
 */

import {
  validateAgainstPayload,
  validateEntityWriterOutput,
  type EntityWriterOutput,
} from "@screena/schemas";
import type {
  EntityPayload,
  EntityType,
  GenerationProvenance,
  GenerationResult,
  Phase3aBlockType,
  Phase3aLanguageCode,
} from "../types.js";
import type {
  ContentBlockRecord,
  EntityWriterLogInput,
  GeminiGenerateOutput,
  GeminiPort,
} from "../ports.js";
import { hashOutput, hashPayload, sha256Hex } from "../utils/hash.js";
import { selectEntityIntroPrompt, type SelectedPrompt } from "../prompt/select-prompt.js";
import { decideStatus, type StatusDecision } from "./decide-status.js";

/** Entrada da orquestracao. Tudo injetavel para teste; nada de IO escondido. */
export interface RunGenerationInput {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly languageCode: Phase3aLanguageCode;
  readonly payload: EntityPayload;
  readonly gemini: GeminiPort;
  /** Job de `entity_writer_jobs` que originou a tentativa (para o log). */
  readonly jobId: string;
  /** Injetavel; default = selectEntityIntroPrompt (le prompts/entity_intro_pt.md). */
  readonly selectPrompt?: () => SelectedPrompt;
}

/** Resultado da orquestracao: decisao + candidatos (nao persistidos) + log. */
export interface RunGenerationOutcome {
  readonly result: GenerationResult;
  /** 0, 1 ou 2 candidatos (editorial_intro/cast_intro). NUNCA persistidos aqui. */
  readonly blockCandidates: readonly ContentBlockRecord[];
  /** Uma tentativa para `entity_writer_logs` (apenas colunas do schema real). */
  readonly logCandidate: EntityWriterLogInput;
}

/** Campos textuais que viram candidatos a `content_block` na Fase 3A. */
const BLOCK_FIELDS: readonly Phase3aBlockType[] = ["editorial_intro", "cast_intro"];

/** Identidade comum da entidade-alvo (para record e log). */
interface EntityRef {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly languageCode: string;
}

export async function runGeneration(input: RunGenerationInput): Promise<RunGenerationOutcome> {
  const { entityType, entityId, languageCode, payload, gemini, jobId } = input;
  const ref: EntityRef = { entityType, entityId, languageCode };
  const resolvePrompt = input.selectPrompt ?? selectEntityIntroPrompt;

  const { promptVersion, content: prompt } = resolvePrompt();
  const generated = await gemini.generate({ prompt, payload });
  const inputHash = hashPayload(payload);

  // Parse seguro do raw: JSON invalido vira falha controlada (sem candidatos).
  let parsed: unknown;
  try {
    parsed = JSON.parse(generated.raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return controlledFailure({
      ref,
      jobId,
      generated,
      inputHash,
      promptVersion,
      outputHash: sha256Hex(generated.raw),
      errorMessage: `JSON invalido: ${message}`,
    });
  }

  // Forma/tipos invalidos: falha controlada (sem candidatos).
  const form = validateEntityWriterOutput(parsed);
  if (!form.ok) {
    return controlledFailure({
      ref,
      jobId,
      generated,
      inputHash,
      promptVersion,
      outputHash: sha256Hex(generated.raw),
      errorMessage: form.errors.join("; "),
      warnings: form.errors,
    });
  }

  const output = parsed as EntityWriterOutput;
  const { warnings: payloadWarnings } = validateAgainstPayload(payload, output);
  const decision = decideStatus({ form, output, payloadWarnings });

  const provenance: GenerationProvenance = {
    promptVersion,
    modelProvider: generated.modelProvider,
    modelName: generated.modelName,
    inputHash,
    outputHash: hashOutput(output),
  };

  // Candidatos so quando ha bloco util (decision != blocked).
  const blockCandidates =
    decision.reviewStatus === "blocked" ? [] : buildBlockCandidates(ref, output, decision, provenance);

  const logCandidate: EntityWriterLogInput = {
    jobId,
    entityType,
    entityId,
    languageCode,
    modelProvider: generated.modelProvider,
    modelName: generated.modelName,
    promptVersion,
    inputHash,
    outputHash: provenance.outputHash,
    tokenInput: generated.tokenInput,
    tokenOutput: generated.tokenOutput,
    validationStatus: decision.validationStatus,
    warnings: decision.warnings,
  };

  const result: GenerationResult = {
    output,
    warnings: decision.warnings,
    reviewStatus: decision.reviewStatus,
    validationStatus: decision.validationStatus,
    provenance,
  };

  return { result, blockCandidates, logCandidate };
}

/** Monta candidatos de `content_block` a partir dos campos flat presentes. */
function buildBlockCandidates(
  ref: EntityRef,
  output: EntityWriterOutput,
  decision: StatusDecision,
  provenance: GenerationProvenance,
): ContentBlockRecord[] {
  const candidates: ContentBlockRecord[] = [];
  for (const blockType of BLOCK_FIELDS) {
    const content = output[blockType];
    if (typeof content === "string" && content.trim() !== "") {
      candidates.push({
        entityType: ref.entityType,
        entityId: ref.entityId,
        languageCode: ref.languageCode,
        blockType,
        content,
        reviewStatus: decision.reviewStatus,
        provenance,
        warnings: decision.warnings,
      });
    }
  }
  return candidates;
}

/** Parametros de uma falha controlada (JSON invalido ou forma invalida). */
interface ControlledFailureArgs {
  readonly ref: EntityRef;
  readonly jobId: string;
  readonly generated: GeminiGenerateOutput;
  readonly inputHash: string;
  readonly promptVersion: string;
  readonly outputHash: string;
  readonly errorMessage: string;
  /** Warnings adicionais (ex.: erros de forma). Default: [errorMessage]. */
  readonly warnings?: readonly string[];
}

/**
 * Falha controlada: `blocked` + `failed`, sem candidatos, com `errorMessage` no
 * log. Provenance e preenchida (modelo respondeu; o `raw` e que e invalido).
 */
function controlledFailure(args: ControlledFailureArgs): RunGenerationOutcome {
  const { ref, jobId, generated, inputHash, promptVersion, outputHash, errorMessage } = args;
  const warnings = args.warnings ?? [errorMessage];

  const provenance: GenerationProvenance = {
    promptVersion,
    modelProvider: generated.modelProvider,
    modelName: generated.modelName,
    inputHash,
    outputHash,
  };

  const result: GenerationResult = {
    output: { warnings: [...warnings] },
    warnings,
    reviewStatus: "blocked",
    validationStatus: "failed",
    provenance,
  };

  const logCandidate: EntityWriterLogInput = {
    jobId,
    entityType: ref.entityType,
    entityId: ref.entityId,
    languageCode: ref.languageCode,
    modelProvider: generated.modelProvider,
    modelName: generated.modelName,
    promptVersion,
    inputHash,
    outputHash,
    tokenInput: generated.tokenInput,
    tokenOutput: generated.tokenOutput,
    validationStatus: "failed",
    warnings,
    errorMessage,
  };

  return { result, blockCandidates: [], logCandidate };
}
