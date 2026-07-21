/**
 * identity-store.ts — adapter Prisma de `IdentityStore` (Backend C, C7B1).
 *
 * Implementa EXATAMENTE os dois metodos do port: criar a identidade do cadastro
 * e busca-la pela chave natural anti-enumeracao. Nenhum `update`, nenhum
 * `delete`, nenhuma listagem, nenhuma busca por handle, nenhum
 * `markEmailVerified` — nada que os fluxos desta unidade nao consumam.
 */

import type { IdentityStore } from "../ports.js";
import type {
  IdentityCreateInput,
  IdentityCreateResult,
  IdentityLookupResult,
  TransactionScope,
} from "../types.js";
import { classifyIdentityUniqueTarget, isUniqueViolation } from "./error-mapping.js";
import type { PrismaExecutor } from "./executor.js";
import { toIdentityRecord } from "./mappers.js";

/**
 * SELECT MINIMO — as duas unicas colunas com consumidor real (`id` para ser dono
 * da credencial/sessao; `status` para `decideLogin`). Declarado como constante
 * unica para que as duas leituras nao possam divergir e para que ampliar o
 * select seja uma edicao visivel em um lugar so.
 *
 * `email`, `email_normalized`, `handle`, `display_name`, `role`, timestamps e
 * `deleted_at` ficam de fora de proposito: sem leitor, seriam PII trafegando por
 * nada.
 */
const IDENTITY_SELECT = { id: true, status: true } as const;

export function createPrismaIdentityStore(executor: PrismaExecutor): IdentityStore {
  return {
    async create(
      _scope: TransactionScope,
      input: IdentityCreateInput,
    ): Promise<IdentityCreateResult> {
      try {
        const row = await executor.user.create({
          // `email` e `emailNormalized` sao colunas DISTINTAS com uniques
          // DISTINTOS: o adapter grava os dois valores que recebeu e NAO
          // reconstroi um a partir do outro. A normalizacao pertence ao dominio
          // (`auth/identity.normalizeEmail`) — normalizar aqui criaria uma
          // segunda definicao de "normalizado", divergente da coluna.
          data: {
            email: input.email,
            emailNormalized: input.emailNormalized,
            displayName: input.displayName,
          },
          select: IDENTITY_SELECT,
        });
        return { kind: "created", identity: toIdentityRecord(row) };
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Sem chave de idempotencia no cadastro, um replay e INDISTINGUIVEL de
          // uma colisao real — e ambos sao conflito. Converter unique violation
          // em "ja existe, tudo certo" seria inventar idempotencia que o
          // contrato nao tem (registrado em C7B0 como PORT_GAP deliberado).
          const target = classifyIdentityUniqueTarget(error);
          return {
            kind: "conflict",
            conflict: target === undefined ? { reason: "unique_violation" } : {
              reason: "unique_violation",
              target,
            },
          };
        }
        throw error;
      }
    },

    async findByNormalizedEmail(
      _scope: TransactionScope,
      emailNormalized: string,
    ): Promise<IdentityLookupResult> {
      // Busca SO por `email_normalized` — nunca por e-mail bruto como fallback,
      // nunca por handle. Duas chaves de busca para a mesma conta reabririam o
      // canal de enumeracao que a coluna normalizada existe para fechar.
      //
      // Contas em `pending_deletion`/`deleted` NAO sao filtradas: `decideLogin`
      // recebe o `status` e decide a elegibilidade (fail-closed em
      // `accountCanHoldSession`). Esconde-las aqui devolveria `not_found` para
      // uma linha que ainda ocupa o unique — e o cadastro seguinte falharia com
      // um conflito "impossivel".
      const row = await executor.user.findUnique({
        where: { emailNormalized },
        select: IDENTITY_SELECT,
      });
      if (row === null) {
        return { kind: "not_found" };
      }
      return { kind: "found", identity: toIdentityRecord(row) };
    },
  };
}
