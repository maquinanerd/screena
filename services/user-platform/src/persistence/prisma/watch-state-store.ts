/**
 * watch-state-store.ts — adapter Prisma de `UserWatchStateStore` (C8).
 *
 * O watch state e a FONTE CANONICA de "quero assistir" (`planned`),
 * "assistindo" (`watching`) e "assistido" (`watched`) para filme e serie. O
 * CHECK do banco (`entity_type IN ('movie','tv')`) e a trava final; temporada e
 * episodio tem progresso proprio.
 *
 * DUAS REGRAS DA CAMADA APARECEM AQUI:
 *
 *  1. CONFLITO ESPERADO NAO ENVENENA A TRANSACAO (C7B1.1). A FK composta para
 *     `entities` recusaria uma entidade inexistente com violacao — e uma
 *     violacao deixa a transacao interativa ABORTADA, de modo que capturar a
 *     excecao nao a ressuscita. Por isso ha uma SONDA de existencia antes da
 *     escrita, e nenhum `catch` neste arquivo.
 *
 *  2. COMPARE-AND-SWAP sobre `version`. Duas abas mudando o mesmo titulo nao se
 *     sobrescrevem em silencio: a perdedora recebe `conflict` e o cliente relê.
 */

import type { UserWatchStateStore } from "../ports.js";
import type {
  TransactionScope,
  WatchStateLookupResult,
  WatchStatePage,
  WatchStateUpsertInput,
  WatchStateUpsertResult,
} from "../types.js";
import type { WatchState, WatchableEntityType } from "../../core/types.js";
import type { PrismaLibraryExecutor } from "./executor.js";
import { toWatchStateRecord } from "./mappers.js";

/**
 * SELECT do watch state: exatamente o que `WatchStateRecord` declara.
 *
 * `user_id` fica de fora — quem consultou ja o tem, e devolve-lo so ampliaria o
 * payload sem leitor.
 */
const WATCH_STATE_SELECT = {
  entityType: true,
  entityId: true,
  status: true,
  startedAt: true,
  completedAt: true,
  lastActivityAt: true,
  rewatchCount: true,
  visibility: true,
  version: true,
  updatedAt: true,
} as const;

/**
 * Sonda de existencia da entidade.
 *
 * Recebe o executor de CATALOGO por injecao (nao esta no executor de
 * biblioteca): e o unico ponto em que este adapter olha para fora das tabelas
 * `user_*`, e a assinatura torna essa dependencia visivel.
 */
export interface EntityProbe {
  exists(entityType: WatchableEntityType, entityId: bigint): Promise<boolean>;
}

export function createPrismaUserWatchStateStore(
  executor: PrismaLibraryExecutor,
  probe: EntityProbe,
): UserWatchStateStore {
  return {
    async find(
      _scope: TransactionScope,
      input: { readonly userId: bigint; readonly entityType: WatchableEntityType; readonly entityId: bigint },
    ): Promise<WatchStateLookupResult> {
      const row = await executor.userWatchState.findUnique({
        where: {
          userId_entityType_entityId: {
            userId: input.userId,
            entityType: input.entityType,
            entityId: input.entityId,
          },
        },
        select: WATCH_STATE_SELECT,
      });
      return row === null
        ? { kind: "not_found" }
        : { kind: "found", state: toWatchStateRecord(row) };
    },

    async upsert(
      _scope: TransactionScope,
      input: WatchStateUpsertInput,
    ): Promise<WatchStateUpsertResult> {
      if (input.expectedVersion === null) {
        // INSERCAO. A entidade e sondada ANTES: sem isso a FK composta para
        // `entities` levantaria violacao e abortaria a transacao interativa.
        const exists = await probe.exists(input.entityType, input.entityId);
        if (!exists) {
          return { kind: "entity_not_found" };
        }

        // `createManyAndReturn` + `skipDuplicates` emite
        // `INSERT ... ON CONFLICT DO NOTHING RETURNING`: em corrida com outra
        // aba o banco devolve ZERO linhas em vez de levantar P2002, e a
        // transacao segue utilizavel.
        const criadas = await executor.userWatchState.createManyAndReturn({
          data: [
            {
              userId: input.userId,
              entityType: input.entityType,
              entityId: input.entityId,
              status: input.status,
              startedAt: input.startedAt,
              completedAt: input.completedAt,
              rewatchCount: input.rewatchCount,
              lastActivityAt: input.now,
              version: input.nextVersion,
            },
          ],
          select: WATCH_STATE_SELECT,
          skipDuplicates: true,
        });

        const row = criadas[0];
        if (row !== undefined) {
          return { kind: "saved", state: toWatchStateRecord(row) };
        }
        // Zero linhas: outra requisicao criou o estado entre a sonda e o
        // insert. E conflito de verdade — o chamador relê e decide de novo.
        return {
          kind: "conflict",
          conflict: { reason: "unique_violation", target: "watchState.entity" },
        };
      }

      // ATUALIZACAO por compare-and-swap: `version` entra no WHERE.
      const aplicado = await executor.userWatchState.updateMany({
        where: {
          userId: input.userId,
          entityType: input.entityType,
          entityId: input.entityId,
          version: input.expectedVersion,
        },
        data: {
          status: input.status,
          startedAt: input.startedAt,
          completedAt: input.completedAt,
          rewatchCount: input.rewatchCount,
          lastActivityAt: input.now,
          version: input.nextVersion,
        },
      });

      if (aplicado.count > 1) {
        // O unique (user, entityType, entityId) torna isso impossivel. Falha
        // fechado: nao ha resultado tipado que descreva "atualizei varios".
        throw new Error("invariante violada: mais de um watch state para a mesma chave natural");
      }
      if (aplicado.count === 0) {
        return {
          kind: "conflict",
          conflict: { reason: "stale_preimage", target: "watchState.version" },
        };
      }

      const row = await executor.userWatchState.findUnique({
        where: {
          userId_entityType_entityId: {
            userId: input.userId,
            entityType: input.entityType,
            entityId: input.entityId,
          },
        },
        select: WATCH_STATE_SELECT,
      });
      if (row === null) {
        throw new Error("invariante violada: watch state desapareceu apos update bem-sucedido");
      }
      return { kind: "saved", state: toWatchStateRecord(row) };
    },

    async remove(
      _scope: TransactionScope,
      input: { readonly userId: bigint; readonly entityType: WatchableEntityType; readonly entityId: bigint },
    ): Promise<{ readonly removed: boolean }> {
      // `deleteMany` (nao `delete`): remover o que ja nao existe e operacao
      // SEGURA, nao erro — `delete` levantaria P2025 e abortaria a transacao.
      const apagado = await executor.userWatchState.deleteMany({
        where: { userId: input.userId, entityType: input.entityType, entityId: input.entityId },
      });
      return { removed: apagado.count > 0 };
    },

    async listByStatus(
      _scope: TransactionScope,
      input: {
        readonly userId: bigint;
        readonly statuses: readonly WatchState[];
        readonly entityTypes: readonly WatchableEntityType[];
        readonly limit: number;
        readonly offset: number;
      },
    ): Promise<WatchStatePage> {
      const where = {
        userId: input.userId,
        ...(input.statuses.length > 0 ? { status: { in: [...input.statuses] } } : {}),
        ...(input.entityTypes.length > 0 ? { entityType: { in: [...input.entityTypes] } } : {}),
      };
      // Ordem DETERMINISTICA: `lastActivityAt` desc com `entityId` desc como
      // desempate. Sem o segundo criterio, duas linhas do mesmo instante
      // trocariam de lugar entre paginas e um item apareceria duas vezes (ou
      // nunca) durante a paginacao.
      const [items, total] = await Promise.all([
        executor.userWatchState.findMany({
          where,
          orderBy: [{ lastActivityAt: "desc" }, { entityId: "desc" }],
          skip: input.offset,
          take: input.limit,
          select: WATCH_STATE_SELECT,
        }),
        executor.userWatchState.count({ where }),
      ]);
      return { items: items.map(toWatchStateRecord), total };
    },

    async countByStatus(
      _scope: TransactionScope,
      userId: bigint,
    ): Promise<
      ReadonlyArray<{ readonly status: WatchState; readonly entityType: WatchableEntityType; readonly count: number }>
    > {
      // AGREGACAO no banco: as estatisticas pessoais nunca trazem as linhas.
      // Um usuario com 20 mil titulos marcados produz aqui algumas dezenas de
      // grupos, nao 20 mil objetos.
      const grupos = await executor.userWatchState.groupBy({
        by: ["status", "entityType"],
        where: { userId },
        _count: { _all: true },
      });
      return grupos.map((g) => ({
        status: g.status,
        entityType: g.entityType as WatchableEntityType,
        count: g._count._all,
      }));
    },
  };
}
