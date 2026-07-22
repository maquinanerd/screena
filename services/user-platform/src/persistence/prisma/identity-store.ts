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
import { classifyIdentityConflict } from "./identity-conflict.js";
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
      // INSERCAO NAO-ABORTIVA (C7B1.1).
      //
      // `createManyAndReturn` + `skipDuplicates` emite
      // `INSERT ... ON CONFLICT DO NOTHING RETURNING ...`: em colisao o banco
      // devolve ZERO linhas em vez de levantar P2002. Isso importa porque uma
      // violacao de constraint deixa a transacao do Postgres ABORTADA, e capturar
      // a excecao nao a ressuscita — a chamada seguinte no mesmo escopo morreria
      // com 25P02 e um `COMMIT` viraria `ROLLBACK` silencioso. Aqui nao ha
      // excecao para capturar, entao a transacao segue utilizavel.
      //
      // Quem decide criado-ou-conflito continua sendo o BANCO, atomicamente, no
      // mesmo comando que grava. Nao ha leitura previa, logo nao ha corrida.
      //
      // `email` e `emailNormalized` sao colunas DISTINTAS com uniques DISTINTOS:
      // o adapter grava os dois valores que recebeu e NAO reconstroi um a partir
      // do outro. A normalizacao pertence ao dominio
      // (`auth/identity.normalizeEmail`) — normalizar aqui criaria uma segunda
      // definicao de "normalizado", divergente da coluna.
      const criadas = await executor.user.createManyAndReturn({
        data: [
          {
            email: input.email,
            emailNormalized: input.emailNormalized,
            displayName: input.displayName,
          },
        ],
        select: IDENTITY_SELECT,
        skipDuplicates: true,
      });

      const row = criadas[0];
      if (row !== undefined) {
        return { kind: "created", identity: toIdentityRecord(row) };
      }

      // Zero linhas = alguma unique barrou. Sem chave de idempotencia no
      // cadastro, um replay e INDISTINGUIVEL de uma colisao real — e ambos sao
      // conflito. Converter isso em "ja existe, tudo certo" inventaria uma
      // idempotencia que o contrato nao tem (PORT_GAP deliberado de C7B0).
      const target = await classifyIdentityConflict(executor, input);
      if (target === undefined) {
        // Nenhuma das duas colunas de e-mail esta ocupada, mas o INSERT foi
        // barrado: a colisao veio de uma unique que o contrato nao representa —
        // na pratica a chave primaria, com a sequence dessincronizada apos um
        // restore. Devolver `unique_violation` aqui faria `decideSignup` dizer
        // ao usuario que o e-mail dele ja esta registrado quando esta LIVRE, e
        // nenhuma retentativa corrigiria. Falha fechado, como o `count > 1` do
        // CAS: sem resultado tipado possivel, o silencio seria a mentira.
        throw new Error("insercao de identidade barrada por unique nao prevista pelo contrato");
      }
      return { kind: "conflict", conflict: { reason: "unique_violation", target } };
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
