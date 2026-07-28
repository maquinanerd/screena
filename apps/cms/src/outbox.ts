/**
 * outbox.ts — Construcao do `publication-event-v1`. PURO.
 *
 * A outbox existe porque o CMS NAO pode chamar o lado publico diretamente: se o
 * `screen-db` estiver fora do ar no instante da publicacao, a materia nao pode
 * ser perdida nem a publicacao travada. O evento e gravado na MESMA transacao da
 * publicacao; a entrega e problema de outro processo (que nao existe nesta fase).
 *
 * O evento e montado a partir do estado JA PERSISTIDO e validado contra o
 * contrato antes de ser gravado — um evento invalido na outbox seria um veneno
 * de fila descoberto so no consumidor.
 */

import {
  parsePublicationEventV1,
  type ContractIssue,
  type PublicationEventType,
  type PublicationEventV1,
} from '@screena/editorial-contracts'

/** Chave de idempotencia do evento: um por (artigo, versao, tipo). */
export function buildEventIdempotencyKey(
  articleId: string,
  articleVersionId: string,
  eventType: PublicationEventType,
): string {
  return `${articleId}:${articleVersionId}:${eventType}`
}

/** Status de um item da outbox. */
export const OUTBOX_STATUSES = [
  'pending',
  'processing',
  'processed',
  'failed',
  'dead_letter',
] as const

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number]

/** Linha da outbox, pronta para persistir. */
export interface OutboxRecord {
  readonly eventId: string
  readonly idempotencyKey: string
  readonly eventType: PublicationEventType
  readonly aggregateType: 'article'
  readonly aggregateId: string
  readonly aggregateVersion: string
  readonly payload: PublicationEventV1
  readonly status: OutboxStatus
  readonly attempts: number
  readonly availableAt: string
}

export type OutboxBuild =
  | { readonly ok: true; readonly record: OutboxRecord }
  | { readonly ok: false; readonly issues: readonly ContractIssue[] }

/**
 * Monta e VALIDA um item de outbox.
 *
 * `eventId` e `occurredAt` sao injetados pelo chamador — nao usamos
 * `Date.now()`/`randomUUID()` aqui para manter o modulo determinista e testavel
 * no tempo, como o resto do repositorio.
 */
export function buildOutboxRecord(input: {
  readonly event: unknown
  readonly eventType: PublicationEventType
  readonly articleId: string
  readonly articleVersionId: string
  readonly availableAtIso: string
}): OutboxBuild {
  const parsed = parsePublicationEventV1(input.event)
  if (!parsed.ok) return { ok: false, issues: parsed.issues }

  const event = parsed.value

  // Coerencia entre o envelope e o payload: se divergirem, o consumidor
  // processaria um evento sob a identidade de outro.
  const mismatches: ContractIssue[] = []
  if (event.eventType !== input.eventType) {
    mismatches.push({ path: 'eventType', message: 'eventType do envelope difere do payload' })
  }
  if (event.articleId !== input.articleId) {
    mismatches.push({ path: 'articleId', message: 'articleId do envelope difere do payload' })
  }
  if (event.articleVersionId !== input.articleVersionId) {
    mismatches.push({
      path: 'articleVersionId',
      message: 'articleVersionId do envelope difere do payload',
    })
  }
  const expectedKey = buildEventIdempotencyKey(
    input.articleId,
    input.articleVersionId,
    input.eventType,
  )
  if (event.idempotencyKey !== expectedKey) {
    mismatches.push({
      path: 'idempotencyKey',
      message: 'idempotencyKey nao segue o formato articleId:versionId:eventType',
    })
  }
  if (mismatches.length > 0) return { ok: false, issues: mismatches }

  return {
    ok: true,
    record: {
      eventId: event.eventId,
      idempotencyKey: event.idempotencyKey,
      eventType: event.eventType,
      aggregateType: 'article',
      aggregateId: input.articleId,
      aggregateVersion: input.articleVersionId,
      payload: event,
      status: 'pending',
      attempts: 0,
      availableAt: input.availableAtIso,
    },
  }
}

/**
 * Ja existe um evento com esta chave? Entao nao criar outro.
 *
 * Republicar o mesmo estado nao e um novo acontecimento para o lado publico; um
 * segundo evento faria o consumidor reprojetar sem necessidade e poluiria o
 * historico com "publicado" duplicado.
 */
export function shouldSkipDuplicateEvent(
  idempotencyKey: string,
  existingKeys: readonly string[],
): boolean {
  return existingKeys.includes(idempotencyKey)
}
