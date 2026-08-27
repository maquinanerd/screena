/**
 * support.ts — Utilidades compartilhadas pelos handlers (PURO).
 *
 * Duas responsabilidades:
 *  1. classificar erro em TRANSITORIO vs PERMANENTE (o worker so retenta o
 *     transitorio);
 *  2. produzir labels de metrica de BAIXA CARDINALIDADE.
 *
 * Por que a cardinalidade importa: cada combinacao distinta de labels vira uma
 * serie temporal no Prometheus. Um `entity_id` como label transforma um counter
 * em milhoes de series e derruba o coletor. Por isso `classifySafeError` mapeia
 * o erro para um conjunto FECHADO de classes — nunca a mensagem crua.
 */

import { CATALOG_METRIC_NAMES, type MetricsSink } from '../../metrics/index.js'
import { PermanentJobError } from '../handler.js'

/** Conjunto FECHADO de classes de erro (label `error_class`). */
export const ERROR_CLASSES = [
  'invalid_input',
  'not_found',
  'unauthorized',
  'rate_limited',
  'circuit_open',
  'upstream_5xx',
  'upstream_4xx',
  'timeout',
  'aborted',
  'network',
  'database',
  'unknown',
] as const

/** Uma classe de erro valida. */
export type ErrorClass = (typeof ERROR_CLASSES)[number]

/** Labels permitidas em metrica (§Parte E). Fora desta lista = alta cardinalidade. */
export const ALLOWED_METRIC_LABELS = [
  'job_type',
  'entity_type',
  'provider',
  'result',
  'error_class',
  'list_type',
  'country',
  'locale',
  'kind',
  'source',
  'endpoint',
  'reason',
  // Desfecho de disponibilidade ("onde assistir") de um `sync_details`.
  // Cardinalidade FECHADA: os 8 valores de `DetailWatchOutcome`.
  'watch_outcome',
] as const

/** Uma label permitida. */
export type AllowedMetricLabel = (typeof ALLOWED_METRIC_LABELS)[number]

/** Lê `status` de um erro tipo HTTP sem assumir a classe concreta. */
function readNumber(error: unknown, field: string): number | null {
  if (typeof error !== 'object' || error === null) return null
  const value: unknown = (error as Record<string, unknown>)[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Lê uma propriedade string de um erro (ex.: `code` de driver). */
function readString(error: unknown, field: string): string | null {
  if (typeof error !== 'object' || error === null) return null
  const value: unknown = (error as Record<string, unknown>)[field]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Classifica um erro numa das `ERROR_CLASSES`.
 *
 * NUNCA devolve a mensagem do erro: o retorno e sempre um valor do conjunto
 * fechado, seguro para usar como label de metrica.
 */
export function classifySafeError(error: unknown): ErrorClass {
  if (error instanceof PermanentJobError) {
    return error.code === 'invalid_job_input' ? 'invalid_input' : 'unknown'
  }

  const name = error instanceof Error ? error.name : ''
  if (name === 'AbortError') return 'aborted'
  if (name === 'JobTimeoutError' || name === 'TimeoutError') return 'timeout'
  if (name === 'TmdbCircuitOpenError') return 'circuit_open'

  const status = readNumber(error, 'status')
  if (status !== null) {
    if (status === 401 || status === 403) return 'unauthorized'
    if (status === 404) return 'not_found'
    if (status === 429) return 'rate_limited'
    if (status >= 500) return 'upstream_5xx'
    if (status >= 400) return 'upstream_4xx'
  }

  // Códigos de driver/rede (Node/undici) e de Prisma.
  const code = readString(error, 'code')
  if (code !== null) {
    if (/^(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|ETIMEDOUT|UND_ERR)/.test(code)) {
      return code === 'ETIMEDOUT' ? 'timeout' : 'network'
    }
    if (/^P\d{4}$/.test(code)) return 'database'
  }

  return 'unknown'
}

/**
 * True quando o erro NAO deve consumir tentativas de retry.
 *
 * 404 e 401/403 do upstream sao permanentes: repetir o mesmo GET devolve o
 * mesmo 404. Um `PermanentJobError` ja e permanente por construcao — o worker
 * checa isso antes, mas repetimos aqui para os handlers que decidem promover
 * um erro do provider a permanente.
 */
export function isPermanentUpstreamError(error: unknown): boolean {
  if (error instanceof PermanentJobError) return true
  // TmdbHttpError carrega `permanent` calculado pelo proprio client.
  const permanent: unknown =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>).permanent
      : undefined
  if (permanent === true) return true
  const cls = classifySafeError(error)
  return cls === 'not_found' || cls === 'unauthorized' || cls === 'invalid_input'
}

/**
 * Lanca `AbortError` quando o sinal ja abortou.
 *
 * Handlers chamam isto entre etapas: sem checar, um shutdown gracioso so faria
 * efeito depois do proximo IO, e o timeout do job nao interromperia um lote
 * longo no meio.
 */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error('operacao abortada (shutdown ou timeout do job)')
    error.name = 'AbortError'
    throw error
  }
}

/** Erro permanente de entidade inexistente upstream. */
export class UpstreamNotFoundError extends PermanentJobError {
  constructor(kind: string, tmdbId: number) {
    super('upstream_not_found', `${kind} ${tmdbId} nao existe no provider`)
    this.name = 'UpstreamNotFoundError'
  }
}

/** Verifica em tempo de execucao que nenhuma label proibida vazou. */
export function assertAllowedLabels(labels: Readonly<Record<string, string>>): void {
  for (const key of Object.keys(labels)) {
    if (!(ALLOWED_METRIC_LABELS as readonly string[]).includes(key)) {
      throw new Error(`label de metrica proibida (alta cardinalidade): "${key}"`)
    }
  }
}


/**
 * Acumulador de desfechos de enfileiramento.
 *
 * PORTA UNICA para os tres handlers que enfileiram em lote. Existe por dois
 * motivos, e o segundo e o que importa:
 *
 *  - agrega. `discover_ids` enfileira ate 2000 ids por ciclo; uma amostra por id
 *    viraria 2000 linhas de log para dizer uma coisa so. Uma amostra por
 *    (tipo, desfecho) diz o mesmo com duas linhas;
 *  - impede divergencia. Tres blocos parecidos e um conserto aplicado a um e
 *    esquecido nos outros — o padrao que `entity-coverage/entry.ts` ja documenta
 *    para o proprio job de cobertura.
 */
export function createEnqueueTally(): {
  add(jobType: string, created: boolean): void
  flush(metrics: MetricsSink): void
  duplicates(): number
} {
  const counts = new Map<string, number>()
  let duplicated = 0
  return {
    add(jobType: string, created: boolean): void {
      if (!created) duplicated += 1
      const key = `${jobType}|${created ? 'created' : 'duplicate'}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    },
    flush(metrics: MetricsSink): void {
      for (const [key, value] of counts) {
        const [jobType, result] = key.split('|')
        metrics.increment(CATALOG_METRIC_NAMES.jobsEnqueuedTotal, value, {
          job_type: jobType!,
          result: result!,
        })
      }
    },
    duplicates(): number {
      return duplicated
    },
  }
}
