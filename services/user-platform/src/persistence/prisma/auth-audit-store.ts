/**
 * auth-audit-store.ts — adapter Prisma de `AuthAuditStore` (Backend C, C7D).
 *
 * UM metodo: `append`. A tabela `user_auth_audit_logs` e append-only por
 * TRIGGER no proprio PostgreSQL (UPDATE e recusado), entao um `update` neste
 * adapter seria uma promessa que o banco quebra em runtime.
 *
 * O QUE NUNCA ENTRA AQUI: senha, token cru, hash de token, cookie, segredo,
 * `DATABASE_URL`. A trava nao e so documental — `AuthAuditAppendInput.detail` e
 * tipado como `Record<string, string | number | boolean | null>`, entao nao ha
 * como aninhar um objeto de erro do driver (que pode citar parametros de query)
 * dentro do detalhe. O IP ja chega HASHEADO da borda; o endereco cru nao existe
 * nesta camada.
 *
 * `userId` e NULLABLE de proposito: uma tentativa de login contra e-mail
 * inexistente precisa ser auditavel sem inventar um titular — e a FK e
 * `Restrict`, entao apontar para uma linha que nao existe seria recusado.
 */

import type { AuthAuditStore } from "../ports.js";
import type { AuthAuditAppendInput, TransactionScope } from "../types.js";
import type { PrismaExecutor } from "./executor.js";

export function createPrismaAuthAuditStore(executor: PrismaExecutor): AuthAuditStore {
  return {
    async append(_scope: TransactionScope, input: AuthAuditAppendInput): Promise<void> {
      // INSERT puro, sem unique e sem conflito esperado: nada aqui pode
      // envenenar a transacao interativa em que a auditoria participa.
      //
      // `detail` vai como `undefined` quando e null para que a coluna Json
      // fique NULL de verdade, em vez de guardar o literal JSON `null` — dois
      // estados diferentes que uma consulta futura confundiria.
      await executor.authAuditLog.create({
        data: {
          userId: input.userId,
          sessionId: input.sessionId,
          action: input.action,
          ipHash: input.ipHash,
          userAgent: input.userAgent,
          detail: input.detail === null ? undefined : { ...input.detail },
          createdAt: input.occurredAt,
        },
        select: { id: true },
      });
    },
  };
}
