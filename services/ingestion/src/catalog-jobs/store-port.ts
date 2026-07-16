/**
 * store-port.ts — Porta (contrato) da persistencia da fila de jobs (PURO).
 *
 * O adapter Prisma real (`createPrismaCatalogJobStore`) implementa esta porta em
 * services/ingestion/src/persistence/catalog-job-store.ts (excluido do
 * typecheck, como job-claim.ts). Testes podem usar um fake em memoria contra a
 * mesma porta. O claim concorrente-seguro (FOR UPDATE SKIP LOCKED) e a unica
 * garantia que exige o Postgres real — coberta pelo validador dedicado.
 */

import type { CatalogEntityKind, CatalogJobType } from './types.js'

/** Entrada de enfileiramento. `idempotencyKey` deduplica (repetir = noop). */
export interface EnqueueCatalogJobInput {
  readonly jobType: CatalogJobType
  readonly idempotencyKey: string
  readonly entityType?: CatalogEntityKind | null
  readonly externalId?: string | null
  readonly payload?: Record<string, unknown>
  readonly priority?: number
  readonly maxAttempts?: number
  /** Momento a partir do qual o job fica elegivel (default: agora). */
  readonly availableAt?: Date | null
  readonly runId?: string | null
}

/** Resultado do enqueue: `created=false` quando a chave ja existia (noop). */
export interface EnqueueResult {
  readonly id: string
  readonly created: boolean
}

/** Job reivindicado, pronto para o worker processar. */
export interface ClaimedCatalogJob {
  readonly id: string
  readonly jobType: CatalogJobType
  readonly entityType: CatalogEntityKind | null
  readonly externalId: string | null
  readonly payload: Record<string, unknown>
  readonly attempts: number
  readonly maxAttempts: number
  readonly runId: string | null
}

/** Opcoes do claim. `dryRun` faz peek (nao muta). */
export interface ClaimCatalogOptions {
  readonly dryRun?: boolean
}

/** Plano JA RESOLVIDO de falha (datas absolutas), aplicado pelo adapter. */
export interface ResolvedFailure {
  readonly status: 'retry_wait' | 'dead_letter'
  readonly availableAt: Date | null
  readonly lastErrorCode: string | null
  readonly lastErrorSafe: string | null
}

/** Uma linha de dead-letter (para inspecao/replay operacional). */
export interface DeadLetterEntry {
  readonly id: string
  readonly jobType: CatalogJobType
  readonly entityType: CatalogEntityKind | null
  readonly externalId: string | null
  readonly attempts: number
  readonly lastErrorCode: string | null
  readonly lastErrorSafe: string | null
}

/** Resultado de um ciclo de reclaim de orfaos. */
export interface ReclaimResult {
  readonly requeued: number
  readonly deadLettered: number
}

/**
 * Porta da persistencia da fila. Todo metodo e idempotente/seguro para uso
 * concorrente; o claim usa FOR UPDATE SKIP LOCKED (dois workers nunca pegam o
 * mesmo job).
 */
export interface CatalogJobStorePort {
  enqueue(input: EnqueueCatalogJobInput): Promise<EnqueueResult>
  claimNext(options?: ClaimCatalogOptions): Promise<ClaimedCatalogJob | null>
  heartbeat(id: string): Promise<void>
  complete(id: string): Promise<void>
  applyFailure(id: string, failure: ResolvedFailure): Promise<void>
  /** Recupera jobs em voo cujo heartbeat expirou; retorna contagens. */
  reclaimOrphans(timeoutMs: number): Promise<ReclaimResult>
  listDeadLetter(limit: number): Promise<DeadLetterEntry[]>
  /** Reenfileira dead-letters (todos, ou os `ids` dados). Retorna quantos. */
  replayDeadLetter(ids?: readonly string[]): Promise<number>
}
