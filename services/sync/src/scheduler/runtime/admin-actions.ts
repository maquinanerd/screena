/**
 * runtime/admin-actions.ts — As ESCRITAS do painel operacional. Adapter Prisma.
 * COBERTO pelo typecheck da raiz (`pnpm typecheck`).
 *
 * ============================================================================
 * TRES TABELAS, E SO INSERT
 * ============================================================================
 * Este modulo e o unico caminho pelo qual o painel altera o banco, e ele so faz
 * INSERT em tres tabelas:
 *
 *   catalog_jobs              -> o job de detalhe/midia/temporadas (pela porta da fila)
 *   scheduler_force_requests  -> o pedido de fila/nota/score ao screen-cron
 *   admin_action_audits       -> quem pediu o que, o custo mostrado e o desfecho
 *
 * Nada de UPDATE, nada de DELETE, nada de licenca, `display_allowed`, cadencia ou
 * teto. Travado por `tests/admin/ops-actions-guard.test.ts`, que le este arquivo.
 *
 * ============================================================================
 * AUDITORIA NA MESMA TRANSACAO DO ENFILEIRAMENTO
 * ============================================================================
 * Um job sem auditoria e trabalho que ninguem sabe quem pediu; uma auditoria sem
 * job e um "enfileirado" que mente. Os dois nascem e morrem juntos.
 *
 * O nonce do formulario (`request_token`) e UNIQUE: o mesmo formulario enviado
 * duas vezes (duplo clique, F5 no POST) encontra a primeira auditoria e devolve
 * o desfecho dela — sem segundo job.
 */

import type { PrismaClient } from '@screena/db/server'
import { createPrismaCatalogJobStore } from '@screena/ingestion/catalog-job-store'

import {
  ADMIN_ACTION_KIND_BY_TITLE_ACTION,
  ADMIN_SCOPE_PREFIX,
  isAdminRequestToken,
  planAdminCatalogJob,
  planAdminSchedulerRequest,
  type AdminActionKind,
  type AdminCatalogAction,
  type AdminTitleKind,
} from '../admin-action-plan.js'

/** A capacidade de banco das acoes. */
export type AdminActionDb = Pick<PrismaClient, '$transaction' | '$queryRawUnsafe'>

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

/** Quem esta agindo. A credencial do painel e COMPARTILHADA: o rotulo nao e identidade. */
export interface AdminActor {
  readonly kind: 'basic_auth_shared' | 'open_development'
  /** Texto livre e nao secreto (`ADMIN_OPERATOR_LABEL`). */
  readonly label: string
}

/** O desfecho gravado. */
export type AdminActionOutcome = 'enqueued' | 'already_enqueued' | 'refused' | 'failed'

/** O que a acao fez. */
export interface AdminActionResult {
  readonly auditId: string
  readonly outcome: AdminActionOutcome
  readonly detail: string
  readonly catalogJobId: string | null
  readonly idempotencyKey: string | null
  readonly forceRequestId: string | null
  /** O MESMO formulario ja tinha sido confirmado: nada novo foi feito agora. */
  readonly repeatedSubmission: boolean
}

/** O alvo de uma acao de titulo. */
export interface AdminTitleTarget {
  readonly entityType: AdminTitleKind
  readonly entityId: string
  readonly tmdbId: number | null
}

const OPEN_JOB_STATUSES = `('pending', 'claimed', 'running', 'retry_wait')`
const LABEL_MAX = 120
const DETAIL_MAX = 500

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

interface AuditRow {
  readonly id: string
  readonly outcome: string
  readonly outcome_detail: string | null
  readonly catalog_job_id: string | null
  readonly idempotency_key: string | null
  readonly force_request_id: string | null
}

const AUDIT_COLUMNS = `id::text AS id, outcome, outcome_detail, catalog_job_id::text AS catalog_job_id,
                       idempotency_key, force_request_id::text AS force_request_id`

function toResult(row: AuditRow, repeatedSubmission: boolean): AdminActionResult {
  const outcome = (['enqueued', 'already_enqueued', 'refused', 'failed'] as const).find((o) => o === row.outcome)
  return {
    auditId: row.id,
    outcome: outcome ?? 'failed',
    detail: row.outcome_detail ?? '',
    catalogJobId: row.catalog_job_id,
    idempotencyKey: row.idempotency_key,
    forceRequestId: row.force_request_id,
    repeatedSubmission,
  }
}

async function findAuditByToken(
  db: Pick<PrismaClient, '$queryRawUnsafe'> | Tx,
  token: string,
): Promise<AdminActionResult | null> {
  const rows = await db.$queryRawUnsafe<AuditRow[]>(
    `SELECT ${AUDIT_COLUMNS} FROM admin_action_audits WHERE request_token = $1`,
    token,
  )
  const row = rows[0]
  return row === undefined ? null : toResult(row, true)
}

interface AuditInsert {
  readonly kind: AdminActionKind
  readonly target: AdminTitleTarget | null
  readonly queue: string | null
  readonly actor: AdminActor
  readonly token: string
  readonly estimate: unknown
  readonly outcome: AdminActionOutcome
  readonly detail: string
  readonly catalogJobId: string | null
  readonly idempotencyKey: string | null
  readonly forceRequestId: string | null
  readonly now: Date
}

async function insertAudit(tx: Tx | Pick<PrismaClient, '$queryRawUnsafe'>, row: AuditInsert): Promise<AdminActionResult> {
  const rows = await tx.$queryRawUnsafe<AuditRow[]>(
    `INSERT INTO admin_action_audits
       (action_kind, entity_type, entity_id, tmdb_id, queue, actor_kind, actor_label, request_token,
        estimate, outcome, outcome_detail, catalog_job_id, idempotency_key, force_request_id, requested_at)
     VALUES ($1, CAST($2::text AS "EntityType"), $3::bigint, $4::int, $5, $6, $7, $8,
             $9::jsonb, $10, $11, $12::bigint, $13, $14::bigint, $15::timestamptz AT TIME ZONE 'UTC')
     RETURNING ${AUDIT_COLUMNS}`,
    row.kind,
    row.target?.entityType ?? null,
    row.target?.entityId ?? null,
    row.target?.tmdbId ?? null,
    row.queue,
    row.actor.kind,
    clip(row.actor.label.trim() || 'operador sem rotulo', LABEL_MAX),
    row.token,
    JSON.stringify(row.estimate ?? null),
    row.outcome,
    clip(row.detail, DETAIL_MAX),
    row.catalogJobId,
    row.idempotencyKey,
    row.forceRequestId,
    row.now.toISOString(),
  )
  const inserted = rows[0]
  if (inserted === undefined) throw new Error('auditoria nao retornou linha')
  return toResult(inserted, false)
}

/** A violacao de unique do nonce (corrida entre dois envios do mesmo formulario). */
function isTokenCollision(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const meta = (error as { meta?: { code?: unknown; message?: unknown } }).meta
  const message = error instanceof Error ? error.message : ''
  return meta?.code === '23505' || /admin_action_audits_request_token_key/.test(message)
}

/** Executa a transacao; na colisao do nonce devolve o desfecho do envio vencedor. */
async function withTokenGuard(
  db: AdminActionDb,
  token: string,
  work: (tx: Tx) => Promise<AdminActionResult>,
): Promise<AdminActionResult> {
  try {
    return await db.$transaction(async (tx) => {
      const repeated = await findAuditByToken(tx, token)
      if (repeated !== null) return repeated
      return work(tx)
    })
  } catch (error) {
    if (isTokenCollision(error)) {
      const repeated = await findAuditByToken(db, token)
      if (repeated !== null) return repeated
    }
    throw error
  }
}

/** Grava a RECUSA (custo nao cabe, titulo sem imdb_id...) sem enfileirar nada. */
export async function recordRefusedAdminAction(
  db: AdminActionDb,
  input: {
    readonly kind: AdminActionKind
    readonly target: AdminTitleTarget | null
    readonly queue: string | null
    readonly actor: AdminActor
    readonly token: string
    readonly estimate: unknown
    readonly reason: string
    readonly now: Date
  },
): Promise<AdminActionResult> {
  if (!isAdminRequestToken(input.token)) throw new Error('token de confirmacao invalido')
  return withTokenGuard(db, input.token, (tx) =>
    insertAudit(tx, {
      kind: input.kind,
      target: input.target,
      queue: input.queue,
      actor: input.actor,
      token: input.token,
      estimate: input.estimate,
      outcome: 'refused',
      detail: input.reason,
      catalogJobId: null,
      idempotencyKey: null,
      forceRequestId: null,
      now: input.now,
    }),
  )
}

/**
 * Enfileira detalhe, midia ou temporadas de UM titulo.
 *
 * Se ja ha um job DO PAINEL aberto para o mesmo titulo e tipo, nao cria outro: a
 * auditoria registra `already_enqueued` com o id do job que esta na fila. Job do
 * AGENDADOR aberto nao impede — ele pode estar atras de milhares; o do painel
 * entra na prioridade 10.
 */
export async function enqueueAdminCatalogRefresh(
  db: AdminActionDb,
  input: {
    readonly action: AdminCatalogAction
    readonly target: AdminTitleTarget
    readonly actor: AdminActor
    readonly token: string
    readonly estimate: unknown
    readonly now: Date
  },
): Promise<AdminActionResult> {
  const kind = ADMIN_ACTION_KIND_BY_TITLE_ACTION[input.action]
  if (!isAdminRequestToken(input.token)) throw new Error('token de confirmacao invalido')

  return withTokenGuard(db, input.token, async (tx) => {
    const base = {
      kind,
      target: input.target,
      queue: null,
      actor: input.actor,
      token: input.token,
      estimate: input.estimate,
      now: input.now,
    }
    const plan = planAdminCatalogJob({
      action: input.action,
      kind: input.target.entityType,
      tmdbId: input.target.tmdbId ?? 0,
      token: input.token,
    })
    if (!plan.ok) {
      return insertAudit(tx, {
        ...base,
        outcome: 'refused',
        detail: plan.reason,
        catalogJobId: null,
        idempotencyKey: null,
        forceRequestId: null,
      })
    }

    const open = await tx.$queryRawUnsafe<Array<{ id: string; idempotency_key: string }>>(
      `SELECT id::text AS id, idempotency_key
         FROM catalog_jobs
        WHERE job_type = CAST($1::text AS "CatalogJobType")
          AND entity_type = CAST($2::text AS "TmdbEntityKind")
          AND external_id = $3
          AND run_id LIKE $4
          AND status IN ${OPEN_JOB_STATUSES}
        ORDER BY id DESC
        LIMIT 1`,
      plan.job.jobType,
      plan.job.entityType ?? null,
      plan.job.externalId ?? null,
      `${ADMIN_SCOPE_PREFIX}%`,
    )
    const existing = open[0]
    if (existing !== undefined) {
      return insertAudit(tx, {
        ...base,
        outcome: 'already_enqueued',
        detail: `ja havia um pedido do painel aberto para este titulo (job ${existing.id}); nada novo foi enfileirado`,
        catalogJobId: existing.id,
        idempotencyKey: existing.idempotency_key,
        forceRequestId: null,
      })
    }

    // A MESMA porta de enfileiramento do worker e do agendador. O adapter recebe
    // o cliente da transacao: o job so existe se a auditoria tambem existir.
    const store = createPrismaCatalogJobStore(tx as unknown as PrismaClient, { now: () => input.now })
    const enqueued = await store.enqueue(plan.job)
    return insertAudit(tx, {
      ...base,
      outcome: enqueued.created ? 'enqueued' : 'already_enqueued',
      detail: enqueued.created
        ? `job ${enqueued.id} (${plan.job.jobType}) na prioridade ${String(plan.job.priority ?? 100)}`
        : `a chave ja existia (job ${enqueued.id}); nada novo foi enfileirado`,
      catalogJobId: enqueued.id,
      idempotencyKey: plan.job.idempotencyKey,
      forceRequestId: null,
    })
  })
}

/**
 * Pede ao `screen-cron` um ciclo de fila, a nota externa ou o Score de um titulo.
 *
 * No maximo UM pedido aberto por alvo (indice unico parcial): o segundo clique
 * encontra o primeiro e a auditoria registra `already_enqueued`.
 */
export async function requestAdminSchedulerRun(
  db: AdminActionDb,
  input: {
    readonly request:
      | { readonly kind: 'queue'; readonly queue: string }
      | { readonly kind: 'title_ratings' | 'title_score'; readonly target: AdminTitleTarget }
    readonly actor: AdminActor
    readonly token: string
    readonly estimate: unknown
    readonly now: Date
  },
): Promise<AdminActionResult> {
  if (!isAdminRequestToken(input.token)) throw new Error('token de confirmacao invalido')
  const request = input.request
  const kind: AdminActionKind =
    request.kind === 'queue' ? 'force_queue' : request.kind === 'title_ratings' ? 'force_title_ratings' : 'force_title_score'
  const target = request.kind === 'queue' ? null : request.target
  const queue = request.kind === 'queue' ? request.queue : null

  return withTokenGuard(db, input.token, async (tx) => {
    const base = { kind, target, queue, actor: input.actor, token: input.token, estimate: input.estimate, now: input.now }
    const plan = planAdminSchedulerRequest(
      request.kind === 'queue'
        ? { kind: 'queue', queue: request.queue }
        : { kind: request.kind, entityType: request.target.entityType, entityId: request.target.entityId },
    )
    if (!plan.ok) {
      return insertAudit(tx, {
        ...base,
        outcome: 'refused',
        detail: plan.reason,
        catalogJobId: null,
        idempotencyKey: null,
        forceRequestId: null,
      })
    }

    const values =
      plan.kind === 'queue'
        ? { queue: plan.queue, entityType: null, entityId: null }
        : { queue: null, entityType: plan.entityType, entityId: plan.entityId }

    const inserted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO scheduler_force_requests (kind, queue, entity_type, entity_id, requested_by, status, requested_at)
       VALUES ($1, $2, CAST($3::text AS "EntityType"), $4::bigint, $5, 'pending', $6::timestamptz AT TIME ZONE 'UTC')
       ON CONFLICT DO NOTHING
       RETURNING id::text AS id`,
      plan.kind,
      values.queue,
      values.entityType,
      values.entityId,
      clip(input.actor.label.trim() || 'operador sem rotulo', LABEL_MAX),
      input.now.toISOString(),
    )
    const created = inserted[0]
    if (created !== undefined) {
      return insertAudit(tx, {
        ...base,
        outcome: 'enqueued',
        detail: `pedido ${created.id} aguardando o proximo tique do screen-cron`,
        catalogJobId: null,
        idempotencyKey: null,
        forceRequestId: created.id,
      })
    }

    // Mesmo alvo dos dois unique parciais da migration: fila por queue; titulo por
    // (kind, entity_type, entity_id). IS NOT DISTINCT FROM casa o NULL do outro lado.
    const open = await tx.$queryRawUnsafe<Array<{ id: string; status: string }>>(
      `SELECT id::text AS id, status
         FROM scheduler_force_requests
        WHERE kind = $1
          AND queue IS NOT DISTINCT FROM $2::text
          AND entity_type IS NOT DISTINCT FROM CAST($3::text AS "EntityType")
          AND entity_id IS NOT DISTINCT FROM $4::bigint
          AND status IN ('pending', 'running')
        ORDER BY id DESC
        LIMIT 1`,
      plan.kind,
      values.queue,
      values.entityType,
      values.entityId,
    )
    const existing = open[0]
    return insertAudit(tx, {
      ...base,
      outcome: 'already_enqueued',
      detail:
        existing === undefined
          ? 'ja havia um pedido aberto para este alvo; nada novo foi enfileirado'
          : `ja havia o pedido ${existing.id} (${existing.status}) para este alvo; nada novo foi enfileirado`,
      catalogJobId: null,
      idempotencyKey: null,
      forceRequestId: existing?.id ?? null,
    })
  })
}
