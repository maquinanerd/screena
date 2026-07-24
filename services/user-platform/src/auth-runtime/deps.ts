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
  PasswordVerifierPort,
  SecretGeneratorPort,
  SecretHasherPort,
} from "../auth/types.js";
import type { TransactionalEmailProvider } from "../email/types.js";
import type {
  AccountLifecycleStore,
  AuthAuditStore,
  AuthThrottleStore,
  AuthTokenStore,
  CatalogReadStore,
  ConsentStore,
  DataRequestStore,
  EpisodeProgressStore,
  ExportReadStore,
  IdentityStore,
  ImportJobStore,
  PasswordCredentialStore,
  ProductContentPurgeStore,
  SessionStore,
  UserListItemStore,
  UserListStore,
  UserProfileStore,
  UserRatingStore,
  UserWatchStateStore,
  ViewingEventStore,
} from "../persistence/ports.js";
import type { TransactionScope } from "../persistence/types.js";
import type { UserStatus } from "../core/types.js";
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
  /**
   * User-agent bruto, JA TRUNCADO pela borda (C7D).
   *
   * Vai para `user_sessions.user_agent` e `user_auth_audit_logs.user_agent` —
   * as duas colunas que o schema criou para ele. Nao e PII direta, mas e
   * metadata de dispositivo: `minimizeUserAgent` (auth/sessions.ts) corta em
   * 256 chars e transforma vazio em `null`.
   *
   * `null` e o valor normal de um cliente que nao envia o cabecalho — nenhum
   * fluxo recusa por causa dele.
   */
  readonly userAgent: string | null;
}

/** Os stores que os fluxos de autenticacao usam, ligados a UMA transacao. */
export interface AuthStores {
  readonly identities: IdentityStore;
  readonly credentials: PasswordCredentialStore;
  readonly sessions: SessionStore;
  readonly authTokens: AuthTokenStore;
  readonly throttles: AuthThrottleStore;
  /**
   * C7D. Chegam pela MESMA transacao que os cinco acima porque os fluxos novos
   * os compoem de forma atomica: o cadastro grava identidade + credencial +
   * consentimento + auditoria ou nao grava nada; o encerramento revoga sessoes,
   * muda o status e audita no mesmo commit.
   */
  readonly profiles: UserProfileStore;
  readonly consents: ConsentStore;
  readonly dataRequests: DataRequestStore;
  readonly audit: AuthAuditStore;
  readonly accountLifecycle: AccountLifecycleStore;
  readonly exportReader: ExportReadStore;
  /**
   * C8. Entra em `AuthStores` — e nao so em `LibraryStores` — porque o
   * ENCERRAMENTO da conta precisa apagar conteudo de produto no MESMO commit em
   * que muda o status e audita. Separar as duas transacoes deixaria uma janela
   * em que a conta ja esta anonimizada e a biblioteca ainda existe.
   */
  readonly productContentPurge: ProductContentPurgeStore;
}

/**
 * Stores da BIBLIOTECA PESSOAL (C8), ligados a UMA transacao.
 *
 * Conjunto SEPARADO de `AuthStores` de proposito: os fluxos de biblioteca nao
 * tocam credencial, sessao, token nem auditoria de autenticacao, e os de
 * autenticacao nao tocam listas nem tracking. A separacao e reforcada pelo tipo
 * do executor (`PrismaLibraryExecutor`/`PrismaCatalogExecutor`), nao apenas por
 * convencao.
 */
export interface LibraryStores {
  readonly watchStates: UserWatchStateStore;
  readonly episodeProgress: EpisodeProgressStore;
  readonly viewingEvents: ViewingEventStore;
  readonly lists: UserListStore;
  readonly listItems: UserListItemStore;
  readonly ratings: UserRatingStore;
  readonly imports: ImportJobStore;
  readonly catalog: CatalogReadStore;
}

/** Executa um trabalho de biblioteca dentro de UMA transacao. */
export type LibraryTransactionRunner = <T>(
  work: (scope: TransactionScope, stores: LibraryStores) => Promise<T>,
) => Promise<T>;

/**
 * Identidade do usuario autenticado, resolvida a partir do cookie de sessao.
 *
 * `sessionId` viaja junto do `userId` porque quase toda operacao autenticada
 * precisa dos DOIS: o dono para autorizar e a sessao corrente para auditar,
 * para poupar da revogacao em massa ("sair dos outros dispositivos") e para
 * conferir o CSRF vinculado aquela sessao — `csrfTokenHash` e por sessao, nao
 * por usuario.
 */
export interface AuthenticatedContext {
  readonly userId: bigint;
  readonly sessionId: bigint;
  readonly userStatus: UserStatus;
  readonly csrfTokenHash: string;
  /**
   * C8. Carimbo de verificacao do e-mail, resolvido junto da sessao.
   *
   * Entra no contexto porque `canPublishList` (lists/custom-lists.ts) exige
   * e-mail verificado para tornar uma lista publica/nao-listada — um gate
   * antiabuso. Resolve-lo aqui evita uma segunda leitura de identidade em cada
   * criacao/edicao de lista, e mantem UM caminho de autenticacao.
   */
  readonly emailVerifiedAt: Date | null;
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

/**
 * Dependencias dos fluxos de SESSAO e PRIVACIDADE (C7D).
 *
 * Estende as de e-mail em vez de substitui-las porque os dois conjuntos
 * compartilham transacao, relogio, hasher e observabilidade — e porque o
 * cadastro precisa dos dois mundos ao mesmo tempo: cria a conta (sessao) e
 * dispara o e-mail de verificacao (entrega).
 *
 * O nome `AuthEmailRuntimeDeps` ficou estreito depois desta unidade; renomea-lo
 * tocaria arquivos que esta unidade nao precisa mexer, entao a extensao carrega
 * o nome largo e a base permanece como esta.
 */
export interface AuthRuntimeDeps extends AuthEmailRuntimeDeps {
  /** Verificacao de senha em tempo constante (core/crypto.verifyPassword). */
  readonly verifyPassword: PasswordVerifierPort;

  /**
   * Hash-ISCA para o login de conta inexistente.
   *
   * PHC valido, computado UMA vez na composicao com os MESMOS parametros scrypt
   * do hash real. Existe para fechar um oraculo de enumeracao por TEMPO:
   * `authenticatePassword` retorna `false` de imediato quando nao ha credencial,
   * sem rodar o KDF — entao um e-mail inexistente responderia em microssegundos
   * e um existente pagaria ~100 ms de scrypt. O login verifica a senha contra
   * este hash quando a conta nao existe, igualando o custo. O resultado da
   * verificacao contra a isca e SEMPRE descartado (a conta nao existe).
   */
  readonly decoyPasswordHash: string;

  /** TTL da sessao emitida no login. Politica: `SESSION_TTL_HOURS`. */
  readonly sessionTtlHours: number;

  /**
   * Ambiente. Decide APENAS o prefixo `__Host-` dos cookies — nunca relaxa
   * `Secure`, `HttpOnly` ou `SameSite`, que valem igual em todo ambiente.
   */
  readonly production: boolean;

  /**
   * Versoes VIGENTES dos documentos, do lado do SERVIDOR.
   *
   * Nunca vem do cliente: a prova de aceite tem de registrar a versao do texto
   * que o produto realmente apresentou. Aceitar a versao informada pelo
   * navegador permitiria registrar aceite de um documento inexistente.
   */
  readonly policyVersions: Readonly<Record<"terms_of_service" | "privacy_policy", string>>;

  /**
   * Janela de arrependimento do encerramento. Depois dela a conta e elegivel a
   * anonimizacao definitiva.
   */
  readonly deletionGraceDays: number;

  /**
   * Transacao da BIBLIOTECA PESSOAL (C8), separada da de autenticacao.
   *
   * Duas superficies transacionais em vez de uma porque os conjuntos de tabelas
   * sao disjuntos e o privilegio deve acompanhar isso: um fluxo de watchlist
   * nao tem por que enxergar credencial, e um fluxo de login nao tem por que
   * enxergar listas.
   */
  readonly runInLibraryTransaction: LibraryTransactionRunner;
}
