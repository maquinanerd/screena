/**
 * ports.ts — Portas (interfaces) do core da Fase 3A.
 *
 * A orquestracao futura dependera SO destas interfaces — nunca de Prisma, de
 * rede ou de um SDK Gemini concreto. Isso mantem o core puro e testavel com
 * fakes em memoria; os adapters reais (Gemini worker-only, persistencia
 * Prisma, fila) vivem fora do typecheck e fora do render, em fases
 * posteriores.
 *
 * Nenhuma implementacao aqui — apenas contratos.
 */

import type {
  EntityPayload,
  EntityType,
  GenerationProvenance,
  Phase3aBlockType,
  Phase3aReviewStatus,
  ValidationStatus,
} from "./types.js";

/** Entrada para o modelo: prompt versionado + payload controlado. */
export interface GeminiGenerateInput {
  readonly prompt: string;
  readonly payload: EntityPayload;
}

/** Saida crua do modelo (JSON em texto), identidade e uso de tokens. */
export interface GeminiGenerateOutput {
  /** JSON cru retornado pelo modelo; ainda NAO validado. */
  readonly raw: string;
  readonly modelProvider: string;
  readonly modelName: string;
  readonly tokenInput?: number;
  readonly tokenOutput?: number;
}

/**
 * Porta do modelo (Gemini). Real SO atras de adapter worker-only, fora do
 * render; o CI usa um fake deterministico que nunca toca a rede.
 */
export interface GeminiPort {
  generate(input: GeminiGenerateInput): Promise<GeminiGenerateOutput>;
}

/** Identificacao de uma entidade-alvo para montar o payload controlado. */
export interface BuildPayloadRequest {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly languageCode: string;
}

/**
 * Porta que monta o payload controlado a partir do PostgreSQL (adapter
 * futuro). Le SO do banco; nunca chama API externa nem inventa fatos.
 */
export interface PayloadSourcePort {
  buildPayload(request: BuildPayloadRequest): Promise<EntityPayload>;
}

/**
 * Registro versionado a persistir em `content_blocks`. O `reviewStatus` fica
 * restrito ao subconjunto da Fase 3A (nunca `published`/`human_reviewed`).
 */
export interface ContentBlockRecord {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly languageCode: string;
  readonly blockType: Phase3aBlockType;
  readonly content: string;
  readonly reviewStatus: Phase3aReviewStatus;
  readonly provenance: GenerationProvenance;
  readonly warnings: readonly string[];
}

/** Porta de persistencia de `content_blocks` (adapter Prisma futuro). */
export interface ContentBlockStorePort {
  save(record: ContentBlockRecord): Promise<void>;
}

/**
 * Entrada de log de uma tentativa em `entity_writer_logs`. Espelha as colunas
 * REAIS do schema atual — sem `step`, `status`, `latency_ms` nem `block_type`
 * (estes nao existem nessa tabela; `block_type` pertence a `content_blocks`).
 */
export interface EntityWriterLogInput {
  readonly jobId: string;
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly languageCode: string;
  readonly modelProvider?: string;
  readonly modelName?: string;
  readonly promptVersion?: string;
  readonly inputHash?: string;
  readonly outputHash?: string;
  readonly tokenInput?: number;
  readonly tokenOutput?: number;
  readonly validationStatus?: ValidationStatus;
  readonly warnings?: readonly string[];
  readonly errorMessage?: string;
}

/** Porta de log do Entity Writer: uma linha por tentativa de geracao/validacao. */
export interface EntityWriterLogPort {
  write(input: EntityWriterLogInput): Promise<void>;
}

/**
 * Estados terminais que o writer atribui a um job ao finalizar uma tentativa.
 * Subconjunto do enum JobStatus (queued/claimed/running sao da fase de claim).
 */
export type JobTerminalStatus = "completed" | "failed" | "blocked";

/** Entrada para finalizar um job em `entity_writer_jobs` (campos reais do schema). */
export interface JobCompletionInput {
  readonly jobId: string;
  readonly status: JobTerminalStatus;
  /** Bloco resultante (quando houve insert); vira `result_block_id`. */
  readonly resultBlockId?: string | null;
  /** Mensagem de erro/bloqueio; vira `last_error`. */
  readonly lastError?: string | null;
}

/**
 * Porta de atualizacao de `entity_writer_jobs` (adapter Prisma futuro). So
 * marca o estado terminal de um job — claim/enfileiramento ficam fora.
 */
export interface EntityWriterJobStorePort {
  finishJob(input: JobCompletionInput): Promise<void>;
}
