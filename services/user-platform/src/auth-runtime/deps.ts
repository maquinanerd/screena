/**
 * DEPENDENCIAS injetadas nos servicos de aplicacao de autenticacao (C7C).
 *
 * Nada aqui e construido: tudo chega pronto da composicao. E o que permite
 * testar os quatro fluxos com stores em memoria e um provedor falso, sem banco e
 * sem rede — e o que impede um servico de abrir conexao ou chamar relogio por
 * conta propria.
 *
 * OS STORES CHEGAM PELA TRANSACAO, nao pelo objeto de dependencias. A diferenca
 * nao e estilistica: um adapter Prisma e ligado ao client da transacao em que
 * nasce, entao guardar stores num objeto compartilhado faria duas requisicoes
 * concorrentes sobrescreverem os stores uma da outra e escreverem na transacao
 * errada. Passando-os como argumento do trabalho transacional, cada requisicao
 * enxerga so os seus.
 *
 * O RELOGIO entra como funcao (`now()`), seguindo a regra da camada: tempo e
 * parametro, nunca leitura global.
 */

import type {
  PasswordHasherPort,
  SecretGeneratorPort,
  SecretHasherPort,
} from "../auth/types.js";
import type { TransactionalEmailProvider } from "../email/types.js";
import type {
  AuthThrottleStore,
  AuthTokenStore,
  IdentityStore,
  PasswordCredentialStore,
  SessionStore,
} from "../persistence/ports.js";
import type { TransactionScope } from "../persistence/types.js";
import type { AuthEmailLogger } from "./observability.js";

/**
 * Contexto de UMA requisicao.
 *
 * O IP chega JA HASHEADO. A borda HTTP e o unico lugar que ve o endereco cru, e
 * ela o converte antes de entregar: assim nenhum servico, nenhum port e nenhum
 * adapter desta camada consegue persistir ou logar IP em texto claro, mesmo por
 * engano.
 */
export interface AuthRequestContext {
  /** Correlacao opaca (sem PII), usada so em log interno. */
  readonly correlationId: string;
  /** sha256 do IP com sal de servidor, ou `null` quando a origem e desconhecida. */
  readonly clientIpHash: string | null;
}

/** Os cinco stores que os fluxos de autenticacao usam, ligados a UMA transacao. */
export interface AuthStores {
  readonly identities: IdentityStore;
  readonly credentials: PasswordCredentialStore;
  readonly sessions: SessionStore;
  readonly authTokens: AuthTokenStore;
  readonly throttles: AuthThrottleStore;
}

/**
 * Executa um trabalho dentro de UMA transacao, entregando os stores ligados a
 * ela. A Brevo NUNCA e chamada dentro deste callback.
 */
export type AuthTransactionRunner = <T>(
  work: (scope: TransactionScope, stores: AuthStores) => Promise<T>,
) => Promise<T>;

export interface AuthEmailRuntimeDeps {
  readonly runInTransaction: AuthTransactionRunner;

  /** Port de e-mail. A composicao liga a Brevo; os testes ligam um duplo. */
  readonly emailProvider: TransactionalEmailProvider;

  /**
   * Agenda a ENTREGA para fora do caminho da resposta.
   *
   * Existe por causa de um canal de anti-enumeracao que status, corpo e
   * cabecalhos identicos nao fecham: o TEMPO. Se a resposta esperasse o envio,
   * uma conta inexistente responderia em milissegundos (nao ha nada a enviar) e
   * uma conta real responderia depois de uma ida e volta HTTPS ao fornecedor —
   * ate 8 s quando ele esta degradado. Essa diferenca e um oraculo de existencia
   * muito mais nitido do que qualquer um dos canais que a unidade fecha.
   *
   * O contrato e `void`: a tarefa NUNCA lanca (ver `dispatch.ts`), entao nao ha
   * rejeicao a tratar. Em producao a composicao apenas a solta; nos testes o
   * duble a coleta para que a suite possa aguardar.
   */
  readonly scheduleDelivery: (task: () => Promise<void>) => void;

  readonly publicAppUrl: URL;
  readonly passwordResetExpirationMinutes: number;
  readonly emailVerificationExpirationMinutes: number;

  readonly now: () => Date;
  readonly generateSecret: SecretGeneratorPort;
  readonly hashSecret: SecretHasherPort;
  readonly hashPassword: PasswordHasherPort;

  readonly logger: AuthEmailLogger;
}
