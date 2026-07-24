/**
 * COMPOSITION ROOT do runtime de autenticacao por e-mail (Backend C, C7C).
 *
 * E o UNICO arquivo desta unidade que:
 *  - le `process.env`;
 *  - conhece a Brevo (via `providers/brevo`);
 *  - obtem o Prisma Client;
 *  - abre transacao.
 *
 * Tudo abaixo dele recebe portas prontas. E por isso que os servicos de
 * aplicacao, os handlers e o dominio nao tem como alcancar o ambiente, o driver
 * ou o fornecedor — nao e disciplina, e a direcao das dependencias.
 *
 * SERVER-ONLY. Nada aqui pode ser importado por componente de cliente: a chave
 * da Brevo e a conexao do banco vivem neste caminho.
 */

import { getPrismaClient } from "@screena/db/server";

import {
  generateOpaqueToken,
  hashIpAddress,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from "../core/crypto.js";
import {
  createPrismaAccountLifecycleStore,
  createPrismaAuthAuditStore,
  createPrismaAuthThrottleStore,
  createPrismaAuthTokenStore,
  createPrismaConsentStore,
  createPrismaDataRequestStore,
  createPrismaExportReadStore,
  createPrismaIdentityStore,
  createPrismaPasswordCredentialStore,
  createPrismaSessionStore,
  createPrismaUserProfileStore,
} from "../persistence/prisma/index.js";
import type { TransactionScope } from "../persistence/types.js";
import { createBrevoTransactionalEmailProvider } from "../providers/brevo/index.js";
import { createAuthHttpHandlers, type AuthHttpHandlers } from "../http/handlers.js";
import {
  createAuthenticatedHttpHandlers,
  type AuthenticatedHttpHandlers,
} from "../http/authenticated-handlers.js";
import { loadAuthEmailConfig, type AuthEmailConfig, type EnvSource } from "./config.js";
import type { AuthRuntimeDeps, AuthStores } from "./deps.js";
import { noopAuthEmailLogger, type AuthEmailLogger } from "./observability.js";

/**
 * Marcador de escopo transacional. E um contrato de COMPILACAO: quem o passa
 * declara estar dentro de uma transacao. O client concreto chega aos adapters
 * pelo executor, nunca por aqui.
 */
const SCOPE: TransactionScope = { transactional: true };

/**
 * Configuracao invalida na construcao do runtime.
 *
 * `details` carrega SOMENTE nomes de variavel e regras violadas — nunca valores
 * (ver `config.ts`). E por ser um tipo PROPRIO que a borda consegue registrar
 * esses detalhes com seguranca e, ao mesmo tempo, silenciar qualquer outra
 * excecao de construcao (a do driver, por exemplo, que pode citar a
 * `DATABASE_URL` inteira).
 */
export class AuthRuntimeConfigurationError extends Error {
  readonly details: readonly string[];

  constructor(details: readonly string[]) {
    super(`configuracao de e-mail transacional invalida: ${details.join("; ")}`);
    this.name = "AuthRuntimeConfigurationError";
    this.details = details;
  }
}

/** true quando o erro e de configuracao (e portanto seguro de registrar). */
export function isAuthRuntimeConfigurationError(
  error: unknown,
): error is AuthRuntimeConfigurationError {
  return error instanceof AuthRuntimeConfigurationError;
}

/**
 * Sal do hash de IP quando `CINERIE_IP_HASH_SALT` nao esta configurado.
 *
 * Gerado UMA vez por processo. Nao e fail-open: o IP continua nunca sendo
 * persistido em texto claro e o throttle por origem continua funcionando. O que
 * se perde e a correlacao ENTRE processos — apos um restart, ou em outra
 * replica, o mesmo IP produz outro hash e o orcamento por origem recomeca. O
 * orcamento por e-mail, que e o que limita quantas mensagens uma conta recebe,
 * nao depende disto. Configurar a variavel remove a degradacao.
 */
let ephemeralIpSalt: string | null = null;

function resolveIpHashSalt(config: AuthEmailConfig): string {
  if (config.ipHashSalt !== null) {
    return config.ipHashSalt;
  }
  if (ephemeralIpSalt === null) {
    // 64 chars hex: bem acima do minimo exigido por `hashIpAddress`.
    ephemeralIpSalt = generateOpaqueToken();
  }
  return ephemeralIpSalt;
}

export interface AuthRuntimeOptions {
  /** Mapa de ambiente. Default: `process.env` (so aqui). */
  readonly env?: EnvSource;
  /** Coletor de observabilidade redigida. Default: nao registra nada. */
  readonly logger?: AuthEmailLogger;
  /** Aviso de falha inesperada; recebe SO o id de correlacao. */
  readonly onUnexpectedError?: (correlationId: string) => void;
}

/**
 * Monta os quatro endpoints prontos para uma rota delegar.
 *
 * FALHA CEDO: configuracao invalida LANCA na construcao, com a lista de nomes de
 * variavel que faltam ou estao erradas — nunca com o valor de nenhuma delas. Um
 * runtime que subisse com `BREVO_API_KEY` vazia transformaria erro de deploy em
 * e-mail que nunca chega, e ninguem perceberia ate um usuario reclamar.
 */
/** Os dois conjuntos de handlers que a composicao monta. */
export interface AuthRuntimeHandlers {
  /** C7C — verificacao de e-mail e recuperacao de senha (publicos, sem sessao). */
  readonly email: AuthHttpHandlers;
  /** C7D — cadastro, login, sessao, perfil, privacidade (cookie + CSRF). */
  readonly authenticated: AuthenticatedHttpHandlers;
}

/**
 * Monta AMBOS os conjuntos de handlers sobre um unico `AuthRuntimeDeps`.
 *
 * Um runtime so, uma configuracao so, uma transacao so: os handlers de e-mail e
 * os autenticados compartilham stores, relogio, hasher e observabilidade, e o
 * cadastro precisa dos dois mundos ao mesmo tempo (cria a conta e dispara o
 * e-mail de verificacao).
 */
export function createFullAuthRuntime(options: AuthRuntimeOptions = {}): AuthRuntimeHandlers {
  const env = options.env ?? process.env;
  const production = env["NODE_ENV"] === "production";

  const loaded = loadAuthEmailConfig({ env, production });
  if (!loaded.ok) {
    // Erro TIPADO, nao `Error` genérico. Quem captura precisa poder distinguir
    // "configuracao invalida" (mensagem segura, so nomes de variavel) de
    // qualquer outra falha de construcao — por exemplo, o Prisma recusando a
    // `DATABASE_URL`, cuja mensagem carrega a senha do banco. Sem essa
    // distincao, um `catch` que registrasse `error.message` viraria um canal de
    // vazamento.
    throw new AuthRuntimeConfigurationError(loaded.error.details ?? []);
  }
  const config = loaded.value;
  const ipHashSalt = resolveIpHashSalt(config);

  const emailProvider = createBrevoTransactionalEmailProvider({
    apiKey: config.brevoApiKey,
    senderName: config.senderName,
    senderEmail: config.senderEmail,
    replyToEmail: config.replyToEmail,
  });

  const prisma = getPrismaClient();

  const runtime: AuthRuntimeDeps = {
    /**
     * Transacao INTERATIVA de escopo curto.
     *
     * Os stores sao criados DENTRO dela e entregues ao trabalho, ligados ao
     * client daquela transacao. Guarda-los num objeto de longa vida faria duas
     * requisicoes concorrentes sobrescreverem os stores uma da outra — e a
     * segunda escreveria na transacao da primeira.
     *
     * A Brevo NUNCA e chamada aqui dentro: o envio acontece depois que esta
     * funcao ja retornou e o commit ja aconteceu (ver `dispatch.ts`).
     */
    runInTransaction: <T>(
      work: (scope: TransactionScope, stores: AuthStores) => Promise<T>,
    ): Promise<T> =>
      prisma.$transaction((tx) =>
        work(SCOPE, {
          identities: createPrismaIdentityStore(tx),
          credentials: createPrismaPasswordCredentialStore(tx),
          sessions: createPrismaSessionStore(tx),
          authTokens: createPrismaAuthTokenStore(tx),
          throttles: createPrismaAuthThrottleStore(tx),
          // C7D. Todos ligados ao MESMO `tx`: e o que torna cadastro
          // (identidade + credencial + consentimento + auditoria) e
          // encerramento (revogacao + status + auditoria) atomicos.
          profiles: createPrismaUserProfileStore(tx),
          consents: createPrismaConsentStore(tx),
          dataRequests: createPrismaDataRequestStore(tx),
          audit: createPrismaAuthAuditStore(tx),
          accountLifecycle: createPrismaAccountLifecycleStore(tx),
          exportReader: createPrismaExportReadStore(tx),
        }),
      ),

    emailProvider,

    /**
     * Solta a entrega para fora do caminho da resposta.
     *
     * `void` e deliberado, nao esquecimento: `dispatchAuthEmail` NUNCA lanca
     * (contem a propria falha e a registra), entao nao ha rejeicao a tratar e um
     * `await` aqui reintroduziria exatamente o oraculo de tempo que este desenho
     * fecha — a resposta demoraria o que o fornecedor demorar, e so quando ha
     * conta.
     *
     * Custo aceito e ja registrado: se o processo morrer entre o commit e o
     * envio, o token fica valido porem nao entregue — a mesma janela que a
     * ausencia de outbox ja produz. O usuario pede de novo.
     */
    scheduleDelivery: (task: () => Promise<void>): void => {
      void task();
    },

    publicAppUrl: config.publicAppUrl,
    passwordResetExpirationMinutes: config.passwordResetExpirationMinutes,
    emailVerificationExpirationMinutes: config.emailVerificationExpirationMinutes,
    now: () => new Date(),
    generateSecret: generateOpaqueToken,
    hashSecret: sha256Hex,
    hashPassword,
    logger: options.logger ?? noopAuthEmailLogger,

    // C7D — sessao e privacidade.
    verifyPassword,
    sessionTtlHours: config.sessionTtlHours,
    production,
    policyVersions: {
      terms_of_service: config.termsPolicyVersion,
      privacy_policy: config.privacyPolicyVersion,
    },
    deletionGraceDays: config.deletionGraceDays,
  };

  const edgeDeps = {
    hashClientIp: (ip: string) => hashIpAddress(ip, ipHashSalt),
    newCorrelationId: () => generateOpaqueToken().slice(0, 32),
    onUnexpectedError: options.onUnexpectedError,
  };

  return {
    email: createAuthHttpHandlers({ runtime, ...edgeDeps }),
    authenticated: createAuthenticatedHttpHandlers({ runtime, ...edgeDeps }),
  };
}

/** So os handlers de e-mail (C7C), para quem nao precisa da camada de sessao. */
export function createAuthRuntime(options: AuthRuntimeOptions = {}): AuthHttpHandlers {
  return createFullAuthRuntime(options).email;
}
