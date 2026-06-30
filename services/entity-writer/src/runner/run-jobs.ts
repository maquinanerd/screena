/**
 * run-jobs.ts — Orquestracao PURA do runner offline do Entity Writer.
 *
 * Dirigida por ports (injetaveis), SEM Prisma e SEM Gemini real diretos: para
 * cada job reivindicado, monta payload (PayloadSourcePort), gera (runGeneration),
 * e — fora de dry-run — persiste blocos/log e finaliza o job. Em dry-run NAO
 * muta o banco (claim faz "peek") e nunca persiste. NUNCA produz `published`
 * nem `human_reviewed`; estados terminais de job sao `completed`/`blocked`/`failed`.
 *
 * Totalmente testavel com fakes em memoria (zero rede, zero banco). O wiring
 * real (Prisma + Gemini real/fake) vive em ../persistence e bin/run.ts.
 */

import { runGeneration, type RunGenerationOutcome } from "../pipeline/run-generation.js";
import type {
  ClaimedJob,
  ContentBlockStorePort,
  EntityWriterJobStorePort,
  EntityWriterLogInput,
  EntityWriterLogPort,
  GeminiPort,
  JobClaimPort,
  PayloadSourcePort,
} from "../ports.js";
import type { EntityPayload } from "../types.js";
import type { SelectedPrompt } from "../prompt/select-prompt.js";

/** Idioma suportado na Fase 3A (pt-BR primeiro; en/es ficam de fora). */
const SUPPORTED_LANGUAGE = "pt-BR";

/** Dependencias do runner (todas injetaveis para teste). */
export interface RunnerDeps {
  readonly claim: JobClaimPort;
  readonly payloadSource: PayloadSourcePort;
  readonly gemini: GeminiPort;
  readonly contentBlocks: ContentBlockStorePort;
  readonly logs: EntityWriterLogPort;
  readonly jobs: EntityWriterJobStorePort;
  /** Injetavel; default = selectEntityIntroPrompt (usado por runGeneration). */
  readonly selectPrompt?: () => SelectedPrompt;
  /** Sink de progresso (default: silencioso). Nunca recebe a API key. */
  readonly logger?: (message: string) => void;
}

/** Opcoes de uma execucao do runner. */
export interface RunnerOptions {
  readonly limit: number;
  readonly dryRun: boolean;
  readonly jobId?: string;
}

/** Resultado de UM job processado. */
export interface JobReport {
  readonly jobId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly languageCode: string;
  readonly outcome: "succeeded" | "needs_review" | "blocked" | "failed" | "dry-run";
  readonly reviewStatus?: string;
  readonly blockCount: number;
  readonly warningCount: number;
  /** Id do bloco apontado pelo job (quando houve bloco criado). */
  readonly resultBlockId?: string;
  readonly error?: string;
}

/** Resumo de uma execucao do runner. */
export interface RunnerSummary {
  readonly dryRun: boolean;
  readonly claimed: number;
  readonly persisted: number;
  readonly jobs: readonly JobReport[];
}

const NOOP = (): void => undefined;

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Processa ate `limit` jobs (1 se `--job-id`). Retorna um resumo seguro. */
export async function processJobs(
  deps: RunnerDeps,
  options: RunnerOptions,
): Promise<RunnerSummary> {
  const log = deps.logger ?? NOOP;
  const reports: JobReport[] = [];
  const effectiveLimit = options.jobId !== undefined ? 1 : Math.max(0, options.limit);
  let claimed = 0;
  let persisted = 0;

  for (let i = 0; i < effectiveLimit; i += 1) {
    const job = await deps.claim.claimNext({
      jobId: options.jobId,
      languageCode: SUPPORTED_LANGUAGE,
      dryRun: options.dryRun,
    });
    if (job === null) break;
    claimed += 1;

    const report = await processOne(deps, options, job, log);
    if (!options.dryRun && report.outcome !== "dry-run") persisted += 1;
    reports.push(report);
  }

  log(`runner: ${claimed} job(s) reivindicado(s), ${reports.length} processado(s)${options.dryRun ? " (dry-run)" : ""}.`);
  return { dryRun: options.dryRun, claimed, persisted, jobs: reports };
}

async function processOne(
  deps: RunnerDeps,
  options: RunnerOptions,
  job: ClaimedJob,
  log: (message: string) => void,
): Promise<JobReport> {
  const base = {
    jobId: job.id,
    entityType: job.entityType,
    entityId: job.entityId,
    languageCode: job.languageCode,
  };

  // 1. Guarda de idioma: Fase 3A so processa pt-BR (en/es fora de escopo).
  if (job.languageCode !== SUPPORTED_LANGUAGE) {
    return failJob(deps, options, base, "blocked", `idioma fora da Fase 3A (pt-BR): ${job.languageCode}`, log);
  }

  // 2. Monta o payload controlado a partir do banco.
  let payload: EntityPayload;
  try {
    payload = await deps.payloadSource.buildPayload({
      entityType: job.entityType,
      entityId: job.entityId,
      languageCode: job.languageCode,
    });
  } catch (error) {
    return failJob(deps, options, base, "blocked", `payload indisponivel: ${errMessage(error)}`, log);
  }

  // 3. Geracao (parse/validacao/decisao). Erro tecnico do modelo propaga aqui.
  let outcome: RunGenerationOutcome;
  try {
    outcome = await runGeneration({
      entityType: job.entityType,
      entityId: job.entityId,
      languageCode: SUPPORTED_LANGUAGE,
      payload,
      gemini: deps.gemini,
      jobId: job.id,
      ...(deps.selectPrompt ? { selectPrompt: deps.selectPrompt } : {}),
    });
  } catch (error) {
    // Erro tecnico (ex.: GeminiHttpError/timeout/config). A mensagem do adapter
    // nunca contem a chave (garantido/testado na 3B.2). Falha controlada.
    return failJob(deps, options, base, "failed", `erro tecnico de geracao: ${errMessage(error)}`, log);
  }

  const reviewStatus = outcome.result.reviewStatus;
  const blockCount = outcome.blockCandidates.length;
  const warningCount = outcome.result.warnings.length;

  // 4. Dry-run: resumo seguro, sem nenhuma escrita no banco.
  if (options.dryRun) {
    log(`[dry-run] job ${job.id}: ${reviewStatus}, ${blockCount} bloco(s), ${warningCount} warning(s) — NAO persistido.`);
    return { ...base, outcome: "dry-run", reviewStatus, blockCount, warningCount };
  }

  // 5. Persiste blocos + log (fora de dry-run). Coleta os ids reais criados.
  const createdBlocks: { blockType: string; blockId: string }[] = [];
  try {
    for (const candidate of outcome.blockCandidates) {
      const { blockId } = await deps.contentBlocks.save(candidate);
      createdBlocks.push({ blockType: candidate.blockType, blockId });
    }
    await deps.logs.write(outcome.logCandidate);
  } catch (error) {
    return failJob(deps, options, base, "failed", `erro de persistencia: ${errMessage(error)}`, log);
  }

  // 6. Finaliza o job apontando para o bloco criado (nunca published/human_reviewed).
  const isBlocked = reviewStatus === "blocked";
  const status = isBlocked ? "blocked" : "completed";
  const lastError = isBlocked ? (outcome.result.warnings[0] ?? "saida bloqueada") : null;
  const resultBlockId = pickResultBlockId(createdBlocks);
  await deps.jobs.finishJob({ jobId: job.id, status, resultBlockId, lastError });

  const outcomeLabel = isBlocked ? "blocked" : reviewStatus === "needs_review" ? "needs_review" : "succeeded";
  log(`job ${job.id}: ${outcomeLabel} (${blockCount} bloco(s), ${warningCount} warning(s)).`);
  return {
    ...base,
    outcome: outcomeLabel,
    reviewStatus,
    blockCount,
    warningCount,
    ...(resultBlockId !== null ? { resultBlockId } : {}),
    ...(isBlocked && lastError ? { error: lastError } : {}),
  };
}

/**
 * Escolhe o `result_block_id` do job: prefere o bloco `editorial_intro`; senao o
 * primeiro bloco criado; se nada foi criado (ex.: blocked), retorna `null`.
 */
function pickResultBlockId(
  created: readonly { blockType: string; blockId: string }[],
): string | null {
  const editorial = created.find((block) => block.blockType === "editorial_intro");
  if (editorial) return editorial.blockId;
  return created[0]?.blockId ?? null;
}

/**
 * Caminho de falha controlada (idioma/payload/tecnico/persistencia). Fora de
 * dry-run, registra uma tentativa em `entity_writer_logs` (best-effort) e
 * finaliza o job com o estado terminal. Nunca engole o erro: ele vai ao report
 * e ao logger.
 */
async function failJob(
  deps: RunnerDeps,
  options: RunnerOptions,
  base: { jobId: string; entityType: ClaimedJob["entityType"]; entityId: string; languageCode: string },
  status: "blocked" | "failed",
  reason: string,
  log: (message: string) => void,
): Promise<JobReport> {
  log(`job ${base.jobId}: ${status} — ${reason}`);

  if (!options.dryRun) {
    const logInput: EntityWriterLogInput = {
      jobId: base.jobId,
      entityType: base.entityType,
      entityId: base.entityId,
      languageCode: base.languageCode,
      validationStatus: "failed",
      warnings: [reason],
      errorMessage: reason,
    };
    try {
      await deps.logs.write(logInput);
    } catch (error) {
      // Log do log: nao mascara, mas tambem nao derruba o runner.
      log(`job ${base.jobId}: falha ao gravar log da tentativa — ${errMessage(error)}`);
    }
    try {
      await deps.jobs.finishJob({ jobId: base.jobId, status, resultBlockId: null, lastError: reason });
    } catch (error) {
      log(`job ${base.jobId}: falha ao finalizar job — ${errMessage(error)}`);
    }
  }

  return { ...base, outcome: status, blockCount: 0, warningCount: 1, error: reason };
}
