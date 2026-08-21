/**
 * job-enqueue.ts — Adapters Prisma de leitura + criacao de jobs. COBERTO pelo typecheck
 * da raiz (`pnpm typecheck`).
 *
 * Implementa as portas do enqueue (Fase 3B.4):
 *  - `EnqueueReadPort`: le blocos nao-arquivados do alvo e detecta job ativo
 *    (qualquer job_type) — guarda mais estrita que a unique parcial do schema.
 *  - `JobEnqueuePort`: cria UM job `status='queued'` com `payload_hash` e
 *    `prompt_version`. A corrida concorrente e tratada pela unique parcial
 *    `entity_writer_jobs_active_unique` (entity_type, entity_id, language_code,
 *    job_type WHERE status ativo): violacao vira `created=false`, nunca lanca.
 *
 * So usa campos reais do schema; nenhuma migration. A decisao mora no planner
 * puro (../runner/enqueue-plan); aqui so ha IO + conversao BigInt.
 */

import type { PrismaClient } from "@screena/db/server";
import type {
  BuildPayloadRequest,
  EnqueueJobInput,
  EnqueueReadPort,
  ExistingBlockRef,
  JobEnqueuePort,
  JobInsertResult,
} from "../ports.js";

/** Estados de job considerados ativos (espelha a unique parcial do schema). */
const ACTIVE_JOB_STATES = ["queued", "claimed", "running"] as const;

/** true se o erro do Prisma e violacao de unique (P2002) — corrida de job ativo. */
function isUniqueViolation(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "P2002") return true;
  // Rede de seguranca: indice parcial cru pode chegar como 23505 no message.
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /entity_writer_jobs_active_unique|23505|duplicate key/i.test(message);
}

/** Cria um `EnqueueReadPort` (blocos ativos + job ativo) apoiado no Prisma. */
export function createPrismaEnqueueRead(prisma: PrismaClient): EnqueueReadPort {
  return {
    async findActiveBlocks(target: BuildPayloadRequest): Promise<readonly ExistingBlockRef[]> {
      const blocks = await prisma.contentBlock.findMany({
        where: {
          entityType: target.entityType,
          entityId: BigInt(target.entityId),
          languageCode: target.languageCode,
          reviewStatus: { not: "archived" },
        },
        select: { blockType: true, reviewStatus: true, inputHash: true, promptVersion: true },
      });
      return blocks.map((block) => ({
        blockType: block.blockType,
        reviewStatus: block.reviewStatus,
        inputHash: block.inputHash,
        promptVersion: block.promptVersion,
      }));
    },

    async hasActiveJob(target: BuildPayloadRequest): Promise<boolean> {
      const count = await prisma.entityWriterJob.count({
        where: {
          entityType: target.entityType,
          entityId: BigInt(target.entityId),
          languageCode: target.languageCode,
          status: { in: [...ACTIVE_JOB_STATES] },
        },
      });
      return count > 0;
    },
  };
}

/** Cria um `JobEnqueuePort` que insere job `queued` (race-safe) via Prisma. */
export function createPrismaJobEnqueue(prisma: PrismaClient): JobEnqueuePort {
  return {
    async createJob(input: EnqueueJobInput): Promise<JobInsertResult> {
      try {
        const job = await prisma.entityWriterJob.create({
          data: {
            entityType: input.entityType,
            entityId: BigInt(input.entityId),
            languageCode: input.languageCode,
            jobType: input.jobType,
            status: "queued",
            payloadHash: input.payloadHash,
            promptVersion: input.promptVersion,
          },
          select: { id: true },
        });
        return { created: true, jobId: job.id.toString() };
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Outro worker enfileirou o mesmo alvo entre o read e o insert.
          return { created: false, jobId: null };
        }
        throw error;
      }
    },
  };
}
