/**
 * decide-status.ts — Decisao pura de `review_status`/`validation_status`.
 *
 * Funcao pura: recebe o resultado de `validateEntityWriterOutput` (forma/tipos)
 * + os warnings de `validateAgainstPayload` (anti-alucinacao) + a saida, e
 * decide o estado do bloco. NUNCA retorna `published` nem `human_reviewed` —
 * publicacao nao e automatica (invariante 12).
 *
 * Regras:
 *  - forma invalida                 -> blocked  + failed;
 *  - saida valida mas SEM bloco util -> blocked  + failed (saida vazia);
 *  - bloco util COM warnings        -> needs_review + warnings;
 *  - bloco util SEM warnings        -> ai_generated + passed.
 */

import type { EntityWriterOutput, EntityWriterValidationResult } from "@screena/schemas";
import type { Phase3aReviewStatus, ValidationStatus } from "../types.js";

/**
 * Warning emitido quando o modelo retorna saida formalmente valida porem sem
 * nenhum bloco textual geravel (ex.: `{ "warnings": [] }`). A saida NAO deve
 * ser persistida como `content_block`.
 */
export const EMPTY_OUTPUT_WARNING =
  "saida vazia: nenhum bloco textual geravel (editorial_intro/cast_intro ausentes); nao persistir content_block";

/** Entrada da decisao de status. */
export interface DecideStatusInput {
  /** Resultado de `validateEntityWriterOutput` (forma/tipos). */
  readonly form: EntityWriterValidationResult;
  /** Saida do modelo (presente quando a forma e valida). */
  readonly output?: EntityWriterOutput;
  /** Warnings de `validateAgainstPayload` (anti-alucinacao). */
  readonly payloadWarnings: readonly string[];
}

/** Decisao resultante (sempre dentro do subconjunto permitido na Fase 3A). */
export interface StatusDecision {
  readonly reviewStatus: Phase3aReviewStatus;
  readonly validationStatus: ValidationStatus;
  readonly warnings: readonly string[];
}

/** true se ha ao menos um bloco textual nao-vazio (editorial_intro/cast_intro). */
function hasUsefulBlock(output: EntityWriterOutput | undefined): boolean {
  if (!output) {
    return false;
  }
  const editorial = output.editorial_intro?.trim() ?? "";
  const cast = output.cast_intro?.trim() ?? "";
  return editorial !== "" || cast !== "";
}

/** Decide `review_status`/`validation_status` (funcao pura). */
export function decideStatus(input: DecideStatusInput): StatusDecision {
  const { form, output, payloadWarnings } = input;

  // Forma invalida -> bloqueia (nunca publica).
  if (!form.ok) {
    return { reviewStatus: "blocked", validationStatus: "failed", warnings: [...form.errors] };
  }

  // Saida formalmente valida, porem sem bloco util -> bloqueia.
  if (!hasUsefulBlock(output)) {
    const selfWarnings = output?.warnings ?? [];
    return {
      reviewStatus: "blocked",
      validationStatus: "failed",
      warnings: [...selfWarnings, EMPTY_OUTPUT_WARNING],
    };
  }

  // Warnings (auto-reportados pelo modelo + anti-alucinacao) -> revisao humana.
  const aggregated = [...(output?.warnings ?? []), ...payloadWarnings];
  if (aggregated.length > 0) {
    return { reviewStatus: "needs_review", validationStatus: "warnings", warnings: aggregated };
  }

  // Bloco util e sem warnings -> gerado por IA, validacao passou.
  return { reviewStatus: "ai_generated", validationStatus: "passed", warnings: [] };
}
