/**
 * export-read-store.ts — adapter Prisma de `ExportReadStore` (Backend C, C7D).
 *
 * LEITURA, e so leitura, de TUDO que pertence a UM titular e e exportavel.
 *
 * O QUE TORNA ESTE ADAPTER SEGURO NAO E DISCIPLINA — E O TIPO. Ele recebe um
 * `PrismaExportExecutor`, um `Pick` que simplesmente NAO CONTEM
 * `passwordCredential`, `userSession`, `verificationToken` nem `authAuditLog`.
 * As quatro categorias que `DATA_CLASSIFICATION` marca como jamais exportaveis
 * sao inalcancaveis daqui: escrever `executor.userSession` nao compila.
 *
 * `assertExportContainsNoSecrets` (privacy/export.ts) continua rodando por cima
 * como rede de seguranca, mas nao e a unica linha de defesa — e uma varredura de
 * CHAVES, e uma varredura de chaves nao veria um hash gravado sob o nome
 * "valor".
 *
 * ESCOPO: `where: { userId }` em TODA consulta. Nao existe leitura sem filtro de
 * titular neste arquivo — e o que impede uma exportacao de carregar dado de
 * outra pessoa.
 */

import type { ExportReadStore } from "../ports.js";
import type { ExportProjectionResult, TransactionScope } from "../types.js";
import type { PrismaExportExecutor } from "./executor.js";
import { toConsentRecordRow, toDataRequestRecord, toProfileRecord } from "./mappers.js";

/**
 * `account_core`. O `id` INTERNO nao sai: e chave de banco, nao dado do
 * titular, e `DATA_CLASSIFICATION.account_core` diz explicitamente "o id
 * interno nunca sai". `handle`/`displayName` saem por `profile`.
 */
const ACCOUNT_SELECT = {
  email: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
  displayName: true,
  handle: true,
  profile: {
    select: {
      bio: true,
      avatarPath: true,
      locale: true,
      countryCode: true,
      timezone: true,
      // As preferencias sao dado PESSOAL e entram na exportacao LGPD. Deixa-las
      // de fora daria ao titular uma copia incompleta dos proprios dados.
      density: true,
      posterSize: true,
      visibility: true,
    },
  },
} as const;

export function createPrismaExportReadStore(executor: PrismaExportExecutor): ExportReadStore {
  return {
    async project(
      _scope: TransactionScope,
      userId: bigint,
    ): Promise<ExportProjectionResult> {
      const conta = await executor.user.findUnique({
        where: { id: userId },
        select: ACCOUNT_SELECT,
      });
      if (conta === null) {
        return { kind: "not_found" };
      }

      // Cada leitura filtra por titular. As listas usam `ownerId` (a coluna se
      // chama `owner_id` neste model) — um `userId` aqui nao compilaria, o que e
      // exatamente a protecao que se quer.
      const [
        watchStates,
        episodeProgress,
        viewingEvents,
        lists,
        ratings,
        reviews,
        stats,
        consents,
        requests,
        imports,
      ] = await Promise.all([
        executor.userWatchState.findMany({
          where: { userId },
          orderBy: { id: "asc" },
          select: {
            entityType: true,
            entityId: true,
            status: true,
            startedAt: true,
            completedAt: true,
            rewatchCount: true,
            visibility: true,
          },
        }),
        executor.episodeProgress.findMany({
          where: { userId },
          orderBy: { id: "asc" },
          select: {
            episodeId: true,
            watched: true,
            watchedAt: true,
            progressSeconds: true,
            durationSeconds: true,
          },
        }),
        // `idempotencyKey` e `metadata` NAO saem: a primeira e chave interna de
        // deduplicacao (nao e fato sobre o titular) e a segunda e Json livre
        // cujo conteudo esta fora do alcance de qualquer varredura de chaves.
        executor.viewingEvent.findMany({
          where: { userId },
          orderBy: { id: "asc" },
          select: {
            entityType: true,
            entityId: true,
            eventType: true,
            occurredAt: true,
            source: true,
          },
        }),
        executor.userList.findMany({
          where: { ownerId: userId },
          orderBy: { id: "asc" },
          select: {
            kind: true,
            systemKey: true,
            title: true,
            slug: true,
            description: true,
            visibility: true,
            ordered: true,
            createdAt: true,
            deletedAt: true,
            items: {
              orderBy: { id: "asc" },
              select: {
                entityType: true,
                entityId: true,
                position: true,
                note: true,
                addedAt: true,
              },
            },
          },
        }),
        executor.userRating.findMany({
          where: { userId },
          orderBy: { id: "asc" },
          select: {
            entityType: true,
            entityId: true,
            value: true,
            scale: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        executor.userReview.findMany({
          where: { userId },
          orderBy: { id: "asc" },
          select: {
            entityType: true,
            entityId: true,
            title: true,
            body: true,
            containsSpoiler: true,
            status: true,
            visibility: true,
            publishedAt: true,
            createdAt: true,
            deletedAt: true,
          },
        }),
        executor.userStatsSnapshot.findUnique({
          where: { userId },
          select: { algorithmVersion: true, computedAt: true, stats: true },
        }),
        executor.consentRecord.findMany({
          where: { userId },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          select: { kind: true, granted: true, policyVersion: true, occurredAt: true },
        }),
        executor.dataRequest.findMany({
          where: { userId },
          orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            kind: true,
            status: true,
            requestedAt: true,
            processedAt: true,
          },
        }),
        // C8 — METADADO da importacao. `preview`/`conflicts` NAO entram: sao
        // Json de trabalho com as linhas normalizadas do arquivo enviado, e o
        // que o titular ja possui (o proprio arquivo) nao precisa voltar pela
        // exportacao inflando-a. O que importa para transparencia e o registro
        // do pedido: quando, de onde, quantos itens, qual desfecho.
        executor.importJob.findMany({
          where: { userId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            source: true,
            status: true,
            fileName: true,
            itemCount: true,
            conflictCount: true,
            appliedCount: true,
            appliedAt: true,
            createdAt: true,
          },
        }),
      ]);

      return {
        kind: "found",
        projection: {
          accountCore: {
            email: conta.email,
            status: conta.status,
            emailVerifiedAt: conta.emailVerifiedAt,
            createdAt: conta.createdAt,
          },
          profile: toProfileRecord(conta),
          productContent: {
            watchStates,
            episodeProgress,
            viewingEvents,
            lists,
            ratings,
            reviews,
          },
          productStats: stats,
          governanceConsents: consents.map(toConsentRecordRow),
          governanceRequests: requests.map(toDataRequestRecord),
          governanceImports: imports,
        },
      };
    },
  };
}
