/**
 * user-list-store.ts — adapter Prisma de `UserListStore` (C8).
 *
 * DOIS DETALHES DO SCHEMA GOVERNAM ESTE ARQUIVO:
 *
 *  1. SOFT DELETE COM UNIQUE NAO-PARCIAL. `user_lists` tem `deleted_at`, mas o
 *     unique `(owner_id, slug)` NAO e parcial nele — uma lista removida
 *     continua ocupando o slug para sempre. O adapter NAO recicla slug em
 *     silencio: devolve `conflict` e quem chama desambigua. Reaproveitar o slug
 *     de uma lista removida faria uma lista nova herdar a URL de outra.
 *
 *  2. UNIQUE PARCIAL DAS LISTAS DE SISTEMA. `user_lists_owner_system_key_unique`
 *     e `(owner_id, system_key) WHERE system_key IS NOT NULL` — uma lista de
 *     sistema de cada tipo por usuario. E o que torna `ensureSystemLists`
 *     idempotente sem leitura previa.
 *
 * Toda leitura filtra `deletedAt: null`: uma lista removida nao volta por
 * engano em listagem, busca por id ou contagem antiabuso.
 */

import type { UserListStore } from "../ports.js";
import type {
  TransactionScope,
  UserListCreateInput,
  UserListCreateResult,
  UserListLookupResult,
  UserListRecord,
  UserListUpdateInput,
} from "../types.js";
import type { SystemListKey } from "../../core/types.js";
import type { PrismaLibraryExecutor } from "./executor.js";
import { toUserListRecord } from "./mappers.js";

/** SELECT da lista + contagem de itens (agregada pelo banco, nao no cliente). */
const LIST_SELECT = {
  id: true,
  ownerId: true,
  kind: true,
  systemKey: true,
  title: true,
  slug: true,
  description: true,
  visibility: true,
  ordered: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
} as const;

export function createPrismaUserListStore(executor: PrismaLibraryExecutor): UserListStore {
  return {
    async create(
      _scope: TransactionScope,
      input: UserListCreateInput,
    ): Promise<UserListCreateResult> {
      // Insercao nao-abortiva: colisao de slug vira ZERO linhas em vez de P2002
      // (que abortaria a transacao interativa inteira).
      const criadas = await executor.userList.createManyAndReturn({
        data: [
          {
            ownerId: input.ownerId,
            kind: "custom",
            title: input.title,
            slug: input.slug,
            description: input.description,
            visibility: input.visibility,
            ordered: input.ordered,
          },
        ],
        select: { id: true },
        skipDuplicates: true,
      });

      const criada = criadas[0];
      if (criada === undefined) {
        return {
          kind: "conflict",
          conflict: { reason: "unique_violation", target: "userList.slug" },
        };
      }

      const row = await executor.userList.findUnique({
        where: { id: criada.id },
        select: LIST_SELECT,
      });
      if (row === null) {
        throw new Error("invariante violada: lista desapareceu apos insercao bem-sucedida");
      }
      return { kind: "created", list: toUserListRecord(row) };
    },

    async findById(_scope: TransactionScope, listId: bigint): Promise<UserListLookupResult> {
      // SEM filtro de dono: a autorizacao e do SERVICO, que compara
      // `list.ownerId` com o titular da sessao. Filtrar aqui devolveria
      // `not_found` para uma lista que existe e apagaria a distincao entre
      // "nao existe" e "nao e sua" no motivo interno.
      const row = await executor.userList.findFirst({
        where: { id: listId, deletedAt: null },
        select: LIST_SELECT,
      });
      return row === null
        ? { kind: "not_found" }
        : { kind: "found", list: toUserListRecord(row) };
    },

    async listByOwner(
      _scope: TransactionScope,
      input: { readonly ownerId: bigint; readonly limit: number; readonly offset: number },
    ): Promise<{ readonly items: readonly UserListRecord[]; readonly total: number }> {
      const where = { ownerId: input.ownerId, deletedAt: null };
      const [items, total] = await Promise.all([
        executor.userList.findMany({
          where,
          // Sistema primeiro (kind asc: 'custom' < 'system' em ordem
          // alfabetica, entao desc poe system antes), depois mais recentes.
          // `id` desempata para paginacao estavel.
          orderBy: [{ kind: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          skip: input.offset,
          take: input.limit,
          select: LIST_SELECT,
        }),
        executor.userList.count({ where }),
      ]);
      return { items: items.map(toUserListRecord), total };
    },

    async update(
      _scope: TransactionScope,
      input: UserListUpdateInput,
    ): Promise<UserListLookupResult> {
      // `updateMany` com `deletedAt: null` na pre-condicao: uma lista removida
      // nao volta a vida por um PATCH.
      const aplicado = await executor.userList.updateMany({
        where: { id: input.listId, deletedAt: null },
        data: {
          title: input.title,
          slug: input.slug,
          description: input.description,
          visibility: input.visibility,
          ordered: input.ordered,
        },
      });
      if (aplicado.count === 0) {
        return { kind: "not_found" };
      }
      const row = await executor.userList.findUnique({
        where: { id: input.listId },
        select: LIST_SELECT,
      });
      if (row === null) {
        throw new Error("invariante violada: lista desapareceu apos update bem-sucedido");
      }
      return { kind: "found", list: toUserListRecord(row) };
    },

    async softDelete(
      _scope: TransactionScope,
      input: { readonly listId: bigint; readonly now: Date },
    ): Promise<{ readonly removed: boolean }> {
      // Idempotente: remover o que ja esta removido conta zero, nao levanta.
      const aplicado = await executor.userList.updateMany({
        where: { id: input.listId, deletedAt: null },
        data: { deletedAt: input.now },
      });
      return { removed: aplicado.count > 0 };
    },

    async countCustomByOwner(_scope: TransactionScope, ownerId: bigint): Promise<number> {
      // Insumo do limite antiabuso (`LIST_LIMITS.maxCustomListsPerUser`).
      // Conta so as VIVAS: listas removidas nao consomem a cota do usuario.
      return executor.userList.count({
        where: { ownerId, kind: "custom", deletedAt: null },
      });
    },

    async ensureSystemLists(
      _scope: TransactionScope,
      input: {
        readonly ownerId: bigint;
        readonly definitions: ReadonlyArray<{
          readonly systemKey: SystemListKey;
          readonly title: string;
          readonly slug: string;
        }>;
      },
    ): Promise<{ readonly created: number }> {
      if (input.definitions.length === 0) {
        return { created: 0 };
      }
      // UMA insercao para todas as faltantes, apoiada no unique parcial
      // `(owner_id, system_key) WHERE system_key IS NOT NULL`. Idempotente por
      // construcao: chamar de novo cria zero.
      const criadas = await executor.userList.createMany({
        data: input.definitions.map((d) => ({
          ownerId: input.ownerId,
          kind: "system" as const,
          systemKey: d.systemKey,
          title: d.title,
          slug: d.slug,
          visibility: "private" as const,
          ordered: false,
        })),
        skipDuplicates: true,
      });
      return { created: criadas.count };
    },

    async findSystemList(
      _scope: TransactionScope,
      input: { readonly ownerId: bigint; readonly systemKey: SystemListKey },
    ): Promise<UserListLookupResult> {
      const row = await executor.userList.findFirst({
        where: { ownerId: input.ownerId, systemKey: input.systemKey, deletedAt: null },
        select: LIST_SELECT,
      });
      return row === null
        ? { kind: "not_found" }
        : { kind: "found", list: toUserListRecord(row) };
    },
  };
}
