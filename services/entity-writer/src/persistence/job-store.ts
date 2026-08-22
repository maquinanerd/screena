/**
 * job-store.ts — Adapter Prisma de `entity_writer_jobs`. COBERTO pelo typecheck da raiz
 * (`pnpm typecheck`).
 *
 * Marca o estado terminal de um job (`completed`/`failed`/`blocked`) usando os
 * campos reais do schema: `status`, `completed_at`, `result_block_id`,
 * `last_error`. Claim/enfileiramento/attempts ficam fora desta fatia. A regra de
 * carimbo de `completed_at` mora no planner puro.
 */

import type { PrismaClient } from "@screena/db/server";
import type { EntityWriterJobStorePort, JobCompletionInput } from "../ports.js";
import { planJobUpdate } from "../pipeline/persistence-plan.js";

/** Cria um `EntityWriterJobStorePort` apoiado no Prisma. */
export function createPrismaJobStore(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
): EntityWriterJobStorePort {
  return {
    async finishJob(input: JobCompletionInput): Promise<void> {
      const plan = planJobUpdate(input);
      await prisma.entityWriterJob.update({
        where: { id: BigInt(input.jobId) },
        data: {
          status: plan.status,
          completedAt: plan.setCompletedAt ? now() : null,
          resultBlockId: plan.resultBlockId === null ? null : BigInt(plan.resultBlockId),
          lastError: plan.lastError,
        },
      });
    },
  };
}
