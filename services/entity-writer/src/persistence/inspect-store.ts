/**
 * inspect-store.ts — Adapter Prisma READ-ONLY de inspecao. EXCLUIDO do typecheck.
 *
 * Implementa `InspectStorePort` usando SOMENTE leitura: `groupBy` (contagens) e
 * `findMany` (listas recentes). NUNCA escreve nem usa SQL bruto (travado por
 * teste estrutural). Nao chama IA, nao acessa rede. So usa campos reais do
 * schema; nenhuma migration.
 *
 * Toda lista recente respeita `take: limit`; os filtros (entityType opcional +
 * languageCode) sao aplicados em todas as consultas. Ids vem como string, datas
 * como ISO; mensagens de erro vem cruas e sao resumidas pela camada pura.
 */

import type { PrismaClient } from "@screena/db/server";
import type {
  CountBucket,
  InspectStorePort,
  InspectQuery,
  InspectionData,
} from "../inspect/inspect-entity-writer.js";

/** Converte linhas de groupBy ({ [key]: value, _count: { _all } }) em buckets. */
function toBuckets(rows: ReadonlyArray<Record<string, unknown>>, key: string): CountBucket[] {
  return rows.map((row) => {
    const counter = row._count as { _all: number };
    return { key: String(row[key]), count: counter._all };
  });
}

/** ISO de uma Date | null (ou null). */
function toIso(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString();
}

/** Cria um `InspectStorePort` READ-ONLY apoiado no Prisma. */
export function createPrismaInspectStore(prisma: PrismaClient): InspectStorePort {
  return {
    async collect(query: InspectQuery): Promise<InspectionData> {
      const limit = query.limit;
      const where = {
        ...(query.entityType !== undefined ? { entityType: query.entityType } : {}),
        languageCode: query.languageCode,
      };
      // entity_writer_logs nao tem coluna languageCode em todos os fluxos? Tem
      // (language_code), entao reusamos o mesmo filtro tambem nos logs.

      const [
        jobsByStatus,
        jobsByType,
        jobsByEntityType,
        blocksByReviewStatus,
        blocksByBlockType,
        blocksBySourceType,
        recentFailedJobs,
        recentLogErrors,
        recentCompletedJobs,
        entitiesWithBlocks,
      ] = await Promise.all([
        prisma.entityWriterJob.groupBy({ by: ["status"], where, _count: { _all: true } }),
        prisma.entityWriterJob.groupBy({ by: ["jobType"], where, _count: { _all: true } }),
        prisma.entityWriterJob.groupBy({ by: ["entityType"], where, _count: { _all: true } }),
        prisma.contentBlock.groupBy({ by: ["reviewStatus"], where, _count: { _all: true } }),
        prisma.contentBlock.groupBy({ by: ["blockType"], where, _count: { _all: true } }),
        prisma.contentBlock.groupBy({ by: ["sourceType"], where, _count: { _all: true } }),
        prisma.entityWriterJob.findMany({
          where: {
            ...where,
            OR: [{ status: "failed" }, { status: "blocked" }, { lastError: { not: null } }],
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          select: {
            id: true,
            entityType: true,
            entityId: true,
            languageCode: true,
            status: true,
            attempts: true,
            lastError: true,
            updatedAt: true,
          },
        }),
        prisma.entityWriterLog.findMany({
          where: {
            ...where,
            OR: [{ validationStatus: "failed" }, { errorMessage: { not: null } }],
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: {
            id: true,
            jobId: true,
            entityType: true,
            entityId: true,
            validationStatus: true,
            errorMessage: true,
            createdAt: true,
          },
        }),
        prisma.entityWriterJob.findMany({
          where: { ...where, status: "completed" },
          orderBy: { completedAt: "desc" },
          take: limit,
          select: {
            id: true,
            entityType: true,
            entityId: true,
            languageCode: true,
            jobType: true,
            resultBlockId: true,
            completedAt: true,
          },
        }),
        prisma.contentBlock.groupBy({
          by: ["entityType", "entityId", "languageCode"],
          where,
          _count: { _all: true },
          orderBy: { entityId: "desc" },
          take: limit,
        }),
      ]);

      return {
        jobsByStatus: toBuckets(jobsByStatus, "status"),
        jobsByType: toBuckets(jobsByType, "jobType"),
        jobsByEntityType: toBuckets(jobsByEntityType, "entityType"),
        blocksByReviewStatus: toBuckets(blocksByReviewStatus, "reviewStatus"),
        blocksByBlockType: toBuckets(blocksByBlockType, "blockType"),
        blocksBySourceType: toBuckets(blocksBySourceType, "sourceType"),
        recentFailedJobs: recentFailedJobs.map((job) => ({
          id: job.id.toString(),
          entityType: String(job.entityType),
          entityId: job.entityId.toString(),
          languageCode: job.languageCode,
          status: String(job.status),
          attempts: job.attempts,
          lastError: job.lastError,
          updatedAt: toIso(job.updatedAt),
        })),
        recentLogErrors: recentLogErrors.map((log) => ({
          id: log.id.toString(),
          jobId: log.jobId.toString(),
          entityType: String(log.entityType),
          entityId: log.entityId.toString(),
          validationStatus: log.validationStatus == null ? null : String(log.validationStatus),
          errorMessage: log.errorMessage,
          createdAt: toIso(log.createdAt),
        })),
        recentCompletedJobs: recentCompletedJobs.map((job) => ({
          id: job.id.toString(),
          entityType: String(job.entityType),
          entityId: job.entityId.toString(),
          languageCode: job.languageCode,
          jobType: String(job.jobType),
          resultBlockId: job.resultBlockId == null ? null : job.resultBlockId.toString(),
          completedAt: toIso(job.completedAt),
        })),
        entitiesWithBlocks: entitiesWithBlocks.map((group) => {
          const counter = group._count as { _all: number };
          return {
            entityType: String(group.entityType),
            entityId: group.entityId.toString(),
            languageCode: group.languageCode,
            blockCount: counter._all,
          };
        }),
      };
    },
  };
}
