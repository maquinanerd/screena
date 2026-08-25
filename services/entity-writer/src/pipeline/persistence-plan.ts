/**
 * persistence-plan.ts — Logica PURA de persistencia do Entity Writer.
 *
 * Mapeia os artefatos do core (ContentBlockRecord / EntityWriterLogInput /
 * JobCompletionInput) para as formas de escrita das tabelas reais, e decide a
 * estrategia de regeneracao (archive + insert). NAO toca Prisma, banco, rede,
 * relogio nem BigInt — so dados puros (strings/numeros/flags). Os adapters em
 * `../persistence/*` executam estes planos contra o
 * PostgreSQL, convertendo para BigInt/Json/Date.
 *
 * Aqui mora a regra testavel; o IO fica fino e isolado.
 */

import type { ContentBlockRecord, EntityWriterLogInput, JobCompletionInput } from "../ports.js";
import type {
  EntityType,
  Phase3aBlockType,
  Phase3aReviewStatus,
  ValidationStatus,
} from "../types.js";

/**
 * `source_type` que a IA pode arquivar automaticamente. SO `ai`: blocos
 * `human` ou `hybrid` carregam decisao humana e NUNCA sao arquivados pelo
 * writer, mesmo em `needs_review`.
 */
const ARCHIVABLE_SOURCE_TYPE = "ai";

/**
 * Estados que a IA "possui" e pode arquivar ao regenerar — combinados com
 * `source_type = ai`. Versoes `human_reviewed`/`published` sao decisao humana e
 * NUNCA sao arquivadas automaticamente; `blocked`/`archived` ja nao sao ativas.
 */
const AI_OWNED_ACTIVE_STATES: ReadonlySet<string> = new Set(["ai_generated", "needs_review"]);

/**
 * Decide se um bloco existente e substituivel automaticamente pela IA: precisa
 * ser `source_type = ai` E estar num estado ativo de IA
 * (`ai_generated`/`needs_review`). Qualquer outra combinacao e preservada.
 */
function isAiArchivable(block: ExistingBlock): boolean {
  return block.sourceType === ARCHIVABLE_SOURCE_TYPE && AI_OWNED_ACTIVE_STATES.has(block.reviewStatus);
}

/** Estados que o writer JAMAIS pode persistir (publicacao nao e automatica). */
const FORBIDDEN_WRITE_STATES: ReadonlySet<string> = new Set(["published", "human_reviewed"]);

/**
 * Forma de criacao de uma linha em `content_blocks` (colunas reais; `entityId`
 * permanece string — o adapter converte para BigInt). `published_at` nasce nulo
 * e `id`/`created_at`/`updated_at` sao gerenciados pelo banco.
 */
export interface ContentBlockCreateData {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly languageCode: string;
  readonly blockType: Phase3aBlockType;
  readonly content: string;
  readonly sourceType: "ai";
  readonly modelProvider: string;
  readonly modelName: string;
  readonly promptVersion: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly reviewStatus: Phase3aReviewStatus;
  /** Serializado em `warnings_json` pelo adapter. */
  readonly warnings: readonly string[];
}

/** Referencia minima de um bloco ja existente para o alvo (para decidir archive). */
export interface ExistingBlock {
  readonly id: string;
  readonly reviewStatus: string;
  /** Origem do bloco (`ai`/`human`/`hybrid`); so `ai` e arquivavel automaticamente. */
  readonly sourceType: string;
}

/** Plano de persistencia de UM bloco: arquivar versoes ativas + inserir a nova. */
export interface BlockPersistencePlan {
  readonly archiveBlockIds: readonly string[];
  readonly create: ContentBlockCreateData;
}

/** Mapeia um `ContentBlockRecord` para a forma de criacao (colunas reais). */
function toCreateData(record: ContentBlockRecord): ContentBlockCreateData {
  if (FORBIDDEN_WRITE_STATES.has(record.reviewStatus as string)) {
    throw new Error(
      `review_status proibido na Fase 3A: ${record.reviewStatus} (publicacao nunca e automatica).`,
    );
  }
  return {
    entityType: record.entityType,
    entityId: record.entityId,
    languageCode: record.languageCode,
    blockType: record.blockType,
    content: record.content,
    sourceType: "ai",
    modelProvider: record.provenance.modelProvider,
    modelName: record.provenance.modelName,
    promptVersion: record.provenance.promptVersion,
    inputHash: record.provenance.inputHash,
    outputHash: record.provenance.outputHash,
    reviewStatus: record.reviewStatus,
    warnings: record.warnings,
  };
}

/**
 * Decide o plano de regeneracao para um bloco: arquiva as versoes ATIVAS de IA
 * (`source_type = ai` E `ai_generated`/`needs_review`) do mesmo alvo e insere a
 * nova versao. Nunca apaga fisicamente; nunca arquiva bloco `human`/`hybrid`
 * nem versao revisada/publicada por humano.
 */
export function planBlockPersistence(
  existing: readonly ExistingBlock[],
  candidate: ContentBlockRecord,
): BlockPersistencePlan {
  const create = toCreateData(candidate);
  const archiveBlockIds = existing.filter(isAiArchivable).map((block) => block.id);
  return { archiveBlockIds, create };
}

/**
 * Forma de criacao de uma linha em `entity_writer_logs` — SOMENTE colunas reais
 * do schema. NAO existem `step`, `status`, `latency_ms` nem `block_type` aqui.
 */
export interface EntityWriterLogCreateData {
  readonly jobId: string;
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly languageCode: string;
  readonly modelProvider: string | null;
  readonly modelName: string | null;
  readonly promptVersion: string | null;
  readonly inputHash: string | null;
  readonly outputHash: string | null;
  readonly tokenInput: number | null;
  readonly tokenOutput: number | null;
  readonly validationStatus: ValidationStatus | null;
  /** Serializado em `warnings_json` pelo adapter. */
  readonly warnings: readonly string[];
  readonly errorMessage: string | null;
}

/** Mapeia uma tentativa para a forma de criacao do log (opcionais -> null). */
export function planLog(input: EntityWriterLogInput): EntityWriterLogCreateData {
  return {
    jobId: input.jobId,
    entityType: input.entityType,
    entityId: input.entityId,
    languageCode: input.languageCode,
    modelProvider: input.modelProvider ?? null,
    modelName: input.modelName ?? null,
    promptVersion: input.promptVersion ?? null,
    inputHash: input.inputHash ?? null,
    outputHash: input.outputHash ?? null,
    tokenInput: input.tokenInput ?? null,
    tokenOutput: input.tokenOutput ?? null,
    validationStatus: input.validationStatus ?? null,
    warnings: input.warnings ?? [],
    errorMessage: input.errorMessage ?? null,
  };
}

/** Forma de atualizacao de `entity_writer_jobs` ao finalizar (colunas reais). */
export interface JobUpdateData {
  readonly status: JobCompletionInput["status"];
  /** O adapter carimba `completed_at = now()` quando true (estado terminal). */
  readonly setCompletedAt: boolean;
  readonly resultBlockId: string | null;
  readonly lastError: string | null;
}

/**
 * Mapeia a finalizacao de um job para a forma de update. `completed`/`blocked`
 * sao terminais (carimba `completed_at`); `failed` fica sem carimbo (retentavel).
 */
export function planJobUpdate(input: JobCompletionInput): JobUpdateData {
  const terminal = input.status === "completed" || input.status === "blocked";
  return {
    status: input.status,
    setCompletedAt: terminal,
    resultBlockId: input.resultBlockId ?? null,
    lastError: input.lastError ?? null,
  };
}
