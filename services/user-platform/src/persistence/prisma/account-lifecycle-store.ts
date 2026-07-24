/**
 * account-lifecycle-store.ts — adapter Prisma de `AccountLifecycleStore` (C7D).
 *
 * As DUAS unicas transicoes de ciclo de vida da conta: pedir/cancelar
 * encerramento (`transitionStatus`) e anonimizar em definitivo (`anonymize`).
 *
 * Port separado do `IdentityStore` porque aquele declara, desde C7B0, nao ter
 * `transitionStatus` — "sem CRUD generico e sem operacao administrativa".
 * Respeitar aquela fronteira e o motivo de este arquivo existir.
 *
 * A LINHA DE `users` NUNCA E REMOVIDA. Anonimizar e um UPDATE que apaga o dado
 * pessoal e mantem a chave: `user_auth_audit_logs` tem FK `Restrict` para
 * `users`, entao um DELETE seria recusado pelo banco — e, mesmo que passasse,
 * levaria junto a prova de consentimento que a propria LGPD manda reter.
 */

import type { AccountLifecycleStore } from "../ports.js";
import type {
  AccountAnonymizeInput,
  AccountAnonymizeResult,
  AccountStatusTransitionInput,
  AccountStatusTransitionResult,
  TransactionScope,
} from "../types.js";
import type { PrismaExecutor } from "./executor.js";

export function createPrismaAccountLifecycleStore(
  executor: PrismaExecutor,
): AccountLifecycleStore {
  return {
    async transitionStatus(
      _scope: TransactionScope,
      input: AccountStatusTransitionInput,
    ): Promise<AccountStatusTransitionResult> {
      // COMPARE-AND-SWAP sobre o status esperado. Duas abas pedindo
      // encerramento (ou uma pedindo e outra cancelando) sao concorrencia REAL,
      // nao estado impossivel: com `update` simples a ultima venceria e o
      // usuario poderia acabar com a conta encerrada depois de ter cancelado.
      //
      // `deletedAt` viaja JUNTO porque o schema tem um CHECK que amarra os dois
      // (`deleted`/`pending_deletion` coerentes com `deleted_at`). Gravar o
      // status agora e o carimbo depois deixaria a linha violando o proprio
      // CHECK no intervalo — e o banco recusaria a primeira escrita.
      const aplicado = await executor.user.updateMany({
        where: { id: input.userId, status: input.expectedStatus },
        data: { status: input.nextStatus, deletedAt: input.deletedAt },
      });

      if (aplicado.count > 1) {
        throw new Error("invariante violada: mais de uma identidade para a mesma chave primaria");
      }
      if (aplicado.count === 1) {
        return { kind: "updated" };
      }

      // Zero linhas: conta inexistente ou status ja mudado. A sonda so le
      // existencia e nenhum resultado dela vira sucesso (mesma limitacao de
      // atomicidade ja registrada em `identity-store.markEmailVerified`: o que
      // fica impreciso e o MOTIVO, nunca a decisao).
      const existe = await executor.user.findUnique({
        where: { id: input.userId },
        select: { id: true },
      });
      if (existe === null) {
        return { kind: "not_found" };
      }
      return {
        kind: "conflict",
        conflict: { reason: "stale_preimage", target: "identity.status" },
      };
    },

    async anonymize(
      _scope: TransactionScope,
      input: AccountAnonymizeInput,
    ): Promise<AccountAnonymizeResult> {
      // PRE-CONDICAO `status: pending_deletion`: so uma conta que ja pediu
      // encerramento pode ser anonimizada. Sem ela, um bug de orquestracao
      // poderia anonimizar uma conta ativa — e o dado pessoal nao volta.
      //
      // `handle: null` e `displayName: null` alem do e-mail: os tres sao
      // identificadores diretos. Zerar so o e-mail deixaria o handle publico
      // apontando para a pessoa.
      //
      // Os valores anonimos vem PRONTOS do dominio (`buildDeletionPlan`) — o
      // adapter nao inventa placeholder, porque so o dominio sabe qual formato
      // preserva a unicidade de `email`/`email_normalized`.
      const aplicado = await executor.user.updateMany({
        where: { id: input.userId, status: "pending_deletion" },
        data: {
          email: input.anonymizedEmail,
          emailNormalized: input.anonymizedEmailNormalized,
          handle: null,
          displayName: null,
          status: "deleted",
          deletedAt: input.anonymizedAt,
        },
      });

      if (aplicado.count > 1) {
        throw new Error("invariante violada: mais de uma identidade para a mesma chave primaria");
      }
      if (aplicado.count === 1) {
        return { kind: "anonymized" };
      }

      const existe = await executor.user.findUnique({
        where: { id: input.userId },
        select: { id: true },
      });
      if (existe === null) {
        return { kind: "not_found" };
      }
      return {
        kind: "conflict",
        conflict: { reason: "stale_preimage", target: "identity.status" },
      };
    },
  };
}
