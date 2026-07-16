/**
 * catalog-job-store.ts — Adapter Prisma da fila de jobs do catalogo (Backend A).
 * EXCLUIDO do typecheck (adapters Prisma em persistence/), como job-claim.ts.
 *
 * Implementa `CatalogJobStorePort`. O claim e concorrente-seguro via
 * `FOR UPDATE SKIP LOCKED` (dois workers nunca pegam o mesmo job) — mesmo padrao
 * provado do EntityWriterJob. As DECISOES (retry vs dead-letter, reclaim, replay)
 * ficam nos planejadores PUROS de ../catalog-jobs; aqui so ha IO + conversao.
 */

import type { Prisma } from '@prisma/client'
import type { PrismaClient } from '@screena/db/server'
import { planReclaim, planReplay } from '../catalog-jobs/transitions.js'
import type { JobBackoffConfig } from '../catalog-jobs/backoff.js'
import type {
  CatalogJobStorePort,
  ClaimCatalogOptions,
  ClaimedCatalogJob,
  DeadLetterEntry,
  EnqueueCatalogJobInput,
  EnqueueResult,
  ReclaimResult,
  ResolvedFailure,
} from '../catalog-jobs/store-port.js'
import type { CatalogEntityKind, CatalogJobType } from '../catalog-jobs/types.js'

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

/** true se o erro do Prisma e violacao de unique (idempotency_key). */
function isUniqueViolation(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (code === 'P2002') return true
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && /idempotency_key|23505|duplicate key/i.test(message)
}

function asPayload(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** Linha crua do claim (SQL raw devolve snake_case, nao o shape do Prisma). */
interface RawClaimRow {
  id: bigint
  job_type: CatalogJobType
  entity_type: CatalogEntityKind | null
  external_id: string | null
  payload: unknown
  max_attempts: number
  run_id: string | null
}

function toClaimed(row: RawClaimRow, attempts: number): ClaimedCatalogJob {
  return {
    id: row.id.toString(),
    jobType: row.job_type,
    entityType: row.entity_type,
    externalId: row.external_id,
    payload: asPayload(row.payload),
    attempts,
    maxAttempts: row.max_attempts,
    runId: row.run_id,
  }
}

/** Opcoes do adapter: relogio + config de backoff + fonte de jitter (injetaveis). */
export interface PrismaCatalogJobStoreDeps {
  readonly now?: () => Date
  readonly backoff?: JobBackoffConfig
  readonly random?: () => number
}

/** Cria um `CatalogJobStorePort` apoiado no Prisma. */
export function createPrismaCatalogJobStore(
  prisma: PrismaClient,
  deps: PrismaCatalogJobStoreDeps = {},
): CatalogJobStorePort {
  const now = deps.now ?? (() => new Date())
  const random = deps.random ?? Math.random

  return {
    async enqueue(input: EnqueueCatalogJobInput): Promise<EnqueueResult> {
      try {
        const job = await prisma.catalogJob.create({
          data: {
            jobType: input.jobType,
            status: 'pending',
            entityType: input.entityType ?? null,
            externalId: input.externalId ?? null,
            // `Record<string, unknown>` nao casa com `InputJsonValue` (que exige
            // valores JSON-serializaveis). O payload E JSON por contrato da
            // porta; o cast marca essa fronteira em vez de afrouxar o tipo.
            payload: (input.payload ?? {}) as Prisma.InputJsonValue,
            idempotencyKey: input.idempotencyKey,
            priority: input.priority ?? 100,
            maxAttempts: input.maxAttempts ?? 5,
            availableAt: input.availableAt ?? now(),
            runId: input.runId ?? null,
          },
          select: { id: true },
        })
        return { id: job.id.toString(), created: true }
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Outro enfileiramento com a mesma chave ja existe: noop idempotente.
          const existing = await prisma.catalogJob.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            select: { id: true },
          })
          return { id: existing ? existing.id.toString() : '0', created: false }
        }
        throw error
      }
    },

    async claimNext(options: ClaimCatalogOptions = {}): Promise<ClaimedCatalogJob | null> {
      const at = now()

      // Dry-run: peek somente-leitura (nao muta).
      if (options.dryRun) {
        const row = await prisma.catalogJob.findFirst({
          where: {
            status: { in: ['pending', 'retry_wait'] },
            availableAt: { lte: at },
          },
          orderBy: [{ priority: 'asc' }, { availableAt: 'asc' }],
          select: {
            id: true,
            jobType: true,
            entityType: true,
            externalId: true,
            payload: true,
            attempts: true,
            maxAttempts: true,
            runId: true,
          },
        })
        if (row === null) return null
        return {
          id: row.id.toString(),
          jobType: row.jobType,
          entityType: row.entityType,
          externalId: row.externalId,
          payload: asPayload(row.payload),
          attempts: row.attempts,
          maxAttempts: row.maxAttempts,
          runId: row.runId,
        }
      }

      // Claim concorrente-seguro: SELECT ... FOR UPDATE SKIP LOCKED + UPDATE.
      // `available_at` e `timestamp` (sem tz), gravado pelo Prisma como wall-clock
      // UTC. Comparar com um Date cru em raw SQL sofreria conversao pela timezone
      // da sessao; por isso o horario entra como ISO string e e trazido ao mesmo
      // frame UTC-wall-clock (::timestamptz AT TIME ZONE 'UTC') — deterministico.
      const atIso = at.toISOString()
      return prisma.$transaction(async (tx: Tx) => {
        // `$queryRaw` devolve `unknown` sem o parametro de tipo: o shape vem do
        // SELECT acima (snake_case), nao do model Prisma.
        const rows = await tx.$queryRaw<(RawClaimRow & { attempts: number })[]>`
          SELECT id, job_type, entity_type, external_id, payload, attempts, max_attempts, run_id
          FROM catalog_jobs
          WHERE status::text IN ('pending', 'retry_wait')
            AND available_at <= ${atIso}::timestamptz AT TIME ZONE 'UTC'
          ORDER BY priority ASC, available_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`
        const picked = rows[0]
        if (picked === undefined) return null

        await tx.catalogJob.update({
          where: { id: picked.id },
          data: {
            status: 'running',
            claimedAt: at,
            heartbeatAt: at,
            attempts: { increment: 1 },
          },
        })
        // attempts retornado ja reflete a tentativa em curso (pos-incremento).
        return toClaimed(picked, picked.attempts + 1)
      })
    },

    async heartbeat(id: string): Promise<void> {
      await prisma.catalogJob.updateMany({
        where: { id: BigInt(id), status: 'running' },
        data: { heartbeatAt: now() },
      })
    },

    async complete(id: string): Promise<void> {
      // Guard de estado: so completa um job AINDA em voo. updateMany (nao update)
      // permite a precondicao de status — se um reaper ja tirou o job de 'running',
      // este completa 0 linhas em vez de ressuscitar/clobrar um estado terminal.
      await prisma.catalogJob.updateMany({
        where: { id: BigInt(id), status: { in: ['claimed', 'running'] } },
        data: { status: 'succeeded', completedAt: now() },
      })
    },

    async applyFailure(id: string, failure: ResolvedFailure): Promise<void> {
      // Guard de estado: so falha um job em voo (nao clobra succeeded/cancelled
      // nem um retry_wait/dead_letter ja aplicado por outro caminho).
      await prisma.catalogJob.updateMany({
        where: { id: BigInt(id), status: { in: ['claimed', 'running'] } },
        data: {
          status: failure.status,
          availableAt: failure.availableAt ?? undefined,
          completedAt: failure.status === 'dead_letter' ? now() : null,
          lastErrorCode: failure.lastErrorCode,
          lastErrorSafe: failure.lastErrorSafe,
        },
      })
    },

    async reclaimOrphans(timeoutMs: number): Promise<ReclaimResult> {
      const at = now()
      const threshold = new Date(at.getTime() - timeoutMs)
      // Orfaos: em voo (claimed/running) com heartbeat OU claimedAt (fallback) velhos.
      const candidates = await prisma.catalogJob.findMany({
        where: {
          status: { in: ['claimed', 'running'] },
          OR: [
            { heartbeatAt: { lt: threshold } },
            { heartbeatAt: null, claimedAt: { lt: threshold } },
          ],
        },
        select: { id: true, attempts: true, maxAttempts: true },
      })

      let requeued = 0
      let deadLettered = 0
      for (const job of candidates) {
        const plan = planReclaim(
          { attempts: job.attempts, maxAttempts: job.maxAttempts },
          random(),
          deps.backoff,
        )
        const availableAt =
          plan.availableInMs === null ? null : new Date(at.getTime() + plan.availableInMs)
        // Guard de estado (updateMany): so recupera se o job AINDA esta em voo.
        // Se o worker que parecia morto terminou entre o findMany e este update, o
        // update casa 0 linhas e nao clobra o estado terminal (sem re-execucao).
        const applied = await prisma.catalogJob.updateMany({
          where: { id: job.id, status: { in: ['claimed', 'running'] } },
          data: {
            status: plan.status,
            availableAt: availableAt ?? undefined,
            completedAt: plan.status === 'dead_letter' ? at : null,
            lastErrorCode: plan.lastErrorCode,
            lastErrorSafe: plan.lastErrorSafe,
          },
        })
        if (applied.count === 0) continue // job saiu de voo concorrentemente
        if (plan.status === 'dead_letter') deadLettered += 1
        else requeued += 1
      }
      return { requeued, deadLettered }
    },

    async listDeadLetter(limit: number): Promise<DeadLetterEntry[]> {
      const rows = await prisma.catalogJob.findMany({
        where: { status: 'dead_letter' },
        orderBy: { id: 'asc' },
        take: limit,
        select: {
          id: true,
          jobType: true,
          entityType: true,
          externalId: true,
          attempts: true,
          lastErrorCode: true,
          lastErrorSafe: true,
        },
      })
      return rows.map((row) => ({
        id: row.id.toString(),
        jobType: row.jobType,
        entityType: row.entityType,
        externalId: row.externalId,
        attempts: row.attempts,
        lastErrorCode: row.lastErrorCode,
        lastErrorSafe: row.lastErrorSafe,
      }))
    },

    async replayDeadLetter(ids?: readonly string[]): Promise<number> {
      // Distingue "todos" (ids === undefined) de "estes zero" (ids === []): uma
      // selecao vazia NUNCA deve reprocessar a fila inteira de poison.
      if (ids !== undefined && ids.length === 0) return 0
      const replay = planReplay()
      const at = now()
      const result = await prisma.catalogJob.updateMany({
        where: {
          status: 'dead_letter',
          ...(ids !== undefined ? { id: { in: ids.map((id) => BigInt(id)) } } : {}),
        },
        data: {
          status: replay.status,
          attempts: replay.attempts,
          availableAt: at,
          claimedAt: null,
          heartbeatAt: null,
          completedAt: null,
          lastErrorCode: null,
          lastErrorSafe: null,
        },
      })
      return result.count
    },
  }
}
