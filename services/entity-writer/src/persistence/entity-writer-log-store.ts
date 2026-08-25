/**
 * entity-writer-log-store.ts — Adapter Prisma de `entity_writer_logs`. COBERTO pelo
 * typecheck da raiz (`pnpm typecheck`).
 *
 * Grava UMA linha por tentativa de geracao/validacao, usando somente as colunas
 * reais do schema (sem step/status/latency_ms/block_type). O mapeamento mora no
 * planner puro (../pipeline/persistence-plan); aqui so ha IO + BigInt/Json.
 */

import type { PrismaClient } from "@screena/db/server";
import type { EntityWriterLogInput, EntityWriterLogPort } from "../ports.js";
import { planLog } from "../pipeline/persistence-plan.js";

/** Cria um `EntityWriterLogPort` que grava em `entity_writer_logs` via Prisma. */
export function createPrismaEntityWriterLogStore(prisma: PrismaClient): EntityWriterLogPort {
  return {
    async write(input: EntityWriterLogInput): Promise<void> {
      const data = planLog(input);
      await prisma.entityWriterLog.create({
        data: {
          jobId: BigInt(data.jobId),
          entityType: data.entityType,
          entityId: BigInt(data.entityId),
          languageCode: data.languageCode,
          modelProvider: data.modelProvider,
          modelName: data.modelName,
          promptVersion: data.promptVersion,
          inputHash: data.inputHash,
          outputHash: data.outputHash,
          tokenInput: data.tokenInput,
          tokenOutput: data.tokenOutput,
          validationStatus: data.validationStatus,
          warningsJson: [...data.warnings],
          errorMessage: data.errorMessage,
        },
      });
    },
  };
}
