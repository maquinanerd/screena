/**
 * data-request-store.ts — adapter Prisma de `DataRequestStore` (Backend C, C7D).
 *
 * Pedidos LGPD de exportacao e exclusao (`user_data_requests`).
 *
 * O adapter NAO decide idempotencia. `findLatestByKind` devolve o mais recente
 * como esta, e `isRequestActive`/`decideExportRequest` (privacy/export.ts) e que
 * sabem quais status bloqueiam um pedido novo. Filtrar por "ativo" aqui poria a
 * politica em dois lugares e esconderia do dominio o pedido concluido que
 * LIBERA um novo.
 */

import type { DataRequestStore } from "../ports.js";
import type {
  DataRequestCreateInput,
  DataRequestCreateResult,
  DataRequestLookupResult,
  DataRequestRecord,
  DataRequestTransitionInput,
  DataRequestTransitionResult,
  TransactionScope,
} from "../types.js";
import type { DataRequestKind } from "../../core/types.js";
import type { PrismaExecutor } from "./executor.js";
import { toDataRequestRecord } from "./mappers.js";

/**
 * SELECT minimo. SEM `detail` e SEM `processedBy`: o primeiro e Json livre e o
 * segundo e identidade de um OPERADOR HUMANO — dado de terceiro que iria direto
 * para a exportacao do titular se atravessasse esta fronteira.
 */
const REQUEST_SELECT = {
  id: true,
  kind: true,
  status: true,
  requestedAt: true,
  processedAt: true,
} as const;

export function createPrismaDataRequestStore(executor: PrismaExecutor): DataRequestStore {
  return {
    async create(
      _scope: TransactionScope,
      input: DataRequestCreateInput,
    ): Promise<DataRequestCreateResult> {
      // INSERT puro: a tabela nao tem unique (o mesmo titular pode ter varios
      // pedidos ao longo do tempo — o historico e o ponto). A duplicidade que
      // importa e "ja ha um ATIVO", e essa e decisao do dominio, tomada com o
      // resultado de `findLatestByKind` antes desta chamada.
      const row = await executor.dataRequest.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          status: input.status,
          requestedAt: input.requestedAt,
        },
        select: REQUEST_SELECT,
      });
      return { kind: "created", request: toDataRequestRecord(row) };
    },

    async findLatestByKind(
      _scope: TransactionScope,
      input: { readonly userId: bigint; readonly kind: DataRequestKind },
    ): Promise<DataRequestLookupResult> {
      // ORDER BY requested_at DESC, id DESC: o segundo criterio torna o
      // resultado deterministico quando dois pedidos compartilham o instante
      // (possivel — a coluna e `now()` do banco e a resolucao nao e infinita).
      // Sem ele, dois pedidos no mesmo microssegundo dariam vencedores
      // diferentes entre execucoes e a idempotencia oscilaria.
      const row = await executor.dataRequest.findFirst({
        where: { userId: input.userId, kind: input.kind },
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        select: REQUEST_SELECT,
      });
      if (row === null) {
        return { kind: "not_found" };
      }
      return { kind: "found", request: toDataRequestRecord(row) };
    },

    async listByUser(
      _scope: TransactionScope,
      userId: bigint,
    ): Promise<readonly DataRequestRecord[]> {
      const rows = await executor.dataRequest.findMany({
        where: { userId },
        orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
        select: REQUEST_SELECT,
      });
      return rows.map(toDataRequestRecord);
    },

    async transition(
      _scope: TransactionScope,
      input: DataRequestTransitionInput,
    ): Promise<DataRequestTransitionResult> {
      // COMPARE-AND-SWAP sobre o status esperado, via `updateMany` com a
      // pre-condicao no WHERE. `update` simples sobrescreveria last-write-wins e
      // dois processadores concorrentes marcariam o mesmo pedido como concluido
      // duas vezes — o segundo apagando o carimbo do primeiro.
      const aplicado = await executor.dataRequest.updateMany({
        where: { id: input.id, status: input.expectedStatus },
        data: {
          status: input.nextStatus,
          processedAt: input.processedAt,
          processedBy: input.processedBy,
        },
      });

      if (aplicado.count > 1) {
        // `id` e chave primaria: impossivel. Falha fechado.
        throw new Error("invariante violada: mais de um pedido para a mesma chave primaria");
      }
      if (aplicado.count === 1) {
        return { kind: "updated" };
      }

      // Zero linhas tem DUAS causas — pedido inexistente ou status ja mudado — e
      // o contrato as separa. A sonda le apenas existencia; nenhum resultado
      // dela vira sucesso. A classificacao NAO e atomica com o UPDATE (mesma
      // limitacao registrada em `identity-store.markEmailVerified`): o que fica
      // impreciso e o MOTIVO, nunca a decisao.
      const existe = await executor.dataRequest.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (existe === null) {
        return { kind: "not_found" };
      }
      return {
        kind: "conflict",
        conflict: { reason: "stale_preimage", target: "dataRequest.status" },
      };
    },
  };
}
