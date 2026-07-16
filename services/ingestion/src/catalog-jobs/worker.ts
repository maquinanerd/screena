/**
 * worker.ts — Loop de execucao da fila de catalogo (Backend A, §1).
 *
 * claim (SKIP LOCKED) -> running -> heartbeat -> handler -> succeeded | retry_wait
 * | dead_letter. Nenhuma regra de negocio aqui: o worker resolve o handler pelo
 * tipo, valida o input e aplica os planos PUROS de transitions.ts.
 *
 * Propriedades:
 *  - concorrencia: N loops independentes; o claim SKIP LOCKED garante exclusao.
 *  - timeout por job: aborta via AbortSignal E vence a corrida (um handler que
 *    ignore o signal nunca trava o worker).
 *  - shutdown gracioso: para de reivindicar e aguarda o que esta em voo.
 *  - falha permanente (input invalido / sem handler / PermanentJobError) vai
 *    DIRETO para dead-letter — nao gasta tentativas de retry.
 *  - logs estruturados com requestId + metricas por ciclo.
 *
 * PURO de IO proprio: relogio, sleep, random e a porta do store sao injetados.
 */

import { CATALOG_METRIC_NAMES, type MetricsSink } from '../metrics/index.js'
import {
  createNoopLogger,
  isPermanentJobError,
  type CatalogJobRegistry,
  type StructuredLogger,
} from './handler.js'
import { planFailure } from './transitions.js'
import type { JobBackoffConfig } from './backoff.js'
import type { CatalogJobStorePort, ClaimedCatalogJob } from './store-port.js'

/** Dependencias do worker (todas injetaveis). */
export interface CatalogWorkerDeps {
  readonly store: CatalogJobStorePort
  readonly registry: CatalogJobRegistry
  readonly metrics: MetricsSink
  readonly log?: StructuredLogger
  readonly now?: () => Date
  readonly random?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  readonly backoff?: JobBackoffConfig
  /** Aborta => para de reivindicar e drena o que esta em voo (shutdown gracioso). */
  readonly shutdownSignal?: AbortSignal
}

/** Opcoes de execucao. */
export interface CatalogWorkerOptions {
  readonly concurrency?: number
  /** Teto de tempo por job; estoura => abort + falha transitoria. */
  readonly jobTimeoutMs?: number
  readonly heartbeatIntervalMs?: number
  /** Teto de jobs processados (piloto/CI). */
  readonly maxJobs?: number
  /** true (default): sai quando a fila esvazia. false: fica pollando. */
  readonly drain?: boolean
  readonly idleSleepMs?: number
  /** Correlaciona todo o ciclo nos logs. */
  readonly runId?: string
}

/** Contagens de um ciclo do worker. */
export interface CatalogWorkerReport {
  readonly claimed: number
  readonly succeeded: number
  readonly retried: number
  readonly deadLettered: number
  readonly failedPermanently: number
}

const DEFAULTS = {
  concurrency: 4,
  jobTimeoutMs: 120_000,
  heartbeatIntervalMs: 15_000,
  drain: true,
  idleSleepMs: 1_000,
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Erro de timeout de job (transitorio: o proximo claim tenta de novo). */
class JobTimeoutError extends Error {
  constructor(ms: number) {
    super(`job excedeu o timeout de ${ms}ms`)
    this.name = 'JobTimeoutError'
  }
}

/** Extrai um codigo/mensagem SEGUROS (sem PII/segredo) de um erro. */
export function toSafeError(error: unknown): { code: string; safe: string } {
  if (error instanceof Error) {
    // `code` e uma propriedade opcional de erros de driver/HTTP; nao esta em Error.
    const maybeCode: unknown = (error as unknown as { code?: unknown }).code
    const code = typeof maybeCode === 'string' && maybeCode.length > 0 ? maybeCode : error.name
    // Primeira linha, truncada: nunca despeja stack/payload no banco.
    const safe = error.message.split('\n')[0]?.slice(0, 200) ?? ''
    return { code: code.slice(0, 80), safe }
  }
  return { code: 'unknown_error', safe: String(error).slice(0, 200) }
}

/**
 * Executa a fila ate drenar (default), atingir `maxJobs` ou receber shutdown.
 * Retorna as contagens do ciclo.
 */
export async function runCatalogWorker(
  deps: CatalogWorkerDeps,
  options: CatalogWorkerOptions = {},
): Promise<CatalogWorkerReport> {
  const log = deps.log ?? createNoopLogger()
  const now = deps.now ?? (() => new Date())
  const random = deps.random ?? Math.random
  const sleep = deps.sleep ?? defaultSleep
  const concurrency = Math.max(1, options.concurrency ?? DEFAULTS.concurrency)
  const jobTimeoutMs = options.jobTimeoutMs ?? DEFAULTS.jobTimeoutMs
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULTS.heartbeatIntervalMs
  const drain = options.drain ?? DEFAULTS.drain
  const idleSleepMs = options.idleSleepMs ?? DEFAULTS.idleSleepMs
  const runId = options.runId ?? 'catalog-worker'

  let claimed = 0
  let succeeded = 0
  let retried = 0
  let deadLettered = 0
  let failedPermanently = 0
  let stopped = false

  const ceilingReached = () => options.maxJobs !== undefined && claimed >= options.maxJobs
  const shuttingDown = () => stopped || deps.shutdownSignal?.aborted === true

  /** Aplica o destino de uma falha (permanente => dead-letter direto). */
  async function handleFailure(job: ClaimedCatalogJob, error: unknown): Promise<void> {
    const safe = toSafeError(error)
    const permanent = isPermanentJobError(error)
    if (permanent) {
      await deps.store.applyFailure(job.id, {
        status: 'dead_letter',
        availableAt: null,
        lastErrorCode: safe.code,
        lastErrorSafe: safe.safe,
      })
      failedPermanently += 1
      deadLettered += 1
      deps.metrics.increment(CATALOG_METRIC_NAMES.jobsFailedTotal, 1, {
        job_type: job.jobType,
        reason: 'permanent',
      })
      deps.metrics.increment(CATALOG_METRIC_NAMES.jobsDeadLetterTotal, 1, { job_type: job.jobType })
      log.log('error', 'catalog_job_permanent_failure', {
        runId,
        jobId: job.id,
        jobType: job.jobType,
        code: safe.code,
      })
      return
    }

    const plan = planFailure(
      { attempts: job.attempts, maxAttempts: job.maxAttempts },
      safe,
      random(),
      deps.backoff,
    )
    const availableAt =
      plan.availableInMs === null ? null : new Date(now().getTime() + plan.availableInMs)
    await deps.store.applyFailure(job.id, {
      status: plan.status,
      availableAt,
      lastErrorCode: plan.lastErrorCode,
      lastErrorSafe: plan.lastErrorSafe,
    })
    deps.metrics.increment(CATALOG_METRIC_NAMES.jobsFailedTotal, 1, {
      job_type: job.jobType,
      reason: 'transient',
    })
    if (plan.status === 'dead_letter') {
      deadLettered += 1
      deps.metrics.increment(CATALOG_METRIC_NAMES.jobsDeadLetterTotal, 1, { job_type: job.jobType })
      log.log('error', 'catalog_job_dead_letter', {
        runId,
        jobId: job.id,
        jobType: job.jobType,
        attempts: job.attempts,
        code: safe.code,
      })
    } else {
      retried += 1
      log.log('warn', 'catalog_job_retry', {
        runId,
        jobId: job.id,
        jobType: job.jobType,
        attempts: job.attempts,
        inMs: plan.availableInMs,
        code: safe.code,
      })
    }
  }

  /** Processa UM job reivindicado do inicio ao fim. */
  async function processJob(job: ClaimedCatalogJob): Promise<void> {
    const startedAt = now().getTime()
    deps.metrics.increment(CATALOG_METRIC_NAMES.jobsTotal, 1, { job_type: job.jobType })

    const handler = deps.registry.get(job.jobType)
    if (handler === undefined) {
      // Sem handler = falha PERMANENTE (nao adianta repetir ate esgotar).
      await deps.store.applyFailure(job.id, {
        status: 'dead_letter',
        availableAt: null,
        lastErrorCode: 'no_handler',
        lastErrorSafe: `nenhum handler registrado para ${job.jobType}`,
      })
      failedPermanently += 1
      deadLettered += 1
      deps.metrics.increment(CATALOG_METRIC_NAMES.jobsDeadLetterTotal, 1, { job_type: job.jobType })
      log.log('error', 'catalog_job_no_handler', { runId, jobId: job.id, jobType: job.jobType })
      return
    }

    const controller = new AbortController()
    const onShutdownAbort = () => controller.abort()
    deps.shutdownSignal?.addEventListener('abort', onShutdownAbort)
    const timeoutHandle = setTimeout(() => controller.abort(), jobTimeoutMs)
    const heartbeatHandle = setInterval(() => {
      void deps.store.heartbeat(job.id).catch(() => {
        /* heartbeat e best-effort: uma falha nao derruba o job */
      })
    }, heartbeatIntervalMs)

    try {
      const input = handler.validateInput(job.payload)
      const context = {
        jobId: job.id,
        requestId: job.runId ?? runId,
        attempt: job.attempts,
        signal: controller.signal,
        heartbeat: () => deps.store.heartbeat(job.id),
        log,
        metrics: deps.metrics,
      }
      // Corrida com o timeout: um handler que ignore o signal nao trava o worker.
      let timeoutReject: (reason: unknown) => void = () => {}
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutReject = reject
      })
      const timeoutFire = setTimeout(
        () => timeoutReject(new JobTimeoutError(jobTimeoutMs)),
        jobTimeoutMs,
      )
      try {
        await Promise.race([handler.execute(context, input as never), timeoutPromise])
      } finally {
        clearTimeout(timeoutFire)
      }

      await deps.store.complete(job.id)
      succeeded += 1
      deps.metrics.observe(
        CATALOG_METRIC_NAMES.syncDurationSeconds,
        (now().getTime() - startedAt) / 1000,
        { job_type: job.jobType },
      )
      log.log('info', 'catalog_job_succeeded', {
        runId,
        jobId: job.id,
        jobType: job.jobType,
        attempt: job.attempts,
      })
    } catch (error) {
      await handleFailure(job, error)
    } finally {
      clearTimeout(timeoutHandle)
      clearInterval(heartbeatHandle)
      deps.shutdownSignal?.removeEventListener('abort', onShutdownAbort)
    }
  }

  /** Um loop de worker: reivindica e processa ate parar. */
  async function loop(): Promise<void> {
    while (!shuttingDown() && !ceilingReached()) {
      const job = await deps.store.claimNext()
      if (job === null) {
        if (drain) return
        await sleep(idleSleepMs)
        continue
      }
      claimed += 1
      log.log('debug', 'catalog_job_claimed', { runId, jobId: job.id, jobType: job.jobType })
      await processJob(job)
    }
  }

  const onShutdown = () => {
    stopped = true
    log.log('info', 'catalog_worker_shutdown_requested', { runId })
  }
  deps.shutdownSignal?.addEventListener('abort', onShutdown)

  try {
    await Promise.all(Array.from({ length: concurrency }, () => loop()))
  } finally {
    deps.shutdownSignal?.removeEventListener('abort', onShutdown)
  }

  log.log('info', 'catalog_worker_finished', { runId, claimed, succeeded, retried, deadLettered })
  return { claimed, succeeded, retried, deadLettered, failedPermanently }
}
