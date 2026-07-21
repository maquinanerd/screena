/**
 * password-credential-store.ts — adapter Prisma de `PasswordCredentialStore`
 * (Backend C, C7B1).
 *
 * Senha em texto claro NUNCA entra aqui: o adapter recebe hash pronto e o trata
 * como STRING OPACA — nao gera, nao verifica, nao interpreta PHC, nao extrai
 * parametros de scrypt, nao deriva `algorithm`. O rotulo do algoritmo vem do
 * dominio (`auth/credentials.ts`), que o derivou do prefixo do proprio PHC.
 *
 * O hash nao aparece em log, em mensagem de erro nem em nenhum retorno alem de
 * `findForVerification` — o unico metodo autorizado a devolve-lo.
 */

import type { PasswordCredentialStore } from "../ports.js";
import type {
  CredentialCreateInput,
  CredentialCreateResult,
  CredentialReplaceInput,
  CredentialReplaceResult,
  CredentialVerificationLookupResult,
  TransactionScope,
} from "../types.js";
import {
  classifyCredentialUniqueTarget,
  isForeignKeyViolation,
  isUniqueViolation,
} from "./error-mapping.js";
import type { PrismaExecutor } from "./executor.js";
import { toCredentialVerificationMaterial } from "./mappers.js";

export function createPrismaPasswordCredentialStore(
  executor: PrismaExecutor,
): PasswordCredentialStore {
  return {
    async createInitial(
      _scope: TransactionScope,
      input: CredentialCreateInput,
    ): Promise<CredentialCreateResult> {
      try {
        await executor.passwordCredential.create({
          data: {
            userId: input.userId,
            passwordHash: input.passwordHash,
            // `algorithm` vem do PORT (o dominio o derivou do prefixo do PHC).
            // O adapter NAO o infere, NAO o deduz do hash e NAO o fixa em
            // "scrypt": a coluna tem default no banco, mas usar o default
            // silenciosamente descartaria o valor que o chamador enviou.
            algorithm: input.algorithm,
          },
          // `create` devolve a linha inteira por padrao — inclusive o hash. O
          // select minimo impede que o segredo volte pela rede para um chamador
          // que nao pediu por ele.
          select: { id: true },
        });
        return { kind: "created" };
      } catch (error) {
        // `already_exists` NAO e um sinonimo de "unique violation": o contrato o
        // define como "ja existe credencial para o usuario (1:1)". Por isso ele
        // so pode ser afirmado quando o alvo classifica como `credential.user`.
        //
        // Uma unique DIFERENTE (por exemplo a PK, apos um restore que deixou a
        // sequencia dessincronizada) tambem chega como P2002 — e responde-la com
        // `already_exists` afirmaria ao chamador um fato FALSO: que aquele
        // usuario ja tem credencial. O cadastro seria abortado por causa errada,
        // e nenhuma retentativa corrigiria. Sem representacao no contrato, o erro
        // sobe intacto, como qualquer outra falha de infraestrutura.
        //
        // Nunca sobrescrever: um `upsert` aqui trocaria a senha de alguem sem
        // pre-imagem, que e exatamente o que `replaceByPreimage` existe para
        // impedir.
        if (isUniqueViolation(error)) {
          const target = classifyCredentialUniqueTarget(error);
          if (target !== undefined) {
            return { kind: "already_exists", conflict: { reason: "unique_violation", target } };
          }
        } else if (isForeignKeyViolation(error)) {
          return { kind: "user_not_found" };
        }
        throw error;
      }
    },

    async findForVerification(
      _scope: TransactionScope,
      userId: bigint,
    ): Promise<CredentialVerificationLookupResult> {
      const row = await executor.passwordCredential.findUnique({
        where: { userId },
        // So o hash. Nem `algorithm`, nem `id`, nem timestamps, nem o usuario.
        select: { passwordHash: true },
      });
      if (row === null) {
        return { kind: "not_found" };
      }
      return { kind: "found", material: toCredentialVerificationMaterial(row) };
    },

    async replaceByPreimage(
      _scope: TransactionScope,
      input: CredentialReplaceInput,
    ): Promise<CredentialReplaceResult> {
      // COMPARE-AND-SWAP ATOMICO. A pre-imagem entra no WHERE, nao numa
      // comparacao em memoria: ler-comparar-gravar abriria uma janela TOCTOU em
      // que duas trocas concorrentes leem o mesmo hash e ambas gravam, e a
      // segunda sobrescreveria a primeira em silencio (last-write-wins).
      //
      // `updateMany` (nao `update`) porque so ele aceita uma pre-condicao alem
      // da chave; e, ao contrario de SQL cru, honra o `@updatedAt` do modelo —
      // a coluna `updated_at` e NOT NULL e nao tem default no banco.
      const applied = await executor.passwordCredential.updateMany({
        where: { userId: input.userId, passwordHash: input.expectedPasswordHash },
        data: { passwordHash: input.nextPasswordHash, algorithm: input.nextAlgorithm },
      });

      if (applied.count === 1) {
        return { kind: "updated" };
      }

      if (applied.count > 1) {
        // `user_id` e unique: mais de uma linha e impossivel. Se acontecer, o
        // banco perdeu a constraint — recusar-se a REPORTAR sucesso e a unica
        // resposta honesta. A mensagem nao carrega id, hash nem SQL.
        //
        // Limite real, registrado para nao ser confundido com garantia: a
        // excecao nao DESFAZ a escrita. O UPDATE multiplo ja aconteceu, e fora
        // de transacao ja esta comitado — quem quiser atomicidade aqui precisa
        // chamar dentro de uma (C7C).
        throw new Error("invariante violada: mais de uma credencial para o mesmo usuario");
      }

      // Zero linhas tem DUAS causas, e a sonda abaixo as rotula. Ela le apenas a
      // existencia (`id`), nunca o hash, e nunca pode transformar corrida em
      // sucesso: qualquer resultado dela e `not_found` ou `conflict`, jamais
      // `updated`.
      //
      // Precisao que o rotulo NAO tem: a sonda observa o instante DELA, nao o da
      // escrita. Se a credencial for criada ou apagada nesse intervalo, o kind
      // devolvido pode descrever o estado mais novo em vez do que causou o
      // count=0. A escolha e sempre segura (nenhum caminho vira `updated`), mas
      // quem consome nao deve ler `not_found`/`stale_preimage` como um
      // diagnostico exato do passado.
      const existing = await executor.passwordCredential.findUnique({
        where: { userId: input.userId },
        select: { id: true },
      });
      if (existing === null) {
        return { kind: "not_found" };
      }
      return {
        kind: "conflict",
        conflict: { reason: "stale_preimage", target: "credential.passwordHash" },
      };
    },
  };
}
