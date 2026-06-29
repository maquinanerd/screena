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

/** Resultado de uma persistencia de bloco: o id REAL do bloco criado. */
export interface ContentBlockSaveResult {
  /** Id do `content_block` recem-criado (BigInt serializado como string). */
  readonly blockId: string;
}

/** Porta de persistencia de `content_blocks` (adapter Prisma). */
export interface ContentBlockStorePort {
  save(record: ContentBlockRecord): Promise<ContentBlockSaveResult>;
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

/** Job reivindicado para processamento (subconjunto de `entity_writer_jobs`). */
export interface ClaimedJob {
  readonly id: string;
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly languageCode: string;
}

/** Opcoes de claim de um job. */
export interface ClaimOptions {
  /** Filtra por idioma (a Fase 3A usa `pt-BR`). */
  readonly languageCode?: string;
  /** Reivindica um job especifico por id (modo `--job-id`). */
  readonly jobId?: string;
  /**
   * Modo somente-leitura: faz "peek" de um job `queued` SEM muta-lo (nao marca
   * `running`/`claimed_at`/`attempts`). Usado pelo `--dry-run`.
   */
  readonly dryRun?: boolean;
}

/**
 * Porta de reivindicacao de jobs de `entity_writer_jobs`. O adapter real usa
 * `FOR UPDATE SKIP LOCKED` para claim concorrente seguro; em `dryRun` apenas le.
 */
export interface JobClaimPort {
  claimNext(options: ClaimOptions): Promise<ClaimedJob | null>;
}

// ============================================================
// Enqueue (Fase 3B.4): criacao de jobs de geracao editorial
// ============================================================

/**
 * Subconjunto de um `content_block` ja existente relevante para decidir enqueue.
 * Strings cruas (sem BigInt/Date) para manter o planner puro e testavel; o
 * adapter Prisma converte ao ler.
 */
export interface ExistingBlockRef {
  /** Tipo do bloco (espelha ContentBlockType; comparado como string). */
  readonly blockType: string;
  /** Estado de revisao (espelha ReviewStatus; comparado como string). */
  readonly reviewStatus: string;
  /** `input_hash` do bloco (hash do payload que o gerou). */
  readonly inputHash: string;
  /** `prompt_version` do bloco. */
  readonly promptVersion: string;
}

/**
 * Porta de LEITURA do estado do alvo para o enqueue. Le SO do banco; nunca cria
 * nada. `findActiveBlocks` retorna blocos nao-arquivados; `hasActiveJob` indica
 * se ha job ativo (`queued`/`claimed`/`running`) para o alvo — em QUALQUER
 * `job_type` (guarda mais estrita que a unique parcial, que e por job_type).
 */
export interface EnqueueReadPort {
  findActiveBlocks(target: BuildPayloadRequest): Promise<readonly ExistingBlockRef[]>;
  hasActiveJob(target: BuildPayloadRequest): Promise<boolean>;
}

/**
 * Tipo de job que o enqueue pode criar. NUNCA `translate_block` nesta fase
 * (en/es ficam de fora). Subconjunto do enum JobType do PostgreSQL.
 */
export type EnqueueJobType = "generate_block" | "regenerate_block";

/**
 * Entrada de criacao de UM job em `entity_writer_jobs` — SOMENTE colunas reais.
 * O adapter grava `status='queued'`; nao existe review_status em jobs. O
 * `payloadHash` vai para `payload_hash` e `promptVersion` para `prompt_version`.
 */
export interface EnqueueJobInput {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly languageCode: string;
  readonly jobType: EnqueueJobType;
  readonly payloadHash: string;
  readonly promptVersion: string;
}

/**
 * Resultado cru de uma insercao de job. `created=false` sinaliza corrida: a
 * unique parcial de job ativo barrou a insercao (outro worker enfileirou antes).
 */
export interface JobInsertResult {
  readonly created: boolean;
  readonly jobId: string | null;
}

/**
 * Porta de criacao de jobs em `entity_writer_jobs` (adapter Prisma). Insere com
 * `status='queued'` e trata a corrida pela unique parcial de job ativo
 * (`entity_writer_jobs_active_unique`), devolvendo `created=false` em vez de lancar.
 */
export interface JobEnqueuePort {
  createJob(input: EnqueueJobInput): Promise<JobInsertResult>;
}
