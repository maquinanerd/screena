/**
 * types.ts — Tipos puros do core da Fase 3A do Entity Writer.
 *
 * Apenas tipos/interfaces: sem rede, sem DB, sem IO, sem logica. Reusa o
 * contrato canonico de @screena/schemas (EntityPayload / EntityWriterOutput)
 * e espelha — sem reescrever o sentido — os enums relevantes do PostgreSQL.
 *
 * WORKER-ONLY: este pacote NUNCA e importado pelo render publico (apps/web).
 */

import type {
  CastMember,
  EntityPayload,
  EntityType,
  EntityWriterOutput,
} from "@screena/schemas";

export type { CastMember, EntityPayload, EntityType, EntityWriterOutput };

/**
 * Blocos que a Fase 3A gera (somente estes dois; os demais ficam para fases
 * futuras). Subconjunto do enum ContentBlockType do PostgreSQL.
 */
export type Phase3aBlockType = "editorial_intro" | "cast_intro";

/**
 * review_status que a Fase 3A pode atribuir a um content_block. NUNCA
 * `published` nem `human_reviewed` — publicacao nao e automatica.
 */
export type Phase3aReviewStatus = "ai_generated" | "needs_review" | "blocked";

/** Resultado da validacao de uma tentativa (espelha o enum ValidationStatus). */
export type ValidationStatus = "passed" | "warnings" | "failed";

/** Estado de um job (espelha o enum JobStatus). */
export type JobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

/** Idioma suportado nesta fase (pt-BR primeiro; en/es nao sao gerados na 3A). */
export type Phase3aLanguageCode = "pt-BR";

/**
 * Requisicao controlada de geracao (um job resolvido para uma entidade e
 * idioma). O `payload` e a UNICA fonte de fatos permitida.
 */
export interface GenerationRequest {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly languageCode: Phase3aLanguageCode;
  readonly payload: EntityPayload;
  readonly promptVersion: string;
}

/**
 * Versionamento obrigatorio de cada bloco/tentativa (invariante 13).
 */
export interface GenerationProvenance {
  readonly promptVersion: string;
  readonly modelProvider: string;
  readonly modelName: string;
  readonly inputHash: string;
  readonly outputHash: string;
}

/**
 * Resultado da geracao + validacao, antes da persistencia: a saida flat, os
 * warnings acumulados, o `review_status` decidido (nunca `published`), o
 * `validation_status` e a proveniencia para versionamento.
 */
export interface GenerationResult {
  readonly output: EntityWriterOutput;
  readonly warnings: readonly string[];
  readonly reviewStatus: Phase3aReviewStatus;
  readonly validationStatus: ValidationStatus;
  readonly provenance: GenerationProvenance;
}
