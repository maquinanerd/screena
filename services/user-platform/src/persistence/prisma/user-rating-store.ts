/**
 * user-rating-store.ts — adapter Prisma de `UserRatingStore` (C8).
 *
 * NOTA PESSOAL DO USUARIO. Nao tem nada a ver com rating externo: nao carrega
 * `rating_source` nem `provider_api`, nao entra em `AggregateRating`, nao vira
 * Cinerie Score e nunca se mistura com IMDb/Rotten Tomatoes (invariantes 1 e 2).
 * A escala e FIXA em 5 e o passo 0.5, travado por CHECK no banco
 * (`value >= 0.5 AND <= 5`, `value*2 = floor(value*2)`, `scale = 5`).
 *
 * `user_ratings` NAO tem coluna `version`: a troca de nota e last-write-wins de
 * propósito — reavaliar um filme e uma acao do proprio dono, e um conflito de
 * versao entre duas abas do MESMO usuario nao protege ninguem.
 */

import type { UserRatingStore } from "../ports.js";
import type {
  TransactionScope,
  UserRatingRecord,
  UserRatingUpsertInput,
  UserRatingUpsertResult,
} from "../types.js";
import type { RatableEntityType } from "../../core/types.js";
import type { PrismaLibraryExecutor } from "./executor.js";
import { toUserRatingRecord } from "./mappers.js";

const RATING_SELECT = {
  entityType: true,
  entityId: true,
  value: true,
  scale: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Sonda de existencia da entidade avaliada. */
export interface RatingEntityProbe {
  exists(entityType: string, entityId: bigint): Promise<boolean>;
}

export function createPrismaUserRatingStore(
  executor: PrismaLibraryExecutor,
  probe: RatingEntityProbe,
): UserRatingStore {
  return {
    async upsert(
      _scope: TransactionScope,
      input: UserRatingUpsertInput,
    ): Promise<UserRatingUpsertResult> {
      // `user_ratings` NAO tem FK para `entities` (so um CHECK de
      // entity_type <> 'person'), entao a sonda aqui nao evita um erro do
      // banco — evita que a biblioteca do usuario guarde nota para um id que
      // nao corresponde a nada. Fail-closed por escolha, nao por constraint.
      const existe = await probe.exists(input.entityType, input.entityId);
      if (!existe) {
        return { kind: "entity_not_found" };
      }

      // `upsert` do Prisma sobre o unique (user, entityType, entityId): uma
      // nota por entidade, e reavaliar apenas troca o valor.
      const row = await executor.userRating.upsert({
        where: {
          userId_entityType_entityId: {
            userId: input.userId,
            entityType: input.entityType,
            entityId: input.entityId,
          },
        },
        create: {
          userId: input.userId,
          entityType: input.entityType,
          entityId: input.entityId,
          value: input.value,
          scale: 5,
        },
        update: { value: input.value },
        select: RATING_SELECT,
      });
      return { kind: "saved", rating: toUserRatingRecord(row) };
    },

    async insertIfAbsent(_scope, input) {
      const existe = await probe.exists(input.entityType, input.entityId);
      if (!existe) {
        return { kind: "entity_not_found" };
      }

      // `createMany` + `skipDuplicates` = `INSERT ... ON CONFLICT DO NOTHING`:
      // cria a nota se ausente e devolve 0 linhas (sem P2002) se ja houver uma.
      // Nunca toca no `value` de uma nota existente — o import nao sobrescreve o
      // que o dono avaliou aqui. Atomico: fecha o TOCTOU entre preview e apply.
      const criadas = await executor.userRating.createMany({
        data: [
          {
            userId: input.userId,
            entityType: input.entityType,
            entityId: input.entityId,
            value: input.value,
            scale: 5,
          },
        ],
        skipDuplicates: true,
      });
      return { kind: criadas.count > 0 ? "created" : "already_exists" };
    },

    async remove(
      _scope: TransactionScope,
      input: {
        readonly userId: bigint;
        readonly entityType: RatableEntityType;
        readonly entityId: bigint;
      },
    ): Promise<{ readonly removed: boolean }> {
      const apagado = await executor.userRating.deleteMany({
        where: { userId: input.userId, entityType: input.entityType, entityId: input.entityId },
      });
      return { removed: apagado.count > 0 };
    },

    async find(
      _scope: TransactionScope,
      input: {
        readonly userId: bigint;
        readonly entityType: RatableEntityType;
        readonly entityId: bigint;
      },
    ): Promise<
      { readonly kind: "found"; readonly rating: UserRatingRecord } | { readonly kind: "not_found" }
    > {
      const row = await executor.userRating.findUnique({
        where: {
          userId_entityType_entityId: {
            userId: input.userId,
            entityType: input.entityType,
            entityId: input.entityId,
          },
        },
        select: RATING_SELECT,
      });
      return row === null
        ? { kind: "not_found" }
        : { kind: "found", rating: toUserRatingRecord(row) };
    },

    async listByUser(
      _scope: TransactionScope,
      input: { readonly userId: bigint; readonly limit: number; readonly offset: number },
    ): Promise<{ readonly items: readonly UserRatingRecord[]; readonly total: number }> {
      const where = { userId: input.userId };
      const [items, total] = await Promise.all([
        executor.userRating.findMany({
          where,
          orderBy: [{ updatedAt: "desc" }, { entityId: "desc" }],
          skip: input.offset,
          take: input.limit,
          select: RATING_SELECT,
        }),
        executor.userRating.count({ where }),
      ]);
      return { items: items.map(toUserRatingRecord), total };
    },
  };
}
