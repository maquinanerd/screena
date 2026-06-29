/**
 * enqueue-jobs.ts — Orquestracao PURA do enqueue de jobs (Fase 3B.4).
 *
 * Dirigida por ports (injetaveis), SEM Prisma e SEM Gemini: para um alvo, monta
 * o payload controlado (PayloadSourcePort), calcula `payload_hash`, resolve o
 * `prompt_version`, le o estado atual (EnqueueReadPort), decide via `planEnqueue`
 * e — fora de dry-run — cria o job (JobEnqueuePort). NUNCA chama Gemini (nao ha
 * GeminiPort nas deps), NUNCA gera content_block e NUNCA publica.
 *
 * Totalmente testavel com fakes em memoria (zero rede, zero banco). O wiring
 * real (Prisma) vive em ../persistence e bin/enqueue.ts.
 */

import { hashPayload } from "../utils/hash.js";
import { selectEntityIntroPrompt, type SelectedPrompt } from "../prompt/select-prompt.js";
import {
  ENQUEUE_SUPPORTED_ENTITY_TYPES,
  ENQUEUE_SUPPORTED_LANGUAGES,
  planEnqueue,
  type EnqueueSkipReason,
} from "./enqueue-plan.js";
import type {
  EnqueueJobType,
  EnqueueReadPort,
  JobEnqueuePort,
  PayloadSourcePort,
} from "../ports.js";
import type { EntityType } from "../types.js";

/** Dependencias do enqueue (todas injetaveis; nenhuma fala com Gemini). */
export interface EnqueueDeps {
  readonly payloadSource: PayloadSourcePort;
  readonly read: EnqueueReadPort;
  readonly enqueue: JobEnqueuePort;
  /** Injetavel; default = selectEntityIntroPrompt (le o prompt versionado). */
  readonly selectPrompt?: () => SelectedPrompt;
  /** Sink de progresso (default: silencioso). */
  readonly logger?: (message: string) => void;
}

/** Opcoes de uma execucao do enqueue. */
export interface EnqueueOptions {
  /** Modo somente-leitura: decide tudo, mas NAO escreve no banco. */
  readonly dryRun: boolean;
}

/** Pedido de enqueue de UM alvo. */
export interface EnqueueRequest {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly languageCode: string;
  readonly force?: boolean;
}

/** Status de saida do enqueue de um alvo. */
export type EnqueueStatus =
  | "created"
  | "skipped_existing_active_job"
  | "skipped_up_to_date"
  | "skipped_unsupported_entity"
  | "skipped_unsupported_language"
  | "failed";

/** Resultado do enqueue de um alvo. `persisted` indica se houve escrita real. */
export interface EnqueueResult {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly languageCode: string;
  readonly status: EnqueueStatus;
  readonly jobType?: EnqueueJobType;
  /** Id do job criado (so quando `persisted`). */
  readonly jobId?: string;
  readonly payloadHash?: string;
  readonly promptVersion?: string;
  readonly dryRun: boolean;
  readonly persisted: boolean;
  readonly reason?: string;
  readonly error?: string;
}

const NOOP = (): void => undefined;

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Mapeia o motivo de skip do planner para o status de saida. */
function skipStatus(reason: EnqueueSkipReason): EnqueueStatus {
  switch (reason) {
    case "unsupported_language":
      return "skipped_unsupported_language";
    case "unsupported_entity":
      return "skipped_unsupported_entity";
    case "existing_active_job":
      return "skipped_existing_active_job";
    case "up_to_date":
      return "skipped_up_to_date";
  }
}

/**
 * Enfileira (ou decide pular) UM alvo. Nunca lanca: erros viram `failed`
 * controlado. Guarda idioma/entidade ANTES de qualquer IO, para nao montar
 * payload de alvo invalido (ex.: `person`, que o payload source nao suporta).
 */
export async function enqueueOne(
  deps: EnqueueDeps,
  options: EnqueueOptions,
  request: EnqueueRequest,
): Promise<EnqueueResult> {
  const log = deps.logger ?? NOOP;
  const { entityType, entityId, languageCode } = request;
  const base = { entityType, entityId, languageCode, dryRun: options.dryRun };

  // 1. Guardas baratas antes de IO (espelham as regras do planner).
  if (!ENQUEUE_SUPPORTED_LANGUAGES.has(languageCode)) {
    log(`enqueue ${entityType}:${entityId}: idioma fora da fase (${languageCode}).`);
    return { ...base, status: "skipped_unsupported_language", persisted: false, reason: "unsupported_language" };
  }
  if (!ENQUEUE_SUPPORTED_ENTITY_TYPES.has(entityType)) {
    log(`enqueue ${entityType}:${entityId}: entityType nao suportado (so movie/tv).`);
    return { ...base, status: "skipped_unsupported_entity", persisted: false, reason: "unsupported_entity" };
  }

  // 2. Monta o payload controlado. Falha aqui nunca cria job silenciosamente.
  let payloadHash: string;
  let promptVersion: string;
  let existingBlocks: Awaited<ReturnType<EnqueueReadPort["findActiveBlocks"]>>;
  let hasActiveJob: boolean;
  try {
    const payload = await deps.payloadSource.buildPayload({ entityType, entityId, languageCode });
    payloadHash = hashPayload(payload);
    promptVersion = (deps.selectPrompt ?? selectEntityIntroPrompt)().promptVersion;
    const target = { entityType, entityId, languageCode };
    [existingBlocks, hasActiveJob] = await Promise.all([
      deps.read.findActiveBlocks(target),
      deps.read.hasActiveJob(target),
    ]);
  } catch (error) {
    const message = errMessage(error);
    log(`enqueue ${entityType}:${entityId}: falha ao preparar (${message}).`);
    return { ...base, status: "failed", persisted: false, error: message };
  }

  // 3. Decisao pura.
  const plan = planEnqueue({
    entityType,
    languageCode,
    promptVersion,
    inputHash: payloadHash,
    existingBlocks,
    hasActiveJob,
    force: request.force ?? false,
  });

  if (plan.action === "skip") {
    log(`enqueue ${entityType}:${entityId}: pulado (${plan.reason}).`);
    return { ...base, status: skipStatus(plan.reason), persisted: false, payloadHash, promptVersion, reason: plan.reason };
  }

  // 4. Dry-run: reporta a decisao sem escrever nada.
  if (options.dryRun) {
    log(`[dry-run] enqueue ${entityType}:${entityId}: criaria ${plan.jobType} (${plan.reason}).`);
    return {
      ...base,
      status: "created",
      jobType: plan.jobType,
      persisted: false,
      payloadHash,
      promptVersion,
      reason: plan.reason,
    };
  }

  // 5. Cria o job (status='queued' no adapter). Corrida -> skip seguro.
  let inserted: Awaited<ReturnType<JobEnqueuePort["createJob"]>>;
  try {
    inserted = await deps.enqueue.createJob({
      entityType,
      entityId,
      languageCode,
      jobType: plan.jobType,
      payloadHash,
      promptVersion,
    });
  } catch (error) {
    const message = errMessage(error);
    log(`enqueue ${entityType}:${entityId}: falha ao criar job (${message}).`);
    return { ...base, status: "failed", persisted: false, payloadHash, promptVersion, error: message };
  }

  if (!inserted.created) {
    log(`enqueue ${entityType}:${entityId}: job ativo surgiu em corrida — pulado.`);
    return {
      ...base,
      status: "skipped_existing_active_job",
      persisted: false,
      payloadHash,
      promptVersion,
      reason: "race_active_job",
    };
  }

  log(`enqueue ${entityType}:${entityId}: ${plan.jobType} criado (job ${inserted.jobId ?? "?"}).`);
  return {
    ...base,
    status: "created",
    jobType: plan.jobType,
    ...(inserted.jobId !== null ? { jobId: inserted.jobId } : {}),
    persisted: true,
    payloadHash,
    promptVersion,
    reason: plan.reason,
  };
}
