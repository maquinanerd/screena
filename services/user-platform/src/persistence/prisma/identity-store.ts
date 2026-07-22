/**
 * identity-store.ts — adapter Prisma de `IdentityStore` (Backend C, C7B1).
 *
 * Implementa EXATAMENTE os metodos do port: criar a identidade do cadastro,
 * busca-la pela chave natural anti-enumeracao, busca-la pela PK (status da
 * conta, para autenticar por sessao) e marcar o primeiro instante de verificacao
 * do e-mail. Nenhum `update` generico, nenhum `delete`, nenhuma listagem,
 * nenhuma busca por handle — nada sem consumidor real.
 *
 * Os dois ultimos entraram em C7B2.1, fechando o PORT_GAP que o C7B2 registrou.
 */

import type { IdentityStore } from "../ports.js";
import type {
  EmailVerificationInput,
  EmailVerificationResult,
  EmailVerificationStateLookupResult,
  IdentityCreateInput,
  IdentityCreateResult,
  IdentityLookupResult,
  TransactionScope,
} from "../types.js";
import { classifyIdentityConflict } from "./identity-conflict.js";
import type { PrismaExecutor } from "./executor.js";
import { toEmailVerificationState, toIdentityRecord } from "./mappers.js";

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

    async findById(_scope: TransactionScope, userId: bigint): Promise<IdentityLookupResult> {
      // Mesmo SELECT da busca por e-mail: `evaluateSessionAccess` consome
      // `status` e nada mais, e reusar a constante impede que as duas leituras
      // divirjam com o tempo.
      //
      // SEM filtro de status: quem decide elegibilidade e `accountCanHoldSession`.
      // Devolver `not_found` para uma conta desativada mentiria sobre a
      // existencia dela e apagaria a distincao que o motivo interno de auditoria
      // usa (`account_ineligible` != `not_found`).
      const row = await executor.user.findUnique({
        where: { id: userId },
        select: IDENTITY_SELECT,
      });
      if (row === null) {
        return { kind: "not_found" };
      }
      return { kind: "found", identity: toIdentityRecord(row) };
    },

    async markEmailVerified(
      _scope: TransactionScope,
      input: EmailVerificationInput,
    ): Promise<EmailVerificationResult> {
      // `emailVerifiedAt: null` na PRE-CONDICAO faz duas coisas de uma vez:
      // torna a operacao atomica (duas marcacoes concorrentes -> uma so grava) e
      // PRESERVA o primeiro carimbo, que e exatamente o que
      // `applyEmailVerification` define como idempotencia (`changed=false`
      // mantem o instante original).
      //
      // Nao ha leitura previa: ler para depois decidir e gravar abriria a janela
      // em que duas requisicoes leem "nao verificada" e ambas escrevem, e a
      // segunda sobrescreveria o carimbo da primeira.
      const aplicado = await executor.user.updateMany({
        where: { id: input.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: input.now },
      });

      if (aplicado.count > 1) {
        // `id` e a chave primaria: impossivel. Falha fechado.
        throw new Error("invariante violada: mais de uma identidade para a mesma chave primaria");
      }

      if (aplicado.count === 1) {
        return { kind: "verified" };
      }

      // Zero linhas tem DUAS causas — conta inexistente ou ja verificada — e o
      // contrato as separa. A sonda le apenas existencia; qualquer resultado
      // dela e uma recusa, entao ela nao pode transformar corrida em sucesso.
      //
      // A CLASSIFICACAO, porem, NAO e atomica com o UPDATE: entre os dois
      // comandos a linha pode nascer ou sumir, e os dois `kind` podem trocar
      // (provado nas duas direcoes com interleaving em banco real). Nenhuma troca
      // vira sucesso — o que fica impreciso e o MOTIVO de auditoria, nao a
      // decisao. Torna-la atomica exigiria um segundo lock so para rotular uma
      // recusa, o que custaria mais do que a imprecisao.
      const existe = await executor.user.findUnique({
        where: { id: input.userId },
        select: { id: true },
      });
      return existe === null ? { kind: "not_found" } : { kind: "already_verified" };
    },

    async findEmailVerificationStateByNormalizedEmail(
      _scope: TransactionScope,
      emailNormalized: string,
    ): Promise<EmailVerificationStateLookupResult> {
      // Chave: `email_normalized`. O comando publico do reenvio chega SEM
      // sessao, so com o e-mail — o `userId` e o que esta leitura DESCOBRE, para
      // que `buildEmailVerificationIssue` possa emitir o token depois.
      //
      // O adapter NAO normaliza: `parseRequestEmailVerificationCommand` ja
      // chamou `normalizeEmail`. Normalizar aqui criaria uma segunda definicao de
      // "normalizado", divergente da coluna e do cadastro.
      //
      // SELECT minimo: id, carimbo e status. O `status` entrou quando
      // `evaluateVerificationResend` passou a aplicar `accountCanHoldSession` —
      // antes disso seria campo sem leitor. Sem `email`, sem `displayName`, sem
      // `handle`.
      //
      // SEM filtro de status: a persistencia entrega o FATO e o dominio decide.
      // Filtrar aqui poria politica no adapter e devolveria `not_found` para uma
      // conta que existe. E o `not_found` daqui NAO vaza para a borda — a
      // resposta publica do reenvio e sempre a mesma (anti-enumeracao).
      const row = await executor.user.findUnique({
        where: { emailNormalized },
        select: { id: true, emailVerifiedAt: true, status: true },
      });
      if (row === null) {
        return { kind: "not_found" };
      }
      return { kind: "found", state: toEmailVerificationState(row) };
    },
  };
}
