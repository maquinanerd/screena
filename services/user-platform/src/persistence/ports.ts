/**
 * ports.ts — PORTAS de persistencia (Backend C, C7A).
 *
 * SO INTERFACES. Cada porta espelha um DOMINIO real e recebe os PLANOS que o
 * dominio ja produziu — deliberadamente NAO ha `BaseRepository` nem
 * `Repository<T>` generico: um CRUD generico apagaria justamente as
 * pre-condicoes (vigencia, idempotencia, compare-and-swap) que tornam a escrita
 * segura.
 *
 * Implementacao concreta = C7B. Aqui nao ha PrismaClient, SQL, rede nem HTTP.
 */

import type {
  CurrentSnapshotSummary,
  FeedbackPlan,
  RecommendationContext,
  SnapshotPublicationPlan,
  StoredFeedback,
} from "../recommendations/index.js";
import type {
  ConsentKind,
  DataRequestKind,
  ImportJobStatus,
  RatableEntityType,
  SystemListKey,
  ViewingEventType,
  WatchableEntityType,
  WatchState,
} from "../core/types.js";
import type { SessionRecord, VerificationTokenRecord } from "../auth/types.js";
import type {
  AccountAnonymizeInput,
  AccountAnonymizeResult,
  AccountStatusTransitionInput,
  AccountStatusTransitionResult,
  AuthAuditAppendInput,
  AuthenticatedUserLookupResult,
  AuthThrottleKey,
  // C8 — biblioteca pessoal
  CatalogEpisodeRecord,
  CatalogMatchCandidate,
  EntityRefRecord,
  EpisodeBulkMarkInput,
  EpisodeBulkMarkResult,
  EpisodeProgressLookupResult,
  EpisodeProgressUpsertInput,
  EpisodeProgressUpsertResult,
  ImportJobCreateInput,
  ImportJobLookupResult,
  ImportJobRecord,
  ImportJobTransitionInput,
  ImportJobTransitionResult,
  ItemPositionInput,
  SeriesEpisodeQuery,
  UserListCreateInput,
  UserListCreateResult,
  UserListItemAddInput,
  UserListItemAddResult,
  UserListItemPage,
  UserListLookupResult,
  UserListRecord,
  UserListUpdateInput,
  UserRatingRecord,
  UserRatingUpsertInput,
  UserRatingUpsertResult,
  ViewingEventAppendInput,
  ViewingEventAppendResult,
  ViewingEventPage,
  WatchedEpisodeCount,
  WatchStateLookupResult,
  WatchStatePage,
  WatchStateUpsertInput,
  WatchStateUpsertResult,
  AuthThrottleReadResult,
  AuthThrottleSaveInput,
  AuthThrottleSaveResult,
  ConsentAppendInput,
  ConsentRecordRow,
  DataRequestCreateInput,
  DataRequestCreateResult,
  DataRequestLookupResult,
  DataRequestRecord,
  DataRequestTransitionInput,
  DataRequestTransitionResult,
  ExportProjectionResult,
  ProfileLookupResult,
  ProfileUpsertInput,
  ProfileUpsertResult,
  AuthTokenConsumeInput,
  AuthTokenConsumeResult,
  AuthTokenInvalidatePendingInput,
  AuthTokenInvalidatePendingResult,
  AuthTokenIssueResult,
  CredentialCreateInput,
  EmailVerificationInput,
  EmailVerificationResult,
  EmailVerificationStateLookupResult,
  CredentialCreateResult,
  CredentialReplaceInput,
  CredentialReplaceResult,
  CredentialVerificationLookupResult,
  IdentityCreateInput,
  IdentityCreateResult,
  IdentityLookupResult,
  PersistenceOutcome,
  SessionCreateResult,
  SessionListActiveInput,
  SessionLookupResult,
  SessionRevokeInput,
  SessionRevokeResult,
  TransactionScope,
  WrittenRowRef,
} from "./types.js";

/**
 * Executa um trabalho dentro de UMA transacao. Os planos de C6B descrevem
 * operacoes que so sao seguras se aplicadas atomicamente (rebaixar o vigente e
 * inserir o novo).
 */
export interface TransactionRunner {
  runInTransaction<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T>;
}

/**
 * IDENTIDADE do usuario (C7B0). As operacoes sao DERIVADAS dos fluxos reais:
 *  - `decideSignup` (auth/flows.ts:47) precisa saber se o e-mail ja existe e,
 *    quando nao existe, criar a identidade;
 *  - `decideLogin` (auth/flows.ts:95) precisa de existencia + status.
 *
 * Deliberadamente NAO ha: `update` generico, `delete`, listagem, busca por
 * handle nem `transitionStatus`. Sem CRUD generico e sem operacao
 * administrativa.
 *
 * C7B2.1 fechou o PORT_GAP que o C7B2 registrou: `findById` (status da conta,
 * para `evaluateSessionAccess`) e `markEmailVerified` (carimbo, depois do
 * consumo atomico do token). Os dois `userId` que o C7B2 devolve passam a ter
 * destino real.
 *
 * C7B2.2 fechou a leitura do carimbo para o dominio de AUTENTICACAO:
 * `findEmailVerificationStateByNormalizedEmail` alimenta
 * `evaluateVerificationResend`. A leitura ficou em metodo PROPRIO, com shape
 * proprio — ampliar `IdentityLookupResult` faria o caminho de sessao e de
 * cadastro carregarem um carimbo que nao consomem.
 *
 * Segue PENDENTE (outro dominio, nao autenticacao): `canPublishList` e
 * `validate*VisibilityTransition` consomem o mesmo carimbo por `userId`. Nasce
 * com listas/privacidade (C7B3/C7B4), que podem reusar o fato ja persistido.
 *
 * Nenhum retorno carrega `passwordHash`: credencial e outro port.
 */
export interface IdentityStore {
  /**
   * Cria a identidade do cadastro. Conflito de unicidade e CLASSIFICADO por
   * alvo semantico (`identity.email` / `identity.emailNormalized` /
   * `identity.handle`) — nunca por nome de constraint.
   *
   * O adapter NAO normaliza nada: recebe `emailNormalized` ja normalizado pelo
   * dominio (`auth/identity.normalizeEmail`).
   */
  create(scope: TransactionScope, input: IdentityCreateInput): Promise<IdentityCreateResult>;

  /**
   * Busca pela chave natural anti-enumeracao (`email_normalized`). Serve aos
   * DOIS fluxos: `emailAlreadyRegistered` no signup e `userExists`/`userStatus`
   * no login. `not_found` e um resultado normal, nao erro.
   */
  findByNormalizedEmail(
    scope: TransactionScope,
    emailNormalized: string,
  ): Promise<IdentityLookupResult>;

  /**
   * Busca pela PK. Consumidor: `evaluateSessionAccess` exige
   * `userStatus: UserStatus | null`, e `SessionAccessRecord.userId` existe
   * exatamente para chegar ate aqui — sem este metodo, autenticar por sessao nao
   * fecha.
   *
   * Devolve o MESMO `IdentityLookupResult` da busca por e-mail: os dois
   * consumidores precisam de `{ id, status }` e nada mais, entao um segundo tipo
   * identico so criaria divergencia futura.
   *
   * NAO filtra conta desativada nem nao-verificada: quem decide elegibilidade e
   * `accountCanHoldSession`, no dominio. Filtrar aqui devolveria `not_found`
   * para uma conta que existe e apagaria a distincao que alimenta o motivo
   * interno de auditoria.
   */
  findById(scope: TransactionScope, userId: bigint): Promise<IdentityLookupResult>;

  /**
   * Marca o PRIMEIRO instante de verificacao do e-mail. Consumidor:
   * `applyEmailVerification`, chamado depois do consumo atomico de um token de
   * `email_verification`.
   *
   * Idempotente por construcao do dominio: ja verificada PRESERVA o carimbo
   * original (`changed=false`), nunca o sobrescreve.
   */
  markEmailVerified(
    scope: TransactionScope,
    input: EmailVerificationInput,
  ): Promise<EmailVerificationResult>;

  /**
   * Estado de verificacao para o REENVIO. Consumidor:
   * `evaluateVerificationResend` precisa de `userExists` e `alreadyVerified`, e
   * `buildEmailVerificationIssue` precisa do `userId` para emitir o token.
   *
   * A chave e `email_normalized` porque o comando publico do reenvio
   * (`RequestEmailVerificationCommand`) chega SEM sessao, so com o e-mail — o
   * `userId` e o que este metodo descobre, nao o que ele recebe.
   *
   * Devolve o CARIMBO, nao um booleano: `alreadyVerified` e politica do dominio.
   * O adapter NAO normaliza (a normalizacao e de
   * `parseRequestEmailVerificationCommand`) e NAO filtra por status.
   */
  findEmailVerificationStateByNormalizedEmail(
    scope: TransactionScope,
    emailNormalized: string,
  ): Promise<EmailVerificationStateLookupResult>;
}

/**
 * CREDENCIAL de senha (C7B0). O schema mantem UMA credencial por usuario
 * (relacao 1:1); este contrato reflete exatamente isso — sem historico, sem
 * versoes, sem rotacao, sem listagem, sem delete destrutivo.
 *
 * Senha em texto claro NUNCA atravessa este port. O hash e STRING OPACA: o port
 * nao gera, nao verifica e nao interpreta o PHC (isso e `auth/credentials.ts` +
 * `core/crypto`).
 */
export interface PasswordCredentialStore {
  /** Credencial INICIAL do cadastro. Recebe hash, nunca senha. */
  createInitial(
    scope: TransactionScope,
    input: CredentialCreateInput,
  ): Promise<CredentialCreateResult>;

  /**
   * UNICO metodo autorizado a devolver o hash — existe para alimentar
   * `authenticatePassword` (auth/credentials.ts:58), que compara em tempo
   * constante dentro da porta de verificacao. O resultado NUNCA deve ser
   * logado nem embutido em mensagem de erro.
   */
  findForVerification(
    scope: TransactionScope,
    userId: bigint,
  ): Promise<CredentialVerificationLookupResult>;

  /**
   * Troca de senha por COMPARE-AND-SWAP sobre a pre-imagem do hash (nao ha
   * coluna `version`). Se o hash vigente nao for mais `expectedPasswordHash`,
   * o resultado e `conflict` (`stale_preimage`) — nunca last-write-wins.
   *
   * A revogacao de sessoes que `buildPasswordChange` tambem planeja pertence ao
   * port de sessoes (C7B2) e sera composta na mesma transacao em C7C.
   */
  replaceByPreimage(
    scope: TransactionScope,
    input: CredentialReplaceInput,
  ): Promise<CredentialReplaceResult>;
}

/**
 * Snapshot de recomendacao. O vigente e por (usuario, CONTEXTO) — o indice
 * unico parcial `(user_id, context) WHERE is_current` e a trava final.
 */
export interface RecommendationSnapshotStore {
  /**
   * Le o resumo do snapshot VIGENTE. `fingerprint` pode vir `null` (linha
   * legada): quem consome DEVE tratar null como NAO-equivalente (forca replace),
   * nunca como igual.
   */
  readCurrent(
    scope: TransactionScope,
    input: { readonly ownerUserId: bigint; readonly context: RecommendationContext },
  ): Promise<CurrentSnapshotSummary | null>;

  /**
   * Aplica um plano JA decidido pelo dominio (`create`/`replace`/`renew`/
   * `invalidate`). Planos `noop`/`conflict`/`invalid`/`forbidden` nao escrevem.
   */
  applyPublication(
    scope: TransactionScope,
    plan: SnapshotPublicationPlan,
  ): Promise<PersistenceOutcome<WrittenRowRef>>;
}

/** Feedback explicito de recomendacao (idempotente por usuario + chave). */
export interface RecommendationFeedbackStore {
  /** Pre-imagem por chave de idempotencia (escopo do usuario). */
  readByIdempotencyKey(
    scope: TransactionScope,
    input: { readonly ownerUserId: bigint; readonly idempotencyKey: string },
  ): Promise<StoredFeedback | null>;

  /** Aplica o plano de feedback; `noop`/`conflict` nao escrevem. */
  applyFeedback(
    scope: TransactionScope,
    plan: FeedbackPlan,
  ): Promise<PersistenceOutcome<WrittenRowRef>>;

  /**
   * Feedbacks ATIVOS do usuario, para o dominio derivar exclusoes. A janela
   * temporal e decidida no dominio (`now` injetado), nao pelo relogio do banco.
   */
  listActiveForUser(
    scope: TransactionScope,
    input: { readonly ownerUserId: bigint },
  ): Promise<readonly StoredFeedback[]>;
}

/**
 * SESSOES (C7B2). Os metodos sao DERIVADOS das structs que o dominio ja publica:
 *  - `buildSessionCreation`/`buildSessionRotation` produzem `SessionRecord` -> `create`;
 *  - `evaluateSessionAccess` consome `{ expiresAt, revokedAt }` + status -> `findByTokenHash`;
 *  - `planLogout`/`planRevokeAll`/`planRevokeAllAfterSensitiveEvent` produzem
 *    `revokeSessionIds: readonly bigint[]` -> `revoke` (um metodo, tres planos);
 *  - `planRevokeAll` e `buildPasswordChange` CONSOMEM `activeSessionIds` -> `listActiveIds`.
 *
 * Deliberadamente NAO ha: `touch`/`lastUsedAt` (nenhuma funcao pura o produz),
 * `deleteExpired`/`purge` (sem consumidor), `rotate` (e composicao de `create` +
 * `revoke` na mesma transacao, decidida por `buildSessionRotation`).
 *
 * O adapter NAO decide vigencia no lookup: `evaluateSessionAccess` compara
 * `now >= expiresAt` e olha `revokedAt` para separar expirada de revogada. Se o
 * adapter filtrasse, a politica existiria em dois lugares e o motivo interno de
 * auditoria se perderia.
 */
export interface SessionStore {
  /** Persiste a sessao ja montada pelo dominio (so hashes). */
  create(scope: TransactionScope, record: SessionRecord): Promise<SessionCreateResult>;

  /**
   * Busca pelo hash do token — nunca pelo token cru, que jamais chega aqui.
   * Devolve o material de decisao SEM filtrar: expirada e revogada tambem sao
   * `found`, porque quem decide e o dominio.
   */
  findByTokenHash(scope: TransactionScope, tokenHash: string): Promise<SessionLookupResult>;

  /** Revoga em lote, com `now` explicito. Idempotente: ja revogada nao conta. */
  revoke(scope: TransactionScope, input: SessionRevokeInput): Promise<SessionRevokeResult>;

  /** Ids das sessoes VIGENTES em `now` — insumo de `activeSessionIds`. */
  listActiveIds(
    scope: TransactionScope,
    input: SessionListActiveInput,
  ): Promise<readonly bigint[]>;
}

/**
 * TOKENS DE USO UNICO (C7B2) — verificacao de e-mail e recuperacao de senha.
 *
 * UM port para os DOIS fluxos porque o schema tem UMA tabela
 * (`user_verification_tokens`) discriminada por um enum FECHADO
 * (`AuthTokenPurpose`), e o dominio produz a MESMA struct
 * (`VerificationTokenRecord`) nos dois casos — mudando so o `purpose`. Dois
 * ports sobre a mesma tabela seriam duplicacao; um port "de token generico"
 * seria abstracao sem dono.
 *
 * O `purpose` e pre-condicao de consumo, nao rotulo: token de verificacao nunca
 * troca senha, token de reset nunca verifica e-mail.
 *
 * Deliberadamente NAO ha `findByTokenHash`: ler para depois decidir e escrever
 * abriria a janela de replay que `consume` fecha atomicamente. O unico dado que
 * a leitura traria a mais — o `userId` — sai do proprio consumo.
 */
export interface AuthTokenStore {
  /** Persiste o token ja montado pelo dominio (so o hash). */
  issue(
    scope: TransactionScope,
    record: VerificationTokenRecord,
  ): Promise<AuthTokenIssueResult>;

  /**
   * Consumo ATOMICO de uso unico: hash + proposito + nao-consumido + nao-expirado
   * sao PRE-CONDICOES da escrita, avaliadas pelo banco no mesmo comando que
   * marca `consumedAt`. Duas tentativas concorrentes -> exatamente uma vence.
   */
  consume(
    scope: TransactionScope,
    input: AuthTokenConsumeInput,
  ): Promise<AuthTokenConsumeResult>;

  /**
   * Queima todos os tokens pendentes de um proposito. Consumidor:
   * `applyPasswordReset` (`invalidateAllPendingResetTokens: true`) — trocada a
   * senha, nenhum outro link de reset pode continuar valendo.
   */
  invalidatePending(
    scope: TransactionScope,
    input: AuthTokenInvalidatePendingInput,
  ): Promise<AuthTokenInvalidatePendingResult>;
}

/**
 * THROTTLE DURAVEL (C7C) — janela deslizante + lockout por chave apresentada.
 *
 * DOIS metodos, e so dois, porque a politica ja existe pura em `auth/policy.ts`:
 * `evaluateThrottle` decide se esta travado e `registerFailure` produz o proximo
 * estado. O port faz o que so o banco pode fazer — LER o estado atual e GRAVAR o
 * proximo — e nada mais.
 *
 * Deliberadamente NAO ha: `increment` (poria a politica de janela/lockout dentro
 * do adapter, duplicando `registerFailure`), `reset`/`clear` (nenhum fluxo desta
 * unidade limpa contagem — `registerSuccess` pertence ao login, que e outra
 * unidade), `listLocked` e qualquer varredura administrativa.
 *
 * O adapter NAO le o relogio e NAO decide vigencia: devolve as colunas como
 * estao. Uma janela ja vencida chega intacta aqui e e `evaluateThrottle`, com o
 * `now` injetado, que a considera limpa — se o adapter filtrasse, existiriam
 * duas definicoes de "janela aberta".
 */
export interface AuthThrottleStore {
  /** Estado atual da chave. `not_found` e resultado normal, nao erro. */
  read(scope: TransactionScope, input: AuthThrottleKey): Promise<AuthThrottleReadResult>;

  /**
   * Grava o proximo estado por COMPARE-AND-SWAP sobre a pre-imagem lida. Se a
   * linha mudou nesse meio-tempo, devolve `conflict` — nunca last-write-wins,
   * que faria duas tentativas concorrentes contarem como uma so.
   */
  save(scope: TransactionScope, input: AuthThrottleSaveInput): Promise<AuthThrottleSaveResult>;
}

/**
 * PERFIL PUBLICO (C7D). Duas operacoes, derivadas das duas telas reais: ler o
 * perfil para exibir/preencher o formulario e gravar o estado completo.
 *
 * Deliberadamente NAO ha: `delete` (perfil morre com a conta, por cascade),
 * listagem, busca por handle (nenhuma tela desta unidade a consome — a busca de
 * pessoas e catalogo, nao usuario) e update parcial (ver `ProfileUpsertInput`).
 */
export interface UserProfileStore {
  findByUserId(scope: TransactionScope, userId: bigint): Promise<ProfileLookupResult>;

  /**
   * Visao COMPLETA do proprio dono, para montar a resposta autenticada.
   *
   * Separada de `IdentityStore.findById` porque as duas respondem perguntas
   * diferentes: aquela responde "esta conta pode ter sessao?" (e por isso
   * devolve so `{id, status}`); esta responde "o que mostro para o dono?".
   * Fundi-las faria todo login e toda validacao de sessao carregarem e-mail e
   * carimbos que nao consomem.
   */
  findAuthenticatedUser(
    scope: TransactionScope,
    userId: bigint,
  ): Promise<AuthenticatedUserLookupResult>;

  /**
   * Grava nome publico (`users`) + perfil (`user_profiles`) na MESMA transacao.
   * Cria a linha de perfil quando ela ainda nao existe — uma conta recem-criada
   * nao tem perfil, e obrigar a borda a distinguir "criar" de "atualizar"
   * exporia uma diferenca que nenhuma tela tem.
   *
   * Conflito de `handle` e CLASSIFICADO por alvo semantico (`identity.handle`),
   * nunca por nome de constraint.
   */
  upsert(scope: TransactionScope, input: ProfileUpsertInput): Promise<ProfileUpsertResult>;
}

/**
 * CONSENTIMENTO (C7D). APPEND-ONLY por invariante LGPD: o port nao expoe
 * `update` nem `delete`, entao nao existe caminho de codigo que apague prova de
 * consentimento — nem por engano, nem por pedido do titular (a propria LGPD
 * exige reter a prova).
 *
 * A LEITURA nao filtra e nao ordena: `currentConsent`/`isConsentActive`
 * (privacy/consent.ts) sao quem decidem o vigente. Filtrar aqui poria a mesma
 * politica em dois lugares.
 */
export interface ConsentStore {
  append(scope: TransactionScope, input: ConsentAppendInput): Promise<void>;

  /** Todos os registros do titular. Insumo de `currentConsent`. */
  listByUser(scope: TransactionScope, userId: bigint): Promise<readonly ConsentRecordRow[]>;

  /**
   * Registros de UMA finalidade. Existe para o caminho quente do gate de
   * tracking, que consulta uma finalidade so e nao deve pagar a leitura do
   * historico inteiro.
   */
  listByUserAndKind(
    scope: TransactionScope,
    input: { readonly userId: bigint; readonly kind: ConsentKind },
  ): Promise<readonly ConsentRecordRow[]>;
}

/**
 * PEDIDOS LGPD (C7D) — exportacao e exclusao.
 *
 * `findLatestByKind` alimenta a decisao de idempotencia que o dominio ja
 * declara (`decideExportRequest` rejeita quando ha pedido ATIVO). O adapter
 * devolve o mais recente SEM avaliar se esta ativo: `isRequestActive`
 * (privacy/export.ts) e quem sabe quais status contam.
 */
export interface DataRequestStore {
  create(
    scope: TransactionScope,
    input: DataRequestCreateInput,
  ): Promise<DataRequestCreateResult>;

  findLatestByKind(
    scope: TransactionScope,
    input: { readonly userId: bigint; readonly kind: DataRequestKind },
  ): Promise<DataRequestLookupResult>;

  /** Historico do titular. Entra na EXPORTACAO (`governance_requests`). */
  listByUser(
    scope: TransactionScope,
    userId: bigint,
  ): Promise<readonly DataRequestRecord[]>;

  /** Transicao por COMPARE-AND-SWAP sobre o status esperado. */
  transition(
    scope: TransactionScope,
    input: DataRequestTransitionInput,
  ): Promise<DataRequestTransitionResult>;
}

/**
 * AUDITORIA DE AUTENTICACAO (C7D). UM metodo, porque a tabela e append-only por
 * TRIGGER no banco: um `update` neste port seria uma promessa que o proprio
 * PostgreSQL recusa.
 *
 * Nao devolve nada. Auditoria e efeito colateral obrigatorio, nao insumo de
 * decisao — se um chamador precisasse do id da linha para decidir algo, a
 * decisao estaria no lugar errado.
 */
export interface AuthAuditStore {
  append(scope: TransactionScope, input: AuthAuditAppendInput): Promise<void>;
}

/**
 * CICLO DE VIDA DA CONTA (C7D) — encerramento e anonimizacao.
 *
 * Port SEPARADO de `IdentityStore` de proposito. O comentario do `IdentityStore`
 * declara, desde C7B0, que ele NAO tem `transitionStatus` — "sem CRUD generico e
 * sem operacao administrativa". Enfiar transicao de status la dentro
 * contradiria esse contrato e abriria a porta que ele fechou. Aqui as duas
 * unicas transicoes que existem sao NOMEADAS, cada uma com a sua pre-condicao.
 */
export interface AccountLifecycleStore {
  /**
   * `active -> pending_deletion` (pedido) e `pending_deletion -> active`
   * (arrependimento dentro da janela). O CAS sobre `expectedStatus` impede que
   * duas abas cancelem/pecam ao mesmo tempo e o segundo sobrescreva o primeiro.
   */
  transitionStatus(
    scope: TransactionScope,
    input: AccountStatusTransitionInput,
  ): Promise<AccountStatusTransitionResult>;

  /**
   * `pending_deletion -> deleted`: apaga e-mail, handle e nome da linha de
   * `users` e carimba `deleted_at`. A LINHA NUNCA E REMOVIDA — vira tumba, para
   * que o que a lei manda reter continue referenciavel.
   */
  anonymize(
    scope: TransactionScope,
    input: AccountAnonymizeInput,
  ): Promise<AccountAnonymizeResult>;
}

/**
 * LEITURA DE EXPORTACAO (C7D). Um metodo, so leitura, escopo de UM titular.
 *
 * A projecao (`ExportProjection`) nao TEM campo para credencial, sessao, token,
 * hash de IP ou auditoria — a exclusao e estrutural. `assertExportContainsNoSecrets`
 * (privacy/export.ts) continua rodando por cima como rede de seguranca, mas nao
 * e a unica linha de defesa.
 */
export interface ExportReadStore {
  project(scope: TransactionScope, userId: bigint): Promise<ExportProjectionResult>;
}

// ---------------------------------------------------------------------------
// C8 — BIBLIOTECA PESSOAL
//
// Estes ports servem AO DOMINIO QUE JA EXISTE: `tracking/watch-state.ts`,
// `tracking/episode-progress.ts`, `lists/custom-lists.ts`, `lists/reorder.ts`,
// `ratings/mutation.ts` e `stats/projection.ts` produzem planos ha varias
// unidades e nunca tiveram como ser aplicados. Cada metodo abaixo existe porque
// um desses planos precisa dele — nao ha CRUD generico.
// ---------------------------------------------------------------------------

/**
 * WATCH STATE (C8) — estado explicito do usuario sobre um filme ou uma serie.
 *
 * E a FONTE CANONICA de "quero assistir" (`planned`), "assistindo"
 * (`watching`) e "assistido" (`watched`). As listas de sistema de mesmo nome
 * NAO duplicam esse estado: ver a decisao registrada em
 * docs/product/user-product-library.md.
 *
 * O CHECK do banco limita `entity_type` a ('movie','tv') — temporada e episodio
 * tem progresso proprio, nao watch state.
 */
export interface UserWatchStateStore {
  find(
    scope: TransactionScope,
    input: { readonly userId: bigint; readonly entityType: WatchableEntityType; readonly entityId: bigint },
  ): Promise<WatchStateLookupResult>;

  /**
   * Aplica o snapshot ja decidido por `applyWatchStateChange`. CAS sobre
   * `version`; `expectedVersion = null` insere.
   *
   * Devolve `entity_not_found` quando o par nao existe em `entities`: a FK
   * recusaria a escrita, e deixar a violacao acontecer ABORTARIA a transacao
   * interativa (regra C7B1.1). O adapter sonda antes.
   */
  upsert(scope: TransactionScope, input: WatchStateUpsertInput): Promise<WatchStateUpsertResult>;

  /** Remove o estado (ex.: tirar da watchlist). Idempotente. */
  remove(
    scope: TransactionScope,
    input: { readonly userId: bigint; readonly entityType: WatchableEntityType; readonly entityId: bigint },
  ): Promise<{ readonly removed: boolean }>;

  /** Pagina por status — insumo da watchlist, do tracker e da biblioteca. */
  listByStatus(
    scope: TransactionScope,
    input: {
      readonly userId: bigint;
      readonly statuses: readonly WatchState[];
      readonly entityTypes: readonly WatchableEntityType[];
      readonly limit: number;
      readonly offset: number;
    },
  ): Promise<WatchStatePage>;

  /** Contagens por status, para as estatisticas pessoais (sem trazer linhas). */
  countByStatus(
    scope: TransactionScope,
    userId: bigint,
  ): Promise<ReadonlyArray<{ readonly status: WatchState; readonly entityType: WatchableEntityType; readonly count: number }>>;
}

/**
 * PROGRESSO DE EPISODIO (C8).
 *
 * `markBulk` existe por uma razao de escala medida no catalogo real: marcar
 * "toda a serie" em `Tagesschau` toca ~21 mil episodios. Um metodo por episodio
 * transformaria isso em 21 mil idas ao banco.
 */
export interface EpisodeProgressStore {
  find(
    scope: TransactionScope,
    input: { readonly userId: bigint; readonly episodeId: bigint },
  ): Promise<EpisodeProgressLookupResult>;

  upsert(
    scope: TransactionScope,
    input: EpisodeProgressUpsertInput,
  ): Promise<EpisodeProgressUpsertResult>;

  /** Marca/desmarca um LOTE de episodios. Idempotente e retentavel. */
  markBulk(scope: TransactionScope, input: EpisodeBulkMarkInput): Promise<EpisodeBulkMarkResult>;

  /** Quantos episodios da serie o usuario ja assistiu (COUNT, sem linhas). */
  countWatchedForSeries(
    scope: TransactionScope,
    input: { readonly userId: bigint; readonly episodeIds: readonly bigint[] },
  ): Promise<WatchedEpisodeCount>;

  /** Ids ja assistidos dentro de um conjunto — insumo do "proximo episodio". */
  listWatchedIds(
    scope: TransactionScope,
    input: { readonly userId: bigint; readonly episodeIds: readonly bigint[] },
  ): Promise<readonly bigint[]>;

  /** Total de episodios assistidos pelo usuario (estatisticas). */
  countWatchedTotal(scope: TransactionScope, userId: bigint): Promise<number>;
}

/**
 * DIARIO (C8) — append-only por construcao: nao ha `update` nem `delete`.
 *
 * Desfazer uma acao gera um evento NOVO (`undo`), nunca apaga o anterior; e o
 * que torna o historico auditavel pelo proprio titular.
 */
export interface ViewingEventStore {
  append(
    scope: TransactionScope,
    input: ViewingEventAppendInput,
  ): Promise<ViewingEventAppendResult>;

  /** Historico paginado, mais recente primeiro. */
  list(
    scope: TransactionScope,
    input: {
      readonly userId: bigint;
      readonly eventTypes: readonly ViewingEventType[] | null;
      readonly limit: number;
      readonly offset: number;
    },
  ): Promise<ViewingEventPage>;
}

/**
 * LISTAS (C8). Soft delete: `deleted_at` marca a remocao e o unique
 * `(owner_id, slug)` NAO e parcial — por isso `create` pode colidir com o slug
 * de uma lista ja removida, e quem chama desambigua.
 */
export interface UserListStore {
  create(scope: TransactionScope, input: UserListCreateInput): Promise<UserListCreateResult>;

  /** Busca por id SEM filtrar dono: a autorizacao e do servico, com o dono na mao. */
  findById(scope: TransactionScope, listId: bigint): Promise<UserListLookupResult>;

  listByOwner(
    scope: TransactionScope,
    input: { readonly ownerId: bigint; readonly limit: number; readonly offset: number },
  ): Promise<{ readonly items: readonly UserListRecord[]; readonly total: number }>;

  update(scope: TransactionScope, input: UserListUpdateInput): Promise<UserListLookupResult>;

  /** Soft delete. Listas de sistema nao sao removiveis (o servico barra). */
  softDelete(
    scope: TransactionScope,
    input: { readonly listId: bigint; readonly now: Date },
  ): Promise<{ readonly removed: boolean }>;

  /** Quantas listas CUSTOM vivas o usuario tem (limite antiabuso). */
  countCustomByOwner(scope: TransactionScope, ownerId: bigint): Promise<number>;

  /** Cria as listas de sistema faltantes, idempotentemente. */
  ensureSystemLists(
    scope: TransactionScope,
    input: {
      readonly ownerId: bigint;
      readonly definitions: ReadonlyArray<{
        readonly systemKey: SystemListKey;
        readonly title: string;
        readonly slug: string;
      }>;
    },
  ): Promise<{ readonly created: number }>;

  findSystemList(
    scope: TransactionScope,
    input: { readonly ownerId: bigint; readonly systemKey: SystemListKey },
  ): Promise<UserListLookupResult>;
}

/** ITENS DE LISTA (C8). */
export interface UserListItemStore {
  add(scope: TransactionScope, input: UserListItemAddInput): Promise<UserListItemAddResult>;

  remove(
    scope: TransactionScope,
    input: { readonly listId: bigint; readonly itemId: bigint },
  ): Promise<{ readonly removed: boolean }>;

  list(
    scope: TransactionScope,
    input: { readonly listId: bigint; readonly limit: number; readonly offset: number },
  ): Promise<UserListItemPage>;

  /** Todos os ids na ordem atual — insumo de `planReorder`/`validateFullReorder`. */
  listOrderedIds(scope: TransactionScope, listId: bigint): Promise<readonly bigint[]>;

  count(scope: TransactionScope, listId: bigint): Promise<number>;

  /**
   * Aplica as posicoes planejadas. Transacional: a lista fica contigua 0..n-1
   * ou nao muda. O teto de 1000 itens por lista (LIST_LIMITS) e o que torna a
   * reescrita completa aceitavel — sem ele isto exigiria ordenacao fracionaria.
   */
  applyPositions(
    scope: TransactionScope,
    input: { readonly listId: bigint; readonly positions: readonly ItemPositionInput[]; readonly now: Date },
  ): Promise<{ readonly updated: number }>;
}

/** NOTA PESSOAL (C8). Escala fixa 5; nunca se mistura com nota externa. */
export interface UserRatingStore {
  upsert(scope: TransactionScope, input: UserRatingUpsertInput): Promise<UserRatingUpsertResult>;

  remove(
    scope: TransactionScope,
    input: { readonly userId: bigint; readonly entityType: RatableEntityType; readonly entityId: bigint },
  ): Promise<{ readonly removed: boolean }>;

  find(
    scope: TransactionScope,
    input: { readonly userId: bigint; readonly entityType: RatableEntityType; readonly entityId: bigint },
  ): Promise<{ readonly kind: "found"; readonly rating: UserRatingRecord } | { readonly kind: "not_found" }>;

  listByUser(
    scope: TransactionScope,
    input: { readonly userId: bigint; readonly limit: number; readonly offset: number },
  ): Promise<{ readonly items: readonly UserRatingRecord[]; readonly total: number }>;
}

/** JOB DE IMPORTACAO (C8). */
export interface ImportJobStore {
  create(
    scope: TransactionScope,
    input: ImportJobCreateInput,
  ): Promise<{ readonly kind: "created"; readonly job: ImportJobRecord }>;

  findById(scope: TransactionScope, jobId: bigint): Promise<ImportJobLookupResult>;

  listByUser(
    scope: TransactionScope,
    input: { readonly userId: bigint; readonly limit: number; readonly offset: number },
  ): Promise<{ readonly items: readonly ImportJobRecord[]; readonly total: number }>;

  transition(
    scope: TransactionScope,
    input: ImportJobTransitionInput,
  ): Promise<ImportJobTransitionResult>;
}

/**
 * LEITURA DE CATALOGO (C8) — somente leitura, e so o que a biblioteca consome.
 *
 * Port separado porque o catalogo NAO e dado do usuario: mantê-lo fora dos
 * stores pessoais deixa explicito que nada aqui escreve, e o executor
 * correspondente contem apenas delegacoes de catalogo.
 */
export interface CatalogReadStore {
  /** Existencia na tabela `entities` (alvo das FKs polimorficas). */
  entityExists(scope: TransactionScope, input: EntityRefRecord): Promise<boolean>;

  /** Episodios de uma serie, ORDENADOS por (temporada, episodio). */
  listSeriesEpisodes(
    scope: TransactionScope,
    query: SeriesEpisodeQuery,
  ): Promise<readonly CatalogEpisodeRecord[]>;

  /** Quantos episodios a serie tem sob a mesma politica de especiais. */
  countSeriesEpisodes(
    scope: TransactionScope,
    input: { readonly tvShowId: bigint; readonly includeSpecials: boolean; readonly seasonNumber: number | null },
  ): Promise<number>;

  /** Match por id externo — o unico caminho que produz confianca `exact`. */
  findByExternalId(
    scope: TransactionScope,
    input: {
      readonly entityType: WatchableEntityType;
      readonly tmdbId: number | null;
      readonly imdbId: string | null;
    },
  ): Promise<readonly CatalogMatchCandidate[]>;

  /**
   * Match por titulo normalizado (+ ano opcional). Devolve TODOS os candidatos
   * — quem decide ambiguidade e o dominio, nunca o adapter escolhendo o
   * primeiro.
   */
  findByTitle(
    scope: TransactionScope,
    input: {
      readonly entityType: WatchableEntityType;
      readonly title: string;
      readonly year: number | null;
      readonly limit: number;
    },
  ): Promise<readonly CatalogMatchCandidate[]>;

  /** Minutos de runtime dos filmes indicados (estatisticas de tempo). */
  sumMovieRuntime(
    scope: TransactionScope,
    movieIds: readonly bigint[],
  ): Promise<{ readonly totalMinutes: number; readonly withRuntime: number; readonly withoutRuntime: number }>;

  /** Minutos de runtime dos episodios indicados (estatisticas de tempo). */
  sumEpisodeRuntime(
    scope: TransactionScope,
    episodeIds: readonly bigint[],
  ): Promise<{ readonly totalMinutes: number; readonly withRuntime: number; readonly withoutRuntime: number }>;
}

/**
 * PURGA DE CONTEUDO DE PRODUTO (C8) — encerramento/anonimizacao de conta.
 *
 * `DATA_CLASSIFICATION.product_content` (privacy/policy.ts) prescreve
 * `retentionAction: "delete"`. Ate esta unidade nao existia store algum de
 * conteudo de produto, entao a anonimizacao do C7D tombava a linha de `users` e
 * deixava listas, tracking e notas intactas — a politica existia e nunca era
 * executada. Este port fecha isso.
 *
 * NAO apaga o que a politica manda RETER: consentimento e pedidos LGPD
 * (`retain_indefinitely`, prova legal), auditoria (`retain_until`) e o snapshot
 * agregado de estatisticas (`aggregate_anonymous`).
 */
export interface ProductContentPurgeStore {
  purgeForUser(
    scope: TransactionScope,
    userId: bigint,
  ): Promise<{
    readonly watchStates: number;
    readonly episodeProgress: number;
    readonly viewingEvents: number;
    readonly listItems: number;
    readonly lists: number;
    readonly ratings: number;
    readonly importJobs: number;
  }>;
}
