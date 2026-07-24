/**
 * viewing-event-store.ts — adapter Prisma de `ViewingEventStore` (C8).
 *
 * O diario e APPEND-ONLY por construcao: este adapter tem `append` e `list`, e
 * mais nada. Nao ha `update` nem `delete` porque desfazer uma acao gera um
 * evento NOVO (`undo`) — e o que torna o historico auditavel pelo proprio
 * titular em vez de reescrevivel.
 *
 * A IDEMPOTENCIA VEM DO BANCO: o unique
 * `(user_id, idempotency_key, event_type)` (recriado em
 * 20260721140000_tracking_event_idempotency_scope) faz do replay uma operacao
 * segura. `duplicate` NAO e erro — e a resposta correta quando a mesma operacao
 * chega duas vezes, e e exatamente o que torna a IMPORTACAO reexecutavel sem
 * inflar o historico.
 */

import type { ViewingEventStore } from "../ports.js";
import type {
  TransactionScope,
  ViewingEventAppendInput,
  ViewingEventAppendResult,
  ViewingEventPage,
} from "../types.js";
import type { ViewingEventType } from "../../core/types.js";
import type { PrismaLibraryExecutor } from "./executor.js";
import { toViewingEventRecord } from "./mappers.js";

const EVENT_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  eventType: true,
  occurredAt: true,
  source: true,
} as const;

export function createPrismaViewingEventStore(
  executor: PrismaLibraryExecutor,
): ViewingEventStore {
  return {
    async append(
      _scope: TransactionScope,
      input: ViewingEventAppendInput,
    ): Promise<ViewingEventAppendResult> {
      // INSERCAO NAO-ABORTIVA. Um replay colide com o unique, e uma violacao
      // deixaria a transacao interativa abortada — de modo que capturar a
      // excecao nao a ressuscitaria. `skipDuplicates` transforma a colisao em
      // zero linhas, e a transacao segue utilizavel (regra C7B1.1).
      const criados = await executor.viewingEvent.createManyAndReturn({
        data: [
          {
            userId: input.userId,
            entityType: input.entityType,
            entityId: input.entityId,
            eventType: input.eventType,
            occurredAt: input.occurredAt,
            source: input.source,
            idempotencyKey: input.idempotencyKey,
          },
        ],
        select: { id: true },
        skipDuplicates: true,
      });

      const row = criados[0];
      return row === undefined ? { kind: "duplicate" } : { kind: "appended", eventId: row.id };
    },

    async list(
      _scope: TransactionScope,
      input: {
        readonly userId: bigint;
        readonly eventTypes: readonly ViewingEventType[] | null;
        readonly limit: number;
        readonly offset: number;
      },
    ): Promise<ViewingEventPage> {
      const where = {
        userId: input.userId,
        ...(input.eventTypes !== null && input.eventTypes.length > 0
          ? { eventType: { in: [...input.eventTypes] } }
          : {}),
      };
      // `occurredAt` desc com `id` desc de desempate: sem o segundo criterio,
      // eventos irmaos (mesma operacao, mesmo instante) trocariam de ordem
      // entre paginas e um deles apareceria duas vezes durante a paginacao.
      const [items, total] = await Promise.all([
        executor.viewingEvent.findMany({
          where,
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          skip: input.offset,
          take: input.limit,
          select: EVENT_SELECT,
        }),
        executor.viewingEvent.count({ where }),
      ]);
      return { items: items.map(toViewingEventRecord), total };
    },
  };
}
