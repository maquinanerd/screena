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

interface OutboxPool {
  query: (text: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
}

/**
 * Pool do adapter Postgres do Payload.
 *
 * Usado SO pelo compare-and-swap do `claim`, que precisa de uma unica
 * declaracao SQL atomica (ver o comentario no ponto de uso). Todo o resto da
 * outbox continua passando pela API do Payload.
 */
function outboxPool(req: PayloadRequest): OutboxPool {
  const pool = (req.payload.db as unknown as { pool?: OutboxPool }).pool
  if (pool === undefined) {
    throw new Error('adapter do Payload sem pool Postgres: claim nao pode ser atomico')
  }
  return pool
}

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
        // COMPARE-AND-SWAP ATOMICO, em UMA declaracao SQL.
        //
        // `payload.update({ where })` NAO entrega esta garantia: o adapter
        // resolve o `where` num SELECT e so entao aplica o UPDATE por id. Entre
        // os dois, outro worker atualiza a mesma linha — e os DOIS ganham. O
        // sintoma era intermitente e so a CI pegou: "o MESMO evento nunca e
        // entregue a dois workers" falhando de vez em quando, com o mesmo
        // eventId nas duas listas.
        //
        // Um unico `UPDATE ... WHERE status = <o que foi lido> RETURNING`
        // fecha a janela: sob READ COMMITTED o segundo worker espera o primeiro
        // comitar, reavalia o WHERE contra a versao nova da linha, nao casa, e
        // volta com zero linhas. E isto — nao um mutex de processo — que
        // garante um evento para um worker so.
        const conditions = [
          '"id" = $7',
          '"status" = $8::"public"."enum_publication_outbox_status"',
        ]
        const params: unknown[] = [
          mutation.status,
          mutation.leaseToken,
          mutation.lockedBy,
          mutation.lockedAtIso,
          mutation.leaseExpiresAtIso,
          mutation.attempts,
          row.id,
          row.status,
        ]
        // Recuperando lease expirada, o token LIDO tambem entra na
        // pre-condicao. `IS NOT DISTINCT FROM` trata NULL como valor, entao
        // "sem token" tambem e uma pre-condicao verificavel.
        if (eligibility.kind === 'expired_lease') {
          conditions.push('"lease_token" IS NOT DISTINCT FROM $9')
          params.push(row.leaseToken ?? null)
        }

        const { rows } = await outboxPool(req).query(
          `UPDATE "publication_outbox"
              SET "status" = $1::"public"."enum_publication_outbox_status",
                  "lease_token" = $2,
                  "locked_by" = $3,
                  "locked_at" = $4::timestamptz,
                  "lease_expires_at" = $5::timestamptz,
                  "attempts" = $6,
                  "updated_at" = now()
            WHERE ${conditions.join(' AND ')}
        RETURNING "id", "event_id", "idempotency_key", "event_type", "aggregate_id",
                  "aggregate_version", "attempts", "payload"`,
          params,
        )

        const doc = rows[0]
        if (doc === undefined) continue

        claimed.push({
          eventId: doc.event_id,
          idempotencyKey: doc.idempotency_key,
          eventType: doc.event_type,
          aggregateId: doc.aggregate_id,
          // ORDEM DE EMISSAO: o id serial da linha. E o unico campo da outbox
          // que ordena de fato. `aggregateVersion` guarda um HASH do conteudo
          // publicado — util para detectar mudanca, inutil para ordenar.
          emissionSequence: Number(doc.id),
          contentVersion: doc.aggregate_version,
          // `attempts` e `numeric` no Postgres, e o driver devolve string.
          attempts: Number(doc.attempts),
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
