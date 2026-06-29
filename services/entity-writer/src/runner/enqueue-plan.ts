/**
 * enqueue-plan.ts — Decisao PURA de enqueue de jobs do Entity Writer (Fase 3B.4).
 *
 * Recebe o estado ja coletado de um alvo (blocos ativos + se ha job ativo) e
 * decide, sem nenhum IO, se um job de geracao editorial deve ser criado. Nao
 * toca banco, rede, Gemini, relogio nem BigInt — so dados puros. O adapter
 * Prisma (`../persistence/job-enqueue.ts`) e o orquestrador
 * (`./enqueue-jobs.ts`) executam esta decisao.
 *
 * Regras (nesta ordem de precedencia):
 *  1. idioma fora de pt-BR              -> skip `unsupported_language` (en/es fora);
 *  2. entityType nao suportado (so movie/tv) -> skip `unsupported_entity`;
 *  3. ja existe job ativo para o alvo   -> skip `existing_active_job` (vence o force);
 *  4. blocos atualizados e sem `force`  -> skip `up_to_date`;
 *  5. caso contrario                    -> create (generate/regenerate).
 *
 * NUNCA decide publicacao: o resultado e apenas criar/pular job `queued`; nao ha
 * `published`/`human_reviewed` aqui (jobs nem tem review_status).
 */

import type { EntityType } from "../types.js";
import type { EnqueueJobType, ExistingBlockRef } from "../ports.js";

/** Idiomas que o enqueue processa nesta fase (pt-BR primeiro; en/es fora). */
export const ENQUEUE_SUPPORTED_LANGUAGES: ReadonlySet<string> = new Set(["pt-BR"]);

/** Tipos de entidade cujo payload o Entity Writer sabe montar (so movie/tv). */
export const ENQUEUE_SUPPORTED_ENTITY_TYPES: ReadonlySet<EntityType> = new Set(["movie", "tv"]);

/**
 * Blocos editoriais alvo desta fase. Espelha `BLOCK_FIELDS` de
 * `../pipeline/run-generation.ts` (`editorial_intro`/`cast_intro`): sao os
 * unicos blocos que a geracao produz hoje, logo os unicos que contam para
 * decidir "faltam blocos".
 */
export const ENQUEUE_TARGET_BLOCK_TYPES = ["editorial_intro", "cast_intro"] as const;

/** Estado de bloco arquivado (nunca conta como bloco vivo/atual). */
const ARCHIVED = "archived";

/** Entrada da decisao de enqueue (tudo ja coletado; nada de IO aqui). */
export interface EnqueuePlanInput {
  readonly entityType: EntityType;
  readonly languageCode: string;
  /** Versao do prompt resolvido (comparada com a dos blocos existentes). */
  readonly promptVersion: string;
  /** Hash do payload controlado (comparado com `input_hash` dos blocos). */
  readonly inputHash: string;
  /** Blocos NAO arquivados ja existentes para o alvo. */
  readonly existingBlocks: readonly ExistingBlockRef[];
  /** true se ha job ativo (queued/claimed/running) para o alvo. */
  readonly hasActiveJob: boolean;
  /** Forca recriacao mesmo com blocos atualizados (ainda respeita job ativo). */
  readonly force?: boolean;
}

/** Motivos pelos quais o enqueue PULA a criacao de job. */
export type EnqueueSkipReason =
  | "unsupported_language"
  | "unsupported_entity"
  | "existing_active_job"
  | "up_to_date";

/** Motivos pelos quais o enqueue CRIA job. */
export type EnqueueCreateReason = "missing_blocks" | "forced";

/** Decisao do planner: criar (com job_type) ou pular (com motivo). */
export type EnqueuePlan =
  | { readonly action: "create"; readonly jobType: EnqueueJobType; readonly reason: EnqueueCreateReason }
  | { readonly action: "skip"; readonly reason: EnqueueSkipReason };

/** true se o bloco e a versao atual e compativel com prompt/payload correntes. */
function isCurrentBlock(block: ExistingBlockRef, inputHash: string, promptVersion: string): boolean {
  return (
    block.reviewStatus !== ARCHIVED &&
    block.inputHash === inputHash &&
    block.promptVersion === promptVersion
  );
}

/** true se TODOS os blocos-alvo ja existem atualizados (mesmo input/prompt). */
function isUpToDate(
  blocks: readonly ExistingBlockRef[],
  inputHash: string,
  promptVersion: string,
): boolean {
  return ENQUEUE_TARGET_BLOCK_TYPES.every((blockType) =>
    blocks.some((block) => block.blockType === blockType && isCurrentBlock(block, inputHash, promptVersion)),
  );
}

/** true se ha qualquer bloco-alvo vivo (nao arquivado) — define regenerate vs generate. */
function hasAnyLiveTargetBlock(blocks: readonly ExistingBlockRef[]): boolean {
  const targets = new Set<string>(ENQUEUE_TARGET_BLOCK_TYPES);
  return blocks.some((block) => targets.has(block.blockType) && block.reviewStatus !== ARCHIVED);
}

/** Decide se um job deve ser criado para o alvo (funcao pura). */
export function planEnqueue(input: EnqueuePlanInput): EnqueuePlan {
  if (!ENQUEUE_SUPPORTED_LANGUAGES.has(input.languageCode)) {
    return { action: "skip", reason: "unsupported_language" };
  }
  if (!ENQUEUE_SUPPORTED_ENTITY_TYPES.has(input.entityType)) {
    return { action: "skip", reason: "unsupported_entity" };
  }
  // Job ativo vence ate o `force`: nunca duplicamos trabalho ja enfileirado.
  if (input.hasActiveJob) {
    return { action: "skip", reason: "existing_active_job" };
  }

  const force = input.force ?? false;
  const upToDate = isUpToDate(input.existingBlocks, input.inputHash, input.promptVersion);
  if (upToDate && !force) {
    return { action: "skip", reason: "up_to_date" };
  }

  // Ha bloco vivo do alvo -> regeneracao; senao -> geracao do zero.
  const jobType: EnqueueJobType = hasAnyLiveTargetBlock(input.existingBlocks)
    ? "regenerate_block"
    : "generate_block";
  const reason: EnqueueCreateReason = upToDate && force ? "forced" : "missing_blocks";
  return { action: "create", jobType, reason };
}
