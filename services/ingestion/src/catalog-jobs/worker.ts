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
 *  - erro do STORE (o banco da propria fila) no modo servico (`drain: false`) nao
 *    derruba o processo: loga, espera e tenta de novo. No modo `drain` (CLI/CI)
 *    continua subindo, como sempre.
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
import { redactSecrets } from '../cli/exit.js'
import { clampSafeText, errorMessageWithCauses, flattenErrorText } from '../utils/error-text.js'
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

/**
 * Teto da espera depois de um erro do store no modo servico.
 *
 * POR QUE O SERVICO NAO SAI MAIS NESSE ERRO (medido em producao, 24/09/2026):
 * o claim e as escritas de estado (`complete`/`applyFailure`) rodavam sem
 * guarda, entao QUALQUER erro do banco da propria fila (um P2028 de transacao
 * lenta, uma conexao que caiu) rejeitava o loop, o `Promise.all` e o `main()` —
 * `process.exit(1)`. O Swarm subia outro container, que pagava de novo o
 * download do pnpm pelo corepack e a impressao digital de 1.593 arquivos, e
 * cada morte deixava ate 4 jobs em `running` para o reclaim. Com a fila a 3,6
 * milhoes de linhas foram 36-55 containers por hora, vivendo 5-15 s. Reiniciar
 * nao devolve o banco — o mesmo raciocinio do HEALTHCHECK do
 * Dockerfile.catalog-worker, que de proposito nao consulta o banco.
 *
 * 5 s fica bem abaixo dos 10 s do grace period padrao de parada do Docker: um
 * SIGTERM que chegue durante a espera ainda drena antes de virar SIGKILL.
 */
const STORE_ERROR_BACKOFF_CAP_MS = 5_000

/** Espera depois da N-esima falha seguida do store: dobra a partir de `baseMs`, ate o teto. */
export function storeErrorBackoffMs(consecutiveFailures: number, baseMs: number): number {
  const exponent = Math.min(Math.max(consecutiveFailures - 1, 0), 16)
  return Math.min(STORE_ERROR_BACKOFF_CAP_MS, Math.max(1, baseMs) * 2 ** exponent)
}

/** Erro de timeout de job (transitorio: o proximo claim tenta de novo). */
class JobTimeoutError extends Error {
  constructor(ms: number) {
    super(`job excedeu o timeout de ${ms}ms`)
    this.name = 'JobTimeoutError'
  }
}

/**
 * Extrai um codigo/mensagem SEGUROS (sem PII/segredo) de um erro.
 *
 * Este e o ULTIMO gate antes de `last_error_code`/`last_error_safe`: o que ele
 * cortar ninguem le depois. Ate 25/08/2026 ele cortava na primeira quebra de
 * linha, e a mensagem do Prisma COMECA com `\n` — 7.076 jobs gravaram o prefixo
 * do embrulho e nada mais, ou string vazia. Ver `utils/error-text.ts`, que
 * concentra o achatamento, a cadeia de `cause` e o truncamento pelas duas
 * pontas; a stack continua fora (`message` nunca a contem).
 *
 * A REDACAO E A CONTRAPARTIDA DE TER CONSERTADO A DECAPITACAO.
 * Enquanto a mensagem morria na primeira linha, quase nada chegava ao banco.
 * Agora a cadeia de `cause` inteira chega — e o Prisma ecoa a connection string
 * em varios erros (a #218 documentou isso ao redigir o `stderr` de processo
 * filho pelo mesmo motivo). Gravar isso cru numa coluna chamada `_safe` seria
 * trocar um silencio por um vazamento.
 *
 * A ordem importa: `redactSecrets` roda ANTES de `clampSafeText`. Mascarar
 * depois de truncar deixaria escapar um segredo partido ao meio pelo corte.
 */
export function toSafeError(error: unknown): { code: string; safe: string } {
  if (error instanceof Error) {
    // `code` e uma propriedade opcional de erros de driver/HTTP; nao esta em Error.
    const maybeCode: unknown = (error as unknown as { code?: unknown }).code
    const code = typeof maybeCode === 'string' && maybeCode.length > 0 ? maybeCode : error.name
    const safe = clampSafeText(redactSecrets(errorMessageWithCauses(error)))
    return { code: code.slice(0, 80), safe }
  }
  return {
    code: 'unknown_error',
    safe: clampSafeText(redactSecrets(flattenErrorText(String(error)))),
  }
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

  /**
   * Erro do STORE no modo servico: registra e espera, em vez de derrubar o
   * processo. O job em voo (se houver) fica em `running` e o reclaim de orfaos
   * o devolve a fila — o mesmo destino que ele teria se o container morresse.
   */
  async function backOffAfterStoreError(
    stage: 'claim' | 'record',
    error: unknown,
    consecutiveFailures: number,
    job: ClaimedCatalogJob | null,
  ): Promise<void> {
    const safe = toSafeError(error)
    const inMs = storeErrorBackoffMs(consecutiveFailures, idleSleepMs)
    log.log('warn', 'catalog_worker_store_error', {
      runId,
      stage,
      jobId: job?.id ?? null,
      jobType: job?.jobType ?? null,
      code: safe.code,
      error: safe.safe,
      consecutiveFailures,
      inMs,
    })
    await sleep(inMs)
  }

  /** Um loop de worker: reivindica e processa ate parar. */
  async function loop(): Promise<void> {
    let storeFailures = 0
    while (!shuttingDown() && !ceilingReached()) {
      let job: ClaimedCatalogJob | null
      try {
        job = await deps.store.claimNext()
      } catch (error) {
        // `drain` (CLI/CI) sobe o erro: la ele deve aparecer, e repetir sem fim
        // esconderia um banco quebrado atras de um processo que nunca termina.
        if (drain) throw error
        storeFailures += 1
        await backOffAfterStoreError('claim', error, storeFailures, null)
        continue
      }
      if (job === null) {
        storeFailures = 0
        if (drain) return
        await sleep(idleSleepMs)
        continue
      }
      claimed += 1
      log.log('debug', 'catalog_job_claimed', { runId, jobId: job.id, jobType: job.jobType })
      try {
        // Falha do HANDLER nunca chega aqui (processJob a registra). O que chega
        // e a escrita do destino (`complete`/`applyFailure`) falhando no banco.
        await processJob(job)
        storeFailures = 0
      } catch (error) {
        if (drain) throw error
        storeFailures += 1
        await backOffAfterStoreError('record', error, storeFailures, job)
      }
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
