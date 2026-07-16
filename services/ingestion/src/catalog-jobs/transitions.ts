/**
 * transitions.ts — Maquina de estados PURA da fila de jobs do catalogo.
 *
 * Concentra as DECISOES de transicao (retry vs dead-letter, reclaim de orfaos,
 * replay) como funcoes puras. Os adapters Prisma apenas APLICAM o plano que
 * estas funcoes produzem — nenhuma regra de negocio mora no SQL.
 *
 * Modelo de tentativas (igual ao EntityWriterJob): `attempts` e incrementado no
 * CLAIM. Logo, ao falhar, `attempts` ja reflete a tentativa que acabou de
 * ocorrer; comparar `attempts >= maxAttempts` decide entre retry e dead-letter.
 */

import { computeJobBackoffMs, DEFAULT_JOB_BACKOFF, type JobBackoffConfig } from './backoff.js'
import type { CatalogJobState, CatalogJobStatus, SafeJobError } from './types.js'

/**
 * Plano de uma FALHA de execucao. `availableInMs` e o atraso ate o proximo
 * claim (so quando volta para `retry_wait`); em `dead_letter` e null.
 */
export interface FailurePlan {
  readonly status: Extract<CatalogJobStatus, 'retry_wait' | 'dead_letter'>
  readonly availableInMs: number | null
  readonly lastErrorCode: string | null
  readonly lastErrorSafe: string | null
  /** True quando esgotou as tentativas (foi para dead-letter). */
  readonly exhausted: boolean
}

/**
 * Decide o destino de um job que FALHOU: agenda retry com backoff enquanto
 * houver tentativas, ou manda para dead-letter quando esgota.
 *
 * `jitter` em [0,1) e injetado (determinismo/testabilidade).
 */
export function planFailure(
  job: Pick<CatalogJobState, 'attempts' | 'maxAttempts'>,
  error: SafeJobError,
  jitter: number,
  backoff: JobBackoffConfig = DEFAULT_JOB_BACKOFF,
): FailurePlan {
  const exhausted = job.attempts >= job.maxAttempts
  if (exhausted) {
    return {
      status: 'dead_letter',
      availableInMs: null,
      lastErrorCode: error.code,
      lastErrorSafe: error.safe,
      exhausted: true,
    }
  }
  return {
    status: 'retry_wait',
    availableInMs: computeJobBackoffMs(job.attempts, jitter, backoff),
    lastErrorCode: error.code,
    lastErrorSafe: error.safe,
    exhausted: false,
  }
}

/**
 * True quando um job "em voo" (claimed/running) deve ser recuperado por outro
 * worker: seu heartbeat esta mais velho que `timeoutMs` (worker provavelmente
 * morreu). Jobs sem heartbeat mas recem-reivindicados usam `claimedAt` como
 * base; sem nenhum dos dois, nao e reclaimavel (defensivo).
 */
export function isReclaimable(
  job: Pick<CatalogJobState, 'status' | 'heartbeatAt' | 'claimedAt'>,
  now: Date,
  timeoutMs: number,
): boolean {
  if (job.status !== 'claimed' && job.status !== 'running') return false
  const reference = job.heartbeatAt ?? job.claimedAt
  if (reference === null) return false
  return now.getTime() - reference.getTime() > timeoutMs
}

/**
 * Plano de RECLAIM de um job orfao: trata como uma falha (a tentativa em voo
 * conta), reaproveitando `planFailure` — retry com backoff ou dead-letter.
 * O codigo/mensagem sinalizam que a causa foi heartbeat expirado.
 */
export function planReclaim(
  job: Pick<CatalogJobState, 'attempts' | 'maxAttempts'>,
  jitter: number,
  backoff: JobBackoffConfig = DEFAULT_JOB_BACKOFF,
): FailurePlan {
  return planFailure(
    job,
    { code: 'worker_heartbeat_timeout', safe: 'job reclaimed: worker heartbeat expired' },
    jitter,
    backoff,
  )
}

/** Campos a reescrever ao dar REPLAY num job de dead-letter (volta a pending). */
export interface ReplayPlan {
  readonly status: Extract<CatalogJobStatus, 'pending'>
  readonly attempts: 0
  readonly clearError: true
  readonly clearClaim: true
}

/**
 * Plano de REPLAY: um job em `dead_letter` volta a `pending`, zera tentativas,
 * limpa erro/claim e fica imediatamente elegivel. So faz sentido a partir de
 * `dead_letter` (decisao operacional/humana registrada fora daqui).
 */
export function planReplay(): ReplayPlan {
  return { status: 'pending', attempts: 0, clearError: true, clearClaim: true }
}
