/**
 * catalog-job.ts — Contrato de visao publica/operacional de um CatalogJob.
 *
 * Forma SERIALIZAVEL de um job da fila, para as superficies operacionais
 * (`catalog status`, `catalog dead-letter list`). Espelha CatalogJobStatus/Type;
 * datas como ISO string; ids como string. Nenhum tipo Prisma.
 */

import {
  isRecord,
  optionalString,
  requireArray,
  requireEnum,
  requireString,
  fail,
  ok,
  type ValidationResult,
} from './validation.js'

/** Estado de um job na visao publica (espelha CatalogJobStatus). */
export type CatalogJobStatusView =
  | 'pending'
  | 'claimed'
  | 'running'
  | 'retry_wait'
  | 'succeeded'
  | 'failed'
  | 'dead_letter'
  | 'cancelled'

export const CATALOG_JOB_STATUS_VIEWS: readonly CatalogJobStatusView[] = [
  'pending',
  'claimed',
  'running',
  'retry_wait',
  'succeeded',
  'failed',
  'dead_letter',
  'cancelled',
]

/** Visao serializavel de um job. */
export interface CatalogJobView {
  readonly id: string
  readonly jobType: string
  readonly status: CatalogJobStatusView
  readonly entityType: string | null
  readonly externalId: string | null
  readonly attempts: number
  readonly maxAttempts: number
  readonly priority: number
  readonly availableAt: string | null
  readonly lastErrorCode: string | null
  readonly lastErrorSafe: string | null
}

/** Payload de status da fila: contagens por estado + amostra de dead-letter. */
export interface CatalogStatusPayload {
  readonly counts: Readonly<Record<CatalogJobStatusView, number>>
  readonly deadLetter: readonly CatalogJobView[]
}

function numberErrors(value: unknown, label: string): string[] {
  return typeof value === 'number' && Number.isFinite(value) ? [] : [`${label}: esperado number`]
}

/** Erros de um CatalogJobView. */
export function catalogJobViewErrors(value: unknown, label: string): string[] {
  if (!isRecord(value)) return [`${label}: esperado objeto`]
  return [
    ...requireString(value.id, `${label}.id`),
    ...requireString(value.jobType, `${label}.jobType`),
    ...requireEnum(value.status, `${label}.status`, CATALOG_JOB_STATUS_VIEWS),
    ...optionalString(value.entityType, `${label}.entityType`),
    ...optionalString(value.externalId, `${label}.externalId`),
    ...numberErrors(value.attempts, `${label}.attempts`),
    ...numberErrors(value.maxAttempts, `${label}.maxAttempts`),
    ...numberErrors(value.priority, `${label}.priority`),
    ...optionalString(value.availableAt, `${label}.availableAt`),
    ...optionalString(value.lastErrorCode, `${label}.lastErrorCode`),
    ...optionalString(value.lastErrorSafe, `${label}.lastErrorSafe`),
  ]
}

/** Valida um CatalogJobView isolado. */
export function validateCatalogJobView(input: unknown): ValidationResult<CatalogJobView> {
  const errors = catalogJobViewErrors(input, 'job')
  return errors.length === 0 ? ok(input as CatalogJobView) : fail(errors)
}

/** Valida um CatalogStatusPayload. */
export function validateCatalogStatusPayload(
  input: unknown,
): ValidationResult<CatalogStatusPayload> {
  if (!isRecord(input)) return fail(['esperado objeto'])
  const errors: string[] = []
  if (!isRecord(input.counts)) {
    errors.push('counts: esperado objeto')
  } else {
    for (const status of CATALOG_JOB_STATUS_VIEWS) {
      errors.push(...numberErrors(input.counts[status], `counts.${status}`))
    }
  }
  errors.push(
    ...requireArray(input.deadLetter, 'deadLetter', (i, n) =>
      catalogJobViewErrors(i, `deadLetter[${n}]`),
    ),
  )
  return errors.length === 0 ? ok(input as unknown as CatalogStatusPayload) : fail(errors)
}
