/**
 * consent-store.ts — adapter Prisma de `ConsentStore` (Backend C, C7D).
 *
 * TRES metodos, todos triviais de proposito: inserir, listar tudo, listar uma
 * finalidade. Nenhum `update`, nenhum `delete` — a tabela
 * `user_consent_records` e APPEND-ONLY por invariante LGPD (a prova de
 * consentimento tem de sobreviver ate a revogacao e depois dela).
 *
 * O adapter NAO ORDENA e NAO FILTRA por vigencia. `currentConsent` e
 * `isConsentActive` (privacy/consent.ts) sao quem sabem que "vigente" e o
 * registro mais recente daquela finalidade, com desempate pela ultima
 * ocorrencia. Ordenar aqui poria a mesma regra em dois lugares — e no dia em que
 * as duas divergissem, a leitura do gate de tracking discordaria da leitura da
 * tela de privacidade.
 */

import type { ConsentStore } from "../ports.js";
import type { ConsentAppendInput, ConsentRecordRow, TransactionScope } from "../types.js";
import type { ConsentKind } from "../../core/types.js";
import type { PrismaExecutor } from "./executor.js";
import { toConsentRecordRow } from "./mappers.js";

/**
 * SELECT minimo — as quatro colunas que `StoredConsentRecord` declara.
 * `user_id`, `id` e `created_at` ficam de fora: quem consultou ja tem o titular,
 * e `occurredAt` e o unico instante que a politica consulta.
 */
const CONSENT_SELECT = {
  kind: true,
  granted: true,
  policyVersion: true,
  occurredAt: true,
} as const;

export function createPrismaConsentStore(executor: PrismaExecutor): ConsentStore {
  return {
    async append(_scope: TransactionScope, input: ConsentAppendInput): Promise<void> {
      // INSERT puro. Nao ha unique nesta tabela (por desenho: a mesma pessoa
      // pode conceder, revogar e reconceder a mesma finalidade quantas vezes
      // quiser), entao nao ha conflito esperado a classificar e nao ha risco de
      // envenenar a transacao.
      await executor.consentRecord.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          granted: input.granted,
          policyVersion: input.policyVersion,
          occurredAt: input.occurredAt,
        },
        select: { id: true },
      });
    },

    async listByUser(
      _scope: TransactionScope,
      userId: bigint,
    ): Promise<readonly ConsentRecordRow[]> {
      const rows = await executor.consentRecord.findMany({
        where: { userId },
        select: CONSENT_SELECT,
      });
      return rows.map(toConsentRecordRow);
    },

    async listByUserAndKind(
      _scope: TransactionScope,
      input: { readonly userId: bigint; readonly kind: ConsentKind },
    ): Promise<readonly ConsentRecordRow[]> {
      // Existe para o caminho quente do gate de tracking, que consulta UMA
      // finalidade e nao deve pagar a leitura do historico inteiro. O indice
      // `(user_id, kind, occurred_at)` cobre exatamente este acesso.
      const rows = await executor.consentRecord.findMany({
        where: { userId: input.userId, kind: input.kind },
        select: CONSENT_SELECT,
      });
      return rows.map(toConsentRecordRow);
    },
  };
}
