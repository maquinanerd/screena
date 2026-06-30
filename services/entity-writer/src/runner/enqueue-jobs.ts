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
  EnqueueCandidateSourcePort,
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

// ============================================================
// Enqueue em lote (Fase 3B.5): `--missing` controlado
// ============================================================

/** Dependencias do enqueue em lote: as de `enqueueOne` + descoberta de candidatos. */
export interface EnqueueMissingDeps extends EnqueueDeps {
  readonly candidates: EnqueueCandidateSourcePort;
}

/** Opcoes de uma execucao de enqueue em lote. */
export interface EnqueueMissingOptions {
  /** Modo somente-leitura: decide tudo, mas NAO escreve no banco. */
  readonly dryRun: boolean;
  /** Maximo de jobs a CRIAR (em dry-run, jobs que SERIAM criados). */
  readonly limit: number;
  /**
   * Teto de seguranca de candidatos AVALIADOS — evita varredura ilimitada quando
   * quase tudo ja esta atualizado. Default: `max(limit * 20, limit)`.
   */
  readonly maxEvaluated?: number;
}

/** Pedido de enqueue em lote para um tipo/idioma. */
export interface EnqueueMissingRequest {
  readonly entityType: EntityType;
  readonly languageCode: string;
}

/**
 * Resumo agregado de um enqueue em lote. So contadores e ids de job — NUNCA
 * payload, prompt ou segredo.
 */
export interface EnqueueMissingSummary {
  readonly entityType: EntityType;
  readonly languageCode: string;
  readonly limit: number;
  readonly dryRun: boolean;
  /** Candidatos efetivamente avaliados pelo planner. */
  readonly evaluated: number;
  /** Jobs criados (em dry-run: que seriam criados). */
  readonly created: number;
  readonly skippedExistingActiveJob: number;
  readonly skippedUpToDate: number;
  readonly skippedUnsupportedEntity: number;
  readonly skippedUnsupportedLanguage: number;
  readonly failed: number;
  /** Ids dos jobs criados (vazio em dry-run). */
  readonly createdJobIds: readonly string[];
  /** true se a descoberta esgotou os candidatos antes de atingir `limit`. */
  readonly exhausted: boolean;
  /** true se parou pelo teto de seguranca de candidatos avaliados. */
  readonly hitEvaluationCap: boolean;
}

/** Teto rigido de pagina de descoberta por iteracao. */
const DISCOVERY_PAGE_CAP = 100;

/**
 * Enfileira (ou decide pular) os alvos FALTANTES de um tipo/idioma, em lote
 * controlado. Descobre candidatos basicos por id ASC (cursor), e para cada um
 * reusa `enqueueOne` — o MESMO planner anti-duplicidade: pula job ativo e
 * up-to-date, cria so o que falta. NUNCA chama Gemini (sem GeminiPort nas deps),
 * NUNCA roda o runner e NUNCA publica.
 *
 * `limit` limita os jobs CRIADOS (em dry-run, os que seriam criados); a varredura
 * tambem respeita um teto de candidatos AVALIADOS (`maxEvaluated`), reportado no
 * resumo, para nunca varrer a tabela inteira sem limite.
 */
export async function enqueueMissing(
  deps: EnqueueMissingDeps,
  options: EnqueueMissingOptions,
  request: EnqueueMissingRequest,
): Promise<EnqueueMissingSummary> {
  const log = deps.logger ?? NOOP;
  const { entityType, languageCode } = request;
  const limit = Math.max(0, Math.floor(options.limit));

  const tally = {
    evaluated: 0,
    created: 0,
    skippedExistingActiveJob: 0,
    skippedUpToDate: 0,
    skippedUnsupportedEntity: 0,
    skippedUnsupportedLanguage: 0,
    failed: 0,
  };
  const createdJobIds: string[] = [];
  const summary = (exhausted: boolean, hitEvaluationCap: boolean): EnqueueMissingSummary => ({
    entityType,
    languageCode,
    limit,
    dryRun: options.dryRun,
    ...tally,
    createdJobIds,
    exhausted,
    hitEvaluationCap,
  });

  // Guarda barata de tipo/idioma ANTES de qualquer IO (espelha o planner). Em
  // ambos os casos nao ha o que descobrir: a descoberta nem e chamada.
  if (!ENQUEUE_SUPPORTED_LANGUAGES.has(languageCode)) {
    log(`enqueue missing: idioma fora da fase (${languageCode}).`);
    return summary(true, false);
  }
  if (!ENQUEUE_SUPPORTED_ENTITY_TYPES.has(entityType)) {
    log(`enqueue missing: entityType nao suportado (${entityType}; so movie/tv).`);
    return summary(true, false);
  }
  if (limit === 0) {
    return summary(true, false);
  }

  const maxEvaluated = Math.max(options.maxEvaluated ?? limit * 20, limit);
  const pageSize = Math.min(Math.max(limit, 1), DISCOVERY_PAGE_CAP);
  // enqueueOne nao precisa do logger nem da porta de candidatos: deps limpa e silenciosa.
  const singleDeps: EnqueueDeps = {
    payloadSource: deps.payloadSource,
    read: deps.read,
    enqueue: deps.enqueue,
    ...(deps.selectPrompt ? { selectPrompt: deps.selectPrompt } : {}),
  };

  let afterId: string | undefined;
  let exhausted = false;
  let hitEvaluationCap = false;

  while (tally.created < limit) {
    const ids = await deps.candidates.findCandidates({ entityType, limit: pageSize, afterId });
    if (ids.length === 0) {
      exhausted = true;
      break;
    }

    for (const entityId of ids) {
      if (tally.created >= limit) break;
      if (tally.evaluated >= maxEvaluated) {
        hitEvaluationCap = true;
        break;
      }
      tally.evaluated += 1;
      afterId = entityId; // cursor avanca mesmo em skip (nunca reavalia o mesmo id)

      const result = await enqueueOne(singleDeps, { dryRun: options.dryRun }, { entityType, entityId, languageCode });
      switch (result.status) {
        case "created":
          tally.created += 1;
          if (result.jobId !== undefined) createdJobIds.push(result.jobId);
          break;
        case "skipped_existing_active_job":
          tally.skippedExistingActiveJob += 1;
          break;
        case "skipped_up_to_date":
          tally.skippedUpToDate += 1;
          break;
        case "skipped_unsupported_entity":
          tally.skippedUnsupportedEntity += 1;
          break;
        case "skipped_unsupported_language":
          tally.skippedUnsupportedLanguage += 1;
          break;
        case "failed":
          tally.failed += 1;
          break;
      }
    }

    if (hitEvaluationCap) break;
    if (ids.length < pageSize) {
      exhausted = true;
      break;
    }
  }

  log(
    `enqueue missing ${entityType}: ${tally.created} criado(s), ${tally.evaluated} avaliado(s)` +
      `${options.dryRun ? " (dry-run)" : ""}.`,
  );
  return summary(exhausted, hitEvaluationCap);
}
