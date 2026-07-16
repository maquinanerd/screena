/**
 * changes-checkpoint-store.ts — Adapter Prisma do checkpoint de `/changes`.
 * EXCLUIDO do typecheck (adapters Prisma em persistence/).
 *
 * Implementa o COMMIT ATOMICO exigido pelo §4: os jobs de re-sync da pagina e o
 * avanco do checkpoint acontecem na MESMA transacao. Se a transacao falha, o
 * checkpoint NAO avanca e a retomada reprocessa a pagina (seguro: o enqueue e
 * idempotente por idempotency_key).
 *
 * Detalhe critico: em Postgres, um statement que falha ABORTA a transacao — logo
 * NAO da para try/catch em violacao de unique dentro do tx. Usamos
 * `createMany({ skipDuplicates: true })` (ON CONFLICT DO NOTHING), que e
 * idempotente, atomico e nao lanca; `count` traz quantos entraram de fato.
 *
 * Reusa a tabela `tmdb_sync_checkpoint` (job='changes:{kind}', coluna `cursor`
 * ja reservada para a janela) — nenhuma tabela nova.
 */

import type { PrismaClient } from '@screena/db/server'
import type {
  ChangesCheckpointPort,
  ChangesCheckpointState,
  ChangesCommitInput,
} from '../changes/run.js'

/** Cria um `ChangesCheckpointPort` apoiado no Prisma. */
export function createPrismaChangesCheckpoint(prisma: PrismaClient): ChangesCheckpointPort {
  return {
    async read(job: string, paramsHash: string): Promise<ChangesCheckpointState | null> {
      const row = await prisma.tmdbSyncCheckpoint.findUnique({
        where: { job_paramsHash: { job, paramsHash } },
        select: { lastPage: true, totalPages: true, done: true, cursor: true },
      })
      if (row === null) return null
      return {
        lastPage: row.lastPage,
        totalPages: row.totalPages,
        done: row.done,
        cursor: row.cursor,
      }
    },

    async commit(input: ChangesCommitInput): Promise<{ enqueued: number }> {
      return prisma.$transaction(async (tx: PrismaClient) => {
        let enqueued = 0
        if (input.enqueue.length > 0) {
          const created = await tx.catalogJob.createMany({
            data: input.enqueue.map((job) => ({
              jobType: job.jobType,
              status: 'pending',
              entityType: job.entityType ?? null,
              externalId: job.externalId ?? null,
              payload: job.payload ?? {},
              idempotencyKey: job.idempotencyKey,
              priority: job.priority ?? 100,
              maxAttempts: job.maxAttempts ?? 5,
              runId: job.runId ?? null,
            })),
            // ON CONFLICT DO NOTHING: repetir a janela nao duplica nem aborta o tx.
            skipDuplicates: true,
          })
          enqueued = created.count
        }

        // O checkpoint avanca DENTRO da mesma transacao dos jobs.
        await tx.tmdbSyncCheckpoint.upsert({
          where: { job_paramsHash: { job: input.job, paramsHash: input.paramsHash } },
          create: {
            job: input.job,
            paramsHash: input.paramsHash,
            lastPage: input.lastPage,
            totalPages: input.totalPages,
            done: input.done,
            cursor: input.cursor,
          },
          update: {
            lastPage: input.lastPage,
            totalPages: input.totalPages,
            done: input.done,
            cursor: input.cursor,
          },
        })

        return { enqueued }
      })
    },
  }
}
