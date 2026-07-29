/**
 * publication-outbox.ts — API interna da outbox: `claim`, `ack`, `fail`.
 *
 * ADAPTADORES FINOS. A politica (elegibilidade, lease, backoff, dead-letter)
 * vive em `../outbox-api.js`, pura e testada sem servidor.
 *
 * A outbox NAO e exposta pela REST generica: `publication-outbox` declara
 * `read` so para administrador e `create/update/delete` para ninguem. Estes tres
 * endpoints sao a unica porta do consumidor, e cada um exige o escopo
 * `publication_projection` — um MNScr comprometido nao consegue drenar a fila
 * de publicacao.
 */

import { randomUUID } from 'node:crypto'

import type { Endpoint, PayloadRequest, Where } from 'payload'

import { toActor } from '../actor.js'
import { serviceHasScope } from '../access.js'
import {
  buildClaimMutation,
  clampBatchSize,
  decideFailOutcome,
  evaluateClaimEligibility,
  sanitizeErrorMessage,
  validateLease,
  DEFAULT_LEASE_MS,
  DEFAULT_RETRY_POLICY,
} from '../outbox-api.js'

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** Le o corpo JSON com teto. Corpo malformado nunca vira excecao nao tratada. */
async function readJson(req: PayloadRequest): Promise<Record<string, unknown> | null> {
  try {
    const raw = (await req.text?.()) ?? ''
    if (raw === '' || raw.length > 100_000) return null
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Portao comum: precisa ser service account ATIVA com escopo de projecao.
 *
 * Humano autenticado tambem e recusado. A outbox nao e superficie editorial, e
 * um editor logado no painel nao deve conseguir marcar evento como processado.
 */
function requireProjectionScope(req: PayloadRequest): Response | null {
  const actor = toActor(req.user)
  if (actor.kind === 'anonymous') return json({ error: 'unauthenticated' }, 401)
  if (!serviceHasScope(actor, 'publication_projection')) {
    return json({ error: 'forbidden_scope' }, 403)
  }
  return null
}

/* ------------------------------------------------------------------ */
/* CLAIM                                                               */
/* ------------------------------------------------------------------ */

export const claimPublicationEventsEndpoint: Endpoint = {
  path: '/internal/publication-outbox/claim',
  method: 'post',
  handler: async (req: PayloadRequest): Promise<Response> => {
    const denied = requireProjectionScope(req)
    if (denied !== null) return denied

    const body = await readJson(req)
    if (body === null) return json({ error: 'invalid_json' }, 400)

    const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : ''
    if (workerId === '') return json({ error: 'missing_worker_id' }, 400)

    const batchSize = clampBatchSize(body.batchSize)
    const leaseMs = typeof body.leaseMs === 'number' ? body.leaseMs : DEFAULT_LEASE_MS
    const nowIso = new Date().toISOString()

    // Candidatos: pendentes/falhados disponiveis AGORA, e `processing` cuja
    // lease expirou (worker morreu no meio). Buscamos mais do que o lote porque
    // parte deles vai perder a corrida do compare-and-swap.
    const where: Where = {
      or: [
        { status: { in: ['pending', 'failed'] } },
        { status: { equals: 'processing' } },
      ],
    }
    const candidates = await req.payload.find({
      collection: 'publication-outbox',
      where,
      sort: 'createdAt',
      limit: batchSize * 3,
      depth: 0,
      overrideAccess: true,
      req,
    })

    const claimed: Record<string, unknown>[] = []
    for (const raw of candidates.docs) {
      if (claimed.length >= batchSize) break
      const row = raw as unknown as Record<string, unknown>

      const eligibility = evaluateClaimEligibility(
        {
          status: String(row.status ?? ''),
          availableAtIso: typeof row.availableAt === 'string' ? row.availableAt : null,
          leaseExpiresAtIso:
            typeof row.leaseExpiresAt === 'string' ? row.leaseExpiresAt : null,
          attempts: typeof row.attempts === 'number' ? row.attempts : 0,
        },
        nowIso,
      )
      if (!eligibility.claimable) continue

      const mutation = buildClaimMutation({
        row: { status: String(row.status ?? ''), availableAtIso: null, leaseExpiresAtIso: null, attempts: typeof row.attempts === 'number' ? row.attempts : 0 },
        nowIso,
        leaseMs,
        leaseToken: randomUUID(),
        workerId,
      })

      try {
        // COMPARE-AND-SWAP. A pre-condicao e o estado LIDO — status e, quando
        // recuperamos uma lease expirada, o token exato que enxergamos. Dois
        // workers correndo: o segundo nao encontra a linha naquele estado, o
        // Payload devolve P2025 e ele simplesmente pula. E isto, e nao um
        // mutex de processo, que garante um evento para um worker so.
        const precondition: Record<string, unknown> = {
          id: { equals: row.id },
          status: { equals: row.status },
        }
        if (eligibility.kind === 'expired_lease') {
          precondition.leaseToken =
            row.leaseToken === null || row.leaseToken === undefined
              ? { exists: false }
              : { equals: row.leaseToken }
        }

        const updated = await req.payload.update({
          collection: 'publication-outbox',
          where: precondition as Where,
          data: {
            status: mutation.status,
            leaseToken: mutation.leaseToken,
            lockedBy: mutation.lockedBy,
            lockedAt: mutation.lockedAtIso,
            leaseExpiresAt: mutation.leaseExpiresAtIso,
            attempts: mutation.attempts,
          } as never,
          overrideAccess: true,
          req,
        })

        const doc = (updated.docs?.[0] ?? null) as Record<string, unknown> | null
        if (doc === null) continue

        claimed.push({
          eventId: doc.eventId,
          idempotencyKey: doc.idempotencyKey,
          eventType: doc.eventType,
          aggregateId: doc.aggregateId,
          // ORDEM DE EMISSAO: o id serial da linha. E o unico campo da outbox
          // que ordena de fato. `aggregateVersion` guarda um HASH do conteudo
          // publicado — util para detectar mudanca, inutil para ordenar.
          emissionSequence: Number(doc.id),
          contentVersion: doc.aggregateVersion,
          attempts: doc.attempts,
          leaseToken: mutation.leaseToken,
          leaseExpiresAt: mutation.leaseExpiresAtIso,
          payload: doc.payload,
        })
      } catch {
        // Perdeu a corrida (ou a linha mudou): outro worker levou. Seguir.
        continue
      }
    }

    return json({ workerId, claimed: claimed.length, events: claimed }, 200)
  },
}

/* ------------------------------------------------------------------ */
/* ACK                                                                 */
/* ------------------------------------------------------------------ */

export const ackPublicationEventEndpoint: Endpoint = {
  path: '/internal/publication-outbox/ack',
  method: 'post',
  handler: async (req: PayloadRequest): Promise<Response> => {
    const denied = requireProjectionScope(req)
    if (denied !== null) return denied

    const body = await readJson(req)
    if (body === null) return json({ error: 'invalid_json' }, 400)

    const eventId = typeof body.eventId === 'string' ? body.eventId : ''
    const leaseToken = typeof body.leaseToken === 'string' ? body.leaseToken : ''
    const workerId = typeof body.workerId === 'string' ? body.workerId : ''
    const receiptId = typeof body.projectionReceiptId === 'string' ? body.projectionReceiptId : ''
    const projectedAt = typeof body.projectedAt === 'string' ? body.projectedAt : ''
    const eventPayloadHash =
      typeof body.eventPayloadHash === 'string' ? body.eventPayloadHash : undefined

    if (eventId === '' || leaseToken === '' || workerId === '' || receiptId === '' || projectedAt === '') {
      return json({ error: 'missing_fields' }, 400)
    }

    const found = await req.payload.find({
      collection: 'publication-outbox',
      where: { eventId: { equals: eventId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      req,
    })
    const row = (found.docs[0] ?? null) as Record<string, unknown> | null
    if (row === null) return json({ error: 'event_not_found' }, 404)

    const verdict = validateLease(
      {
        status: String(row.status ?? ''),
        leaseToken: typeof row.leaseToken === 'string' ? row.leaseToken : null,
        lockedBy: typeof row.lockedBy === 'string' ? row.lockedBy : null,
        eventPayloadHash: null,
      },
      { leaseToken, workerId, ...(eventPayloadHash === undefined ? {} : { eventPayloadHash }) },
    )

    // Repetir o ack de um evento ja processado e idempotente, nao erro: e
    // exatamente o que acontece quando o worker cai entre o commit do
    // screen-db e o ack.
    if (!verdict.ok && verdict.idempotent) {
      return json({ outcome: 'already_processed', eventId }, 200)
    }
    if (!verdict.ok) return json({ error: 'lease_invalid', reason: verdict.reason }, 409)

    await req.payload.update({
      collection: 'publication-outbox',
      where: { id: { equals: row.id }, leaseToken: { equals: leaseToken } } as Where,
      data: {
        status: 'processed',
        processedAt: projectedAt,
        leaseToken: null,
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null,
        errorCode: null,
        lastError: null,
      } as never,
      overrideAccess: true,
      req,
    })

    return json({ outcome: 'processed', eventId, projectionReceiptId: receiptId }, 200)
  },
}

/* ------------------------------------------------------------------ */
/* FAIL                                                                */
/* ------------------------------------------------------------------ */

export const failPublicationEventEndpoint: Endpoint = {
  path: '/internal/publication-outbox/fail',
  method: 'post',
  handler: async (req: PayloadRequest): Promise<Response> => {
    const denied = requireProjectionScope(req)
    if (denied !== null) return denied

    const body = await readJson(req)
    if (body === null) return json({ error: 'invalid_json' }, 400)

    const eventId = typeof body.eventId === 'string' ? body.eventId : ''
    const leaseToken = typeof body.leaseToken === 'string' ? body.leaseToken : ''
    const workerId = typeof body.workerId === 'string' ? body.workerId : ''
    const errorCode = typeof body.errorCode === 'string' ? body.errorCode : 'unknown_error'
    const retryable = body.retryable !== false
    const failedAt = typeof body.failedAt === 'string' ? body.failedAt : new Date().toISOString()

    if (eventId === '' || leaseToken === '' || workerId === '') {
      return json({ error: 'missing_fields' }, 400)
    }

    const found = await req.payload.find({
      collection: 'publication-outbox',
      where: { eventId: { equals: eventId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      req,
    })
    const row = (found.docs[0] ?? null) as Record<string, unknown> | null
    if (row === null) return json({ error: 'event_not_found' }, 404)

    const verdict = validateLease(
      {
        status: String(row.status ?? ''),
        leaseToken: typeof row.leaseToken === 'string' ? row.leaseToken : null,
        lockedBy: typeof row.lockedBy === 'string' ? row.lockedBy : null,
        eventPayloadHash: null,
      },
      { leaseToken, workerId },
    )
    if (!verdict.ok && verdict.idempotent) {
      return json({ outcome: 'already_processed', eventId }, 200)
    }
    if (!verdict.ok) return json({ error: 'lease_invalid', reason: verdict.reason }, 409)

    const attempts = typeof row.attempts === 'number' ? row.attempts : 1
    const outcome = decideFailOutcome({
      attempts,
      retryable,
      nowIso: failedAt,
      policy: DEFAULT_RETRY_POLICY,
    })

    await req.payload.update({
      collection: 'publication-outbox',
      where: { id: { equals: row.id }, leaseToken: { equals: leaseToken } } as Where,
      data: {
        status: outcome.status,
        ...(outcome.availableAtIso === null ? {} : { availableAt: outcome.availableAtIso }),
        leaseToken: null,
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null,
        errorCode,
        // A mensagem e SANITIZADA: erro de banco carrega connection string e
        // erro de HTTP carrega header de autorizacao. A outbox e lida por
        // humanos no painel.
        lastError: sanitizeErrorMessage(body.message),
      } as never,
      overrideAccess: true,
      req,
    })

    return json(
      { outcome: outcome.status, eventId, attempts, availableAt: outcome.availableAtIso },
      200,
    )
  },
}

export const publicationOutboxEndpoints: Endpoint[] = [
  claimPublicationEventsEndpoint,
  ackPublicationEventEndpoint,
  failPublicationEventEndpoint,
]
