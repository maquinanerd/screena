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
      // O usuario e conferido ANTES da insercao — e esta e a unica ordem
      // possivel. `ON CONFLICT DO NOTHING` neutraliza a violacao de UNICIDADE,
      // mas NAO a de chave estrangeira: uma FK invalida ainda levanta P2003 e
      // aborta a transacao. Como `user_not_found` e um resultado previsto pelo
      // contrato, ele precisa ser produzido SEM excecao — logo, por leitura.
      //
      // Isto NAO e um precheck de unicidade disfarcado (esse continua sendo
      // decidido atomicamente pelo banco, abaixo). E a leitura mais barata
      // possivel: uma sonda de existencia pela PK, sem PII.
      //
      // Corrida residual: se o usuario sumisse entre a sonda e a insercao, o
      // P2003 voltaria a aparecer — e ai deve MESMO falhar fechado, porque seria
      // violacao de invariante. Na pratica ela nao ocorre neste dominio: a
      // exclusao LGPD anonimiza e mantem a linha (`deleted_at`), nunca a apaga.
      const dono = await executor.user.findUnique({
        where: { id: input.userId },
        select: { id: true },
      });
      if (dono === null) {
        return { kind: "user_not_found" };
      }

      // INSERCAO NAO-ABORTIVA: zero linhas = ja existe credencial (unique em
      // `user_id`, a relacao 1:1). Nunca sobrescrever — um `upsert` aqui trocaria
      // a senha de alguem sem pre-imagem, exatamente o que `replaceByPreimage`
      // existe para impedir.
      const criadas = await executor.passwordCredential.createManyAndReturn({
        data: [
          {
            userId: input.userId,
            passwordHash: input.passwordHash,
            // `algorithm` vem do PORT (o dominio o derivou do prefixo do PHC).
            // O adapter NAO o infere, NAO o deduz do hash e NAO o fixa em
            // "scrypt": a coluna tem default no banco, mas usar o default
            // silenciosamente descartaria o valor que o chamador enviou.
            algorithm: input.algorithm,
          },
        ],
        // A insercao devolveria a linha inteira — inclusive o hash. O select
        // minimo impede que o segredo volte pela rede para quem nao pediu.
        select: { id: true },
        skipDuplicates: true,
      });

      if (criadas.length === 1) {
        return { kind: "created" };
      }

      // ZERO LINHAS NAO E SINONIMO DE "ja existe credencial deste usuario".
      //
      // `ON CONFLICT DO NOTHING` sem alvo absorve TODA unique da tabela — a de
      // `user_id` E a chave primaria. Uma colisao de PK (sequence dessincronizada
      // depois de um restore) tambem devolve zero linhas, e responde-la com
      // `already_exists` afirmaria ao chamador um fato FALSO: o usuario ficaria
      // com identidade e SEM credencial, sem conseguir logar, e toda retentativa
      // repetiria o mesmo diagnostico errado.
      //
      // Por isso o alvo e CONFIRMADO por leitura antes de ser afirmado. Nao
      // havendo credencial, o conflito veio de uma unique que o contrato nao
      // representa — e ai vale a mesma regra do `count > 1` no CAS: falha
      // fechado. Abortar a transacao aqui e CORRETO; o estado nao tem resultado
      // tipado possivel, e seguir em frente propagaria a mentira.
      const ocupada = await executor.passwordCredential.findUnique({
        where: { userId: input.userId },
        select: { id: true },
      });
      if (ocupada === null) {
        throw new Error(
          "insercao de credencial barrada por unique nao prevista pelo contrato",
        );
      }

      return {
        kind: "already_exists",
        conflict: { reason: "unique_violation", target: "credential.user" },
      };
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
