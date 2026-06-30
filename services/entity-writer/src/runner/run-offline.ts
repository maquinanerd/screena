/**
 * run-offline.ts — Orquestracao PURA do ciclo offline encadeado do Entity Writer.
 *
 * Encadeia, numa unica passada controlada: `enqueueMissing` (descobre faltantes e
 * cria jobs `queued`) seguido de `processJobs` (claim -> payload -> geracao ->
 * persiste blocos/log -> finaliza job). Dirigida por ports (injetaveis), SEM
 * Prisma e SEM Gemini real diretos — 100% testavel com fakes em memoria.
 *
 * Em `dryRun` nada e escrito: o enqueue apenas conta o que CRIARIA e o runner faz
 * "peek" (sem mutar). Gemini e injetado (fake por padrao no bin; real so atras de
 * flag explicita). NUNCA publica nem cria daemon/cron/systemd.
 */

import { enqueueMissing, type EnqueueMissingSummary } from "./enqueue-jobs.js";
import { processJobs, type RunnerSummary } from "./run-jobs.js";
import type {
  ContentBlockStorePort,
  EnqueueCandidateSourcePort,
  EnqueueReadPort,
  EntityWriterJobStorePort,
  EntityWriterLogPort,
  GeminiPort,
  JobClaimPort,
  JobEnqueuePort,
  PayloadSourcePort,
} from "../ports.js";
import type { EntityType } from "../types.js";
import type { SelectedPrompt } from "../prompt/select-prompt.js";

/** Dependencias do ciclo offline: as do enqueue em lote + as do runner. */
export interface RunOfflineDeps {
  // enqueue em lote (faltantes)
  readonly payloadSource: PayloadSourcePort;
  readonly read: EnqueueReadPort;
  readonly enqueue: JobEnqueuePort;
  readonly candidates: EnqueueCandidateSourcePort;
  // runner
  readonly claim: JobClaimPort;
  readonly gemini: GeminiPort;
  readonly contentBlocks: ContentBlockStorePort;
  readonly logs: EntityWriterLogPort;
  readonly jobs: EntityWriterJobStorePort;
  // compartilhado
  readonly selectPrompt?: () => SelectedPrompt;
  readonly logger?: (message: string) => void;
}

/** Opcoes do ciclo offline. */
export interface RunOfflineOptions {
  readonly dryRun: boolean;
  /** Limita os jobs CRIADOS no enqueue e os PROCESSADOS no runner. */
  readonly limit: number;
}

/** Alvo do ciclo offline (tipo + idioma). */
export interface RunOfflineRequest {
  readonly entityType: EntityType;
  readonly languageCode: string;
}

/** Resumo combinado: o do enqueue em lote + o do runner. */
export interface RunOfflineSummary {
  readonly entityType: EntityType;
  readonly languageCode: string;
  readonly limit: number;
  readonly dryRun: boolean;
  readonly enqueue: EnqueueMissingSummary;
  readonly run: RunnerSummary;
}

const NOOP = (): void => undefined;

/**
 * Roda o ciclo offline encadeado: enqueue dos faltantes e, em seguida, o runner.
 * Em `dryRun` nenhuma escrita acontece (enqueue conta o que criaria; runner so
 * faz peek). Nunca publica.
 */
export async function runOffline(
  deps: RunOfflineDeps,
  options: RunOfflineOptions,
  request: RunOfflineRequest,
): Promise<RunOfflineSummary> {
  const log = deps.logger ?? NOOP;
  const promptDep = deps.selectPrompt ? { selectPrompt: deps.selectPrompt } : {};

  log(
    `run-offline ${request.entityType}: 1/2 enqueue missing (limit ${options.limit}` +
      `${options.dryRun ? ", dry-run" : ""})...`,
  );
  const enqueue = await enqueueMissing(
    {
      payloadSource: deps.payloadSource,
      read: deps.read,
      enqueue: deps.enqueue,
      candidates: deps.candidates,
      logger: deps.logger,
      ...promptDep,
    },
    { dryRun: options.dryRun, limit: options.limit },
    request,
  );

  log(
    `run-offline ${request.entityType}: 2/2 runner (limit ${options.limit}` +
      `${options.dryRun ? ", dry-run/peek" : ""})...`,
  );
  const run = await processJobs(
    {
      claim: deps.claim,
      payloadSource: deps.payloadSource,
      gemini: deps.gemini,
      contentBlocks: deps.contentBlocks,
      logs: deps.logs,
      jobs: deps.jobs,
      logger: deps.logger,
      ...promptDep,
    },
    { limit: options.limit, dryRun: options.dryRun },
  );

  return {
    entityType: request.entityType,
    languageCode: request.languageCode,
    limit: options.limit,
    dryRun: options.dryRun,
    enqueue,
    run,
  };
}
