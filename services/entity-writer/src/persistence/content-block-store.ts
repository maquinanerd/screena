/**
 * content-block-store.ts — Adapter Prisma de `content_blocks`. COBERTO pelo typecheck
 * da raiz (`pnpm typecheck`).
 *
 * Persiste um `ContentBlockRecord` com estrategia archive + insert (D3.6): numa
 * transacao, arquiva as versoes ATIVAS de IA do mesmo alvo (decisao do planner
 * puro) e insere a nova versao. Nunca apaga fisicamente; nunca grava
 * `published`/`human_reviewed`. A decisao mora em ../pipeline/persistence-plan;
 * aqui so ha IO + conversao para BigInt/Json.
 */

import type { PrismaClient } from "@screena/db/server";
import type { ContentBlockRecord, ContentBlockSaveResult, ContentBlockStorePort } from "../ports.js";
import { planBlockPersistence } from "../pipeline/persistence-plan.js";

/** Cria um `ContentBlockStorePort` apoiado no Prisma (archive + insert). */
export function createPrismaContentBlockStore(prisma: PrismaClient): ContentBlockStorePort {
  return {
    async save(record: ContentBlockRecord): Promise<ContentBlockSaveResult> {
      const entityId = BigInt(record.entityId);
      // Retorna o id do bloco RECEM-CRIADO (nunca o de um arquivado/existente).
      const blockId = await prisma.$transaction(async (tx) => {
        // Versoes nao-arquivadas do mesmo alvo (o planner decide quais arquivar).
        const existing = await tx.contentBlock.findMany({
          where: {
            entityType: record.entityType,
            entityId,
            languageCode: record.languageCode,
            blockType: record.blockType,
            reviewStatus: { not: "archived" },
          },
          select: { id: true, reviewStatus: true, sourceType: true },
        });

        const plan = planBlockPersistence(
          existing.map((block) => ({
            id: block.id.toString(),
            reviewStatus: block.reviewStatus,
            sourceType: block.sourceType,
          })),
          record,
        );

        if (plan.archiveBlockIds.length > 0) {
          // Guarda defensiva: mesmo com o planner ja filtrando, o update so toca
          // blocos de IA substituiveis. Se houver mudanca concorrente entre a
          // leitura e o update, um bloco human/hybrid NUNCA e arquivado por acidente.
          await tx.contentBlock.updateMany({
            where: {
              id: { in: plan.archiveBlockIds.map((id) => BigInt(id)) },
              sourceType: "ai",
              reviewStatus: { in: ["ai_generated", "needs_review"] },
            },
            data: { reviewStatus: "archived" },
          });
        }

        const created = await tx.contentBlock.create({
          data: {
            entityType: plan.create.entityType,
            entityId,
            languageCode: plan.create.languageCode,
            blockType: plan.create.blockType,
            content: plan.create.content,
            sourceType: plan.create.sourceType,
            modelProvider: plan.create.modelProvider,
            modelName: plan.create.modelName,
            promptVersion: plan.create.promptVersion,
            inputHash: plan.create.inputHash,
            outputHash: plan.create.outputHash,
            reviewStatus: plan.create.reviewStatus,
            warningsJson: [...plan.create.warnings],
          },
          select: { id: true },
        });
        return created.id;
      });
      return { blockId: blockId.toString() };
    },
  };
}
