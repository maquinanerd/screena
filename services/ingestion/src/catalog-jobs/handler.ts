/**
 * handler.ts — Registry tipado de handlers da fila de catalogo (Backend A, §1).
 *
 * Um `CatalogJobHandler` e a UNIDADE DE TRABALHO real de um `CatalogJobType`. O
 * worker (worker.ts) reivindica o job, resolve o handler pelo tipo, valida o
 * input e executa — nada de logica de negocio no worker.
 *
 * Contrato de erro:
 *  - `CatalogJobInputError` / `PermanentJobError` => falha PERMANENTE: nao adianta
 *    repetir (input invalido, 404 upstream). O worker manda direto para
 *    dead-letter, sem gastar tentativas.
 *  - qualquer outro erro => TRANSITORIO: entra no retry com backoff.
 */

import type { MetricsSink } from '../metrics/index.js'
import type { CatalogJobType } from './types.js'

/** Nivel de um evento de log estruturado. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Log estruturado (sem PII/segredo; `requestId` correlaciona o ciclo). */
export interface StructuredLogger {
  log(level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>): void
}

/** Logger que descarta tudo (default em testes). */
export function createNoopLogger(): StructuredLogger {
  return { log() {} }
}

/**
 * Contexto entregue ao handler durante a execucao.
 *
 * `signal` aborta o trabalho (timeout do job ou shutdown gracioso) — handlers que
 * fazem IO DEVEM propaga-lo. `heartbeat()` renova o carimbo de vida: handlers
 * longos devem chamar periodicamente para nao serem recuperados como orfaos.
 */
export interface CatalogJobContext {
  readonly jobId: string
  readonly requestId: string
  readonly attempt: number
  readonly signal: AbortSignal
  heartbeat(): Promise<void>
  readonly log: StructuredLogger
  readonly metrics: MetricsSink
}

/**
 * Handler de um tipo de job. `validateInput` roda ANTES de qualquer IO e lanca
 * `CatalogJobInputError` quando o payload nao serve (falha permanente).
 */
export interface CatalogJobHandler<I = unknown, O = unknown> {
  readonly type: CatalogJobType
  validateInput(input: unknown): I
  execute(context: CatalogJobContext, input: I): Promise<O>
}

/** Falha PERMANENTE: repetir nao ajuda; vai direto para dead-letter. */
export class PermanentJobError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'PermanentJobError'
    this.code = code
  }
}

/** Payload do job invalido para o handler (subtipo de falha permanente). */
export class CatalogJobInputError extends PermanentJobError {
  constructor(message: string) {
    super('invalid_job_input', message)
    this.name = 'CatalogJobInputError'
  }
}

/** True quando o erro e permanente (nao deve consumir tentativas de retry). */
export function isPermanentJobError(error: unknown): boolean {
  return error instanceof PermanentJobError
}

/** Registry de handlers por tipo. */
export interface CatalogJobRegistry {
  register(handler: CatalogJobHandler<never, unknown>): void
  get(type: CatalogJobType): CatalogJobHandler<never, unknown> | undefined
  has(type: CatalogJobType): boolean
  types(): readonly CatalogJobType[]
}

/**
 * Cria um registry. Registrar dois handlers para o mesmo tipo e ERRO de
 * programacao (lanca): a resolucao tem de ser inequivoca.
 */
export function createCatalogJobRegistry(
  handlers: readonly CatalogJobHandler<never, unknown>[] = [],
): CatalogJobRegistry {
  const byType = new Map<CatalogJobType, CatalogJobHandler<never, unknown>>()

  const registry: CatalogJobRegistry = {
    register(handler) {
      if (byType.has(handler.type)) {
        throw new Error(`handler duplicado para o tipo de job: ${handler.type}`)
      }
      byType.set(handler.type, handler)
    },
    get(type) {
      return byType.get(type)
    },
    has(type) {
      return byType.has(type)
    },
    types() {
      return [...byType.keys()]
    },
  }

  for (const handler of handlers) registry.register(handler)
  return registry
}
