/**
 * job-claim.ts — Adapter Prisma de claim de `entity_writer_jobs`. EXCLUIDO do typecheck.
 *
 * Reivindica o proximo job `queued` de forma concorrente-segura com
 * `FOR UPDATE SKIP LOCKED` (dois workers nunca pegam o mesmo job), marcando-o
 * `running` + `claimed_at` + `attempts++`. Em `dryRun` faz apenas "peek"
 * (findFirst, sem mutar). So usa campos reais do schema; nenhuma migration.
 */

import type { PrismaClient } from "@screena/db/server";
import type { ClaimedJob, ClaimOptions, JobClaimPort } from "../ports.js";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

interface RawJobRow {
  readonly id: bigint;
  readonly entity_type: string;
  readonly entity_id: bigint;
  readonly language_code: string;
}

function toClaimedJob(row: {
  id: bigint;
  entityType: string;
  entityId: bigint;
  languageCode: string;
}): ClaimedJob {
  return {
    id: row.id.toString(),
    entityType: row.entityType as ClaimedJob["entityType"],
    entityId: row.entityId.toString(),
    languageCode: row.languageCode,
  };
}

/** Cria um `JobClaimPort` apoiado no Prisma. */
export function createPrismaJobClaim(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
): JobClaimPort {
  return {
    async claimNext(options: ClaimOptions): Promise<ClaimedJob | null> {
      const language = options.languageCode;

      // Dry-run: somente leitura (peek), sem mutar o job.
      if (options.dryRun) {
        const row = await prisma.entityWriterJob.findFirst({
          where: {
            status: "queued",
            ...(language !== undefined ? { languageCode: language } : {}),
            ...(options.jobId !== undefined ? { id: BigInt(options.jobId) } : {}),
          },
          orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
          select: { id: true, entityType: true, entityId: true, languageCode: true },
        });
        return row === null ? null : toClaimedJob(row);
      }

      // Claim concorrente-seguro: SELECT ... FOR UPDATE SKIP LOCKED + UPDATE.
      return prisma.$transaction(async (tx: Tx) => {
        const rows = await selectQueued(tx, language, options.jobId);
        const picked = rows[0];
        if (picked === undefined) return null;

        await tx.entityWriterJob.update({
          where: { id: picked.id },
          data: { status: "running", claimedAt: now(), attempts: { increment: 1 } },
        });

        return toClaimedJob({
          id: picked.id,
          entityType: picked.entity_type,
          entityId: picked.entity_id,
          languageCode: picked.language_code,
        });
      });
    },
  };
}

/** SELECT do proximo job `queued` com lock (SKIP LOCKED). */
function selectQueued(
  tx: Tx,
  language: string | undefined,
  jobId: string | undefined,
): Promise<RawJobRow[]> {
  if (jobId !== undefined) {
    return tx.$queryRaw<RawJobRow[]>`
      SELECT id, entity_type, entity_id, language_code
      FROM entity_writer_jobs
      WHERE status::text = 'queued' AND id = ${BigInt(jobId)}
      ORDER BY priority DESC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1`;
  }
  if (language !== undefined) {
    return tx.$queryRaw<RawJobRow[]>`
      SELECT id, entity_type, entity_id, language_code
      FROM entity_writer_jobs
      WHERE status::text = 'queued' AND language_code = ${language}
      ORDER BY priority DESC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1`;
  }
  return tx.$queryRaw<RawJobRow[]>`
    SELECT id, entity_type, entity_id, language_code
    FROM entity_writer_jobs
    WHERE status::text = 'queued'
    ORDER BY priority DESC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1`;
}
