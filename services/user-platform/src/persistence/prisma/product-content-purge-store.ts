/**
 * product-content-purge-store.ts — adapter Prisma de `ProductContentPurgeStore`
 * (C8): execucao da retencao no encerramento/anonimizacao de conta.
 *
 * POR QUE ESTE ARQUIVO EXISTE. `DATA_CLASSIFICATION.product_content`
 * (privacy/policy.ts) prescreve `retentionAction: "delete"` desde o C3, e
 * `buildDeletionPlan` devolve esse plano desde entao. Ate o C8 NAO EXISTIA um
 * unico store de conteudo de produto, entao a anonimizacao do C7D tombava a
 * linha de `users` e deixava listas, tracking, diario e notas intactas: a
 * politica existia no dominio e nunca era executada. Este adapter fecha isso.
 *
 * O QUE E APAGADO (categoria `product_content`, acao `delete`):
 *   watch states, progresso de episodio, diario, itens de lista, listas, notas
 *   pessoais e jobs de importacao (com o preview, que carrega as linhas
 *   normalizadas do arquivo enviado).
 *
 * O QUE NAO E APAGADO, e por decisao explicita da MESMA politica:
 *   - `governance_consents` e `governance_requests`: `retain_indefinitely`,
 *     razao `legal_obligation` — sao a prova de consentimento e a trilha LGPD;
 *   - `security_audit`: `retain_until` (janela propria);
 *   - `product_stats`: `retain_indefinitely`, razao `aggregate_anonymous` — o
 *     snapshot e agregado e ja nao identifica ninguem depois do tombamento.
 *
 * ORDEM DAS EXCLUSOES: filhos antes de pais. `user_list_items` tem FK para
 * `user_lists` com ON DELETE CASCADE — o cascade daria conta —, mas apagar
 * explicitamente na ordem correta mantem a CONTAGEM devolvida honesta (o
 * cascade nao reporta quantas linhas levou junto).
 */

import type { ProductContentPurgeStore } from "../ports.js";
import type { TransactionScope } from "../types.js";
import type { PrismaLibraryExecutor } from "./executor.js";

export function createPrismaProductContentPurgeStore(
  executor: PrismaLibraryExecutor,
): ProductContentPurgeStore {
  return {
    async purgeForUser(
      _scope: TransactionScope,
      userId: bigint,
    ): Promise<{
      readonly watchStates: number;
      readonly episodeProgress: number;
      readonly viewingEvents: number;
      readonly listItems: number;
      readonly lists: number;
      readonly ratings: number;
      readonly importJobs: number;
    }> {
      // Ids das listas ANTES de apaga-las: os itens sao filtrados por `listId`
      // (a tabela nao tem `user_id`), entao a relacao precisa ser resolvida
      // enquanto as listas ainda existem.
      const listas = await executor.userList.findMany({
        where: { ownerId: userId },
        select: { id: true },
      });
      // Nome em pt-BR de proposito: `listIds` colide com a guarda de fronteira
      // que proibe o vocabulario da API de CAMPANHA da Brevo (`\blistIds\b`).
      // A guarda protege uma invariante real; o nome local e que cede.
      const idsDasListas = listas.map((l) => l.id);

      const listItems =
        idsDasListas.length === 0
          ? { count: 0 }
          : await executor.userListItem.deleteMany({ where: { listId: { in: idsDasListas } } });

      // O diario e append-only para o PRODUTO (nao ha update/delete no port de
      // eventos), mas o direito de exclusao do titular esta acima disso: a
      // retencao de `product_content` manda apagar, e este e o unico caminho
      // autorizado a faze-lo.
      const [viewingEvents, episodeProgress, watchStates, ratings, importJobs] = await Promise.all([
        executor.viewingEvent.deleteMany({ where: { userId } }),
        executor.episodeProgress.deleteMany({ where: { userId } }),
        executor.userWatchState.deleteMany({ where: { userId } }),
        executor.userRating.deleteMany({ where: { userId } }),
        executor.importJob.deleteMany({ where: { userId } }),
      ]);

      const lists = await executor.userList.deleteMany({ where: { ownerId: userId } });

      return {
        watchStates: watchStates.count,
        episodeProgress: episodeProgress.count,
        viewingEvents: viewingEvents.count,
        listItems: listItems.count,
        lists: lists.count,
        ratings: ratings.count,
        importJobs: importJobs.count,
      };
    },
  };
}
