/**
 * user-list-item-store.ts — adapter Prisma de `UserListItemStore` (C8).
 *
 * ORDENACAO: `applyPositions` reescreve as posicoes de TODOS os itens que o
 * plano indicou, em uma transacao. Isso e aceitavel porque
 * `LIST_LIMITS.maxItemsPerList` e 1000 — o teto e o que dispensa ordenacao
 * fracionaria. Sem esse limite, arrastar um item no topo de uma lista enorme
 * reescreveria a lista inteira a cada gesto, e a resposta certa seria outra
 * estrutura de posicao. Registrado aqui para que, se o limite subir, a decisao
 * seja revisitada em vez de herdada.
 *
 * `user_list_items` NAO tem CHECK de `entity_type` (ao contrario de
 * `user_watch_states` e `user_ratings`): a restricao a
 * `RATABLE_ENTITY_TYPES` vive em `validateListItemAdd` (dominio) e e a UNICA
 * guarda — por isso o servico sempre a chama antes deste adapter.
 */

import type { UserListItemStore } from "../ports.js";
import type {
  ItemPositionInput,
  TransactionScope,
  UserListItemAddInput,
  UserListItemAddResult,
  UserListItemPage,
} from "../types.js";
import type { PrismaLibraryExecutor } from "./executor.js";
import { toUserListItemRecord } from "./mappers.js";

const ITEM_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  position: true,
  note: true,
  addedAt: true,
} as const;

/** Sonda de existencia da entidade (FK composta para `entities`). */
export interface ListEntityProbe {
  exists(entityType: string, entityId: bigint): Promise<boolean>;
}

export function createPrismaUserListItemStore(
  executor: PrismaLibraryExecutor,
  probe: ListEntityProbe,
): UserListItemStore {
  return {
    async add(
      _scope: TransactionScope,
      input: UserListItemAddInput,
    ): Promise<UserListItemAddResult> {
      // Sonda ANTES: a FK composta para `entities` recusaria a escrita, e a
      // violacao abortaria a transacao interativa (regra C7B1.1).
      const existe = await probe.exists(input.entityType, input.entityId);
      if (!existe) {
        return { kind: "entity_not_found" };
      }

      const criados = await executor.userListItem.createManyAndReturn({
        data: [
          {
            listId: input.listId,
            entityType: input.entityType,
            entityId: input.entityId,
            position: input.position,
            note: input.note,
          },
        ],
        select: ITEM_SELECT,
        skipDuplicates: true,
      });

      const row = criados[0];
      if (row === undefined) {
        // Unique `(list_id, entity_type, entity_id)` barrou: o item JA esta na
        // lista. Isso e sucesso idempotente, nao erro — adicionar duas vezes o
        // mesmo filme e uma acao inofensiva do usuario.
        return { kind: "already_present" };
      }
      return { kind: "added", item: toUserListItemRecord(row) };
    },

    async remove(
      _scope: TransactionScope,
      input: { readonly listId: bigint; readonly itemId: bigint },
    ): Promise<{ readonly removed: boolean }> {
      // `listId` no WHERE alem do `itemId`: um item so pode ser removido pela
      // lista a que pertence. Sem isso, conhecer um id de item bastaria para
      // remove-lo de OUTRA lista — inclusive de outro usuario.
      const apagado = await executor.userListItem.deleteMany({
        where: { id: input.itemId, listId: input.listId },
      });
      return { removed: apagado.count > 0 };
    },

    async list(
      _scope: TransactionScope,
      input: { readonly listId: bigint; readonly limit: number; readonly offset: number },
    ): Promise<UserListItemPage> {
      const where = { listId: input.listId };
      // `position` primeiro (nulls last: itens sem posicao vao ao fim), depois
      // `addedAt`/`id` para desempate estavel na paginacao.
      const [items, total] = await Promise.all([
        executor.userListItem.findMany({
          where,
          orderBy: [{ position: { sort: "asc", nulls: "last" } }, { addedAt: "asc" }, { id: "asc" }],
          skip: input.offset,
          take: input.limit,
          select: ITEM_SELECT,
        }),
        executor.userListItem.count({ where }),
      ]);
      return { items: items.map(toUserListItemRecord), total };
    },

    async listOrderedIds(
      _scope: TransactionScope,
      listId: bigint,
    ): Promise<readonly bigint[]> {
      // Ordem ATUAL completa — insumo de `planReorder`/`validateFullReorder`.
      // Sem paginacao de proposito: o plano de reordenacao precisa da lista
      // inteira, e o teto de 1000 itens a torna barata.
      const rows = await executor.userListItem.findMany({
        where: { listId },
        orderBy: [{ position: { sort: "asc", nulls: "last" } }, { addedAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },

    async count(_scope: TransactionScope, listId: bigint): Promise<number> {
      return executor.userListItem.count({ where: { listId } });
    },

    async applyPositions(
      _scope: TransactionScope,
      input: {
        readonly listId: bigint;
        readonly positions: readonly ItemPositionInput[];
        readonly now: Date;
      },
    ): Promise<{ readonly updated: number }> {
      let updated = 0;
      // Um `updateMany` por posicao, todos dentro da MESMA transacao (o escopo
      // e do chamador): a lista fica contigua 0..n-1 ou nao muda.
      //
      // `listId` entra no WHERE de cada update — um itemId de outra lista
      // simplesmente nao casa, entao um plano adulterado nao consegue mexer em
      // lista alheia.
      for (const posicao of input.positions) {
        const aplicado = await executor.userListItem.updateMany({
          where: { id: posicao.itemId, listId: input.listId },
          data: { position: posicao.position },
        });
        updated += aplicado.count;
      }
      return { updated };
    },
  };
}
