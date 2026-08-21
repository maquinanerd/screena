/**
 * types.ts — CONTRATOS de persistencia da user platform (Backend C, C7A).
 *
 * SO CONTRATOS. Nenhum PrismaClient, nenhum SQL, nenhum IO, nenhuma
 * implementacao — os adapters concretos sao C7B. Este modulo existe para que a
 * fronteira transacional tenha um vocabulario estavel ANTES de existir adapter.
 *
 * Direcao da dependencia: persistence -> dominio (nunca o contrario). Os
 * dominios puros continuam sem saber que persistencia existe.
 */

import type {
  AuthAuditAction,
  AuthTokenPurpose,
  ConsentKind,
  DataRequestKind,
  DataRequestStatus,
  ImportJobStatus,
  ImportSource,
  ProfileVisibility,
  RatableEntityType,
  SystemListKey,
  ThrottleScope,
  UserListKind,
  UserRole,
  UserStatus,
  ViewingEventType,
  Visibility,
  WatchableEntityType,
  WatchState,
} from "../core/types.js";

/**
 * Escopo transacional OPACO. O adapter (C7B) o liga ao client concreto; este
 * contrato NAO conhece Prisma. O marcador nominal impede passar um objeto
 * qualquer no lugar de um escopo real.
 */
export interface TransactionScope {
  readonly transactional: true;
}

/**
 * Por que a escrita nao pode ser aplicada. Espelha as pre-condicoes que os
 * planos de dominio ja declaram — nao inventa taxonomia nova.
 */
export type PersistenceConflictReason =
  /** O snapshot vigente lido nao e mais o vigente (optimistic concurrency). */
  | "expected_current_mismatch"
  /** Mesma idempotencyKey ja existe com CONTEUDO divergente. */
  | "idempotency_content_mismatch"
  /** A pre-imagem usada no compare-and-swap nao bate mais (ratings/reviews). */
  | "stale_preimage"
  /** Uma constraint UNIQUE barrou a escrita (ex.: dois vigentes concorrentes). */
  | "unique_violation";

/**
 * ALVO SEMANTICO do conflito (C7B0). Existe porque `users` tem TRES uniques de
 * identidade concorrentes (email, email_normalized, handle) e o adapter precisa
 * dizer QUAL falhou — sem jamais expor nome de constraint, indice, tabela ou
 * codigo do driver.
 *
 * E um discriminador ESTRUTURADO acoplado a `unique_violation`, nao uma lista
 * paralela de razoes: assim os contratos ja existentes (recomendacoes) seguem
 * validos sem mudanca — o campo e opcional.
 *
 * Nao e politica de resposta publica: a borda HTTP (unidade futura) decide se
 * reduz essa informacao para evitar enumeracao de contas.
 */
/** Alvos de violacao de UNICIDADE (uniques reais do schema). */
export type UniqueConflictTarget =
  | "identity.email"
  | "identity.emailNormalized"
  | "identity.handle"
  /** Ja existe credencial para o usuario (relacao 1:1 do schema). */
  | "credential.user"
  /** Colisao do hash do token de sessao (unique em `user_sessions`). */
  | "session.tokenHash"
  /**
   * A sessao de origem da rotacao ja foi rotacionada (`rotated_from_id` e unique).
   * Nao e estado impossivel: duplo clique, aba paralela ou retry rotacionam a
   * MESMA sessao duas vezes. Sem este alvo, o caminho mais provavel de contencao
   * real viraria excecao em vez de conflito tipado.
   */
  | "session.rotatedFrom"
  /** Colisao do hash do token de uso unico (unique em `user_verification_tokens`). */
  | "authToken.tokenHash"
  /** C8: (user_id, entity_type, entity_id) ja tem watch state (corrida entre abas). */
  | "watchState.entity"
  /** C8: (user_id, episode_id) ja tem progresso (corrida entre abas). */
  | "episodeProgress.episode"
  /** C8: (owner_id, slug) de lista ja ocupado — inclusive por lista removida. */
  | "userList.slug";

/**
 * Alvos de divergencia de PRE-IMAGEM (compare-and-swap). NAO indica unicidade:
 * o valor comparado no swap nao tem unique — e apenas a pre-imagem lida.
 *
 * `authThrottle.window` entrou em C7C: a contagem de tentativas tambem e trocada
 * por CAS (ler estado -> dominio decide -> gravar SE a linha nao mudou). Sem um
 * alvo proprio, um conflito de throttle seria reportado como conflito de
 * credencial — dois fatos diferentes com o mesmo rotulo.
 */
export type PreimageConflictTarget =
  | "credential.passwordHash"
  | "authThrottle.window"
  /**
   * C7D: o status do pedido LGPD tambem e trocado por CAS (ler status ->
   * dominio decide -> gravar SE nao mudou). Sem alvo proprio, um pedido que
   * outro processador ja concluiu seria reportado com o mesmo rotulo de um
   * conflito de senha.
   */
  | "dataRequest.status"
  /**
   * C7D: o status da CONTA (`users.status`) idem — encerrar e arrepender-se sao
   * transicoes concorrentes reais (duas abas), nao estado impossivel.
   */
  | "identity.status"
  /** C8: `version` do watch state (optimistic locking do tracker). */
  | "watchState.version"
  /** C8: `version` do progresso de episodio. */
  | "episodeProgress.version"
  /** C8: status do job de importacao — trava dois `apply` concorrentes. */
  | "importJob.status";

/** Uniao fechada de todos os alvos (util para documentacao e testes). */
export type PersistenceConflictTarget = UniqueConflictTarget | PreimageConflictTarget;

/**
 * Conflito de persistencia. O `target` e ACOPLADO AO `reason` por construcao:
 * so `unique_violation` aceita alvo de unicidade e so `stale_preimage` aceita
 * alvo de pre-imagem. Assim o typecheck barra pares sem sentido (ex.:
 * `expected_current_mismatch` + `identity.handle`) e `credential.passwordHash`
 * nunca pode sugerir que o hash tem unique.
 *
 * `target` e OPCIONAL: os contratos de recomendacao (C7A) continuam validos sem
 * ele — nenhuma razao foi removida ou renomeada.
 *
 * NAO ha campo de texto livre: um `detail: string` seria um canal por onde um
 * adapter poderia vazar hash ou e-mail em log/erro, e nenhuma varredura de
 * fonte alcanca valor de runtime. O alvo semantico ja carrega o que o chamador
 * precisa; nomes de constraint, SQL, host e banco nunca saem daqui.
 */
export type PersistenceConflict =
  | { readonly reason: "unique_violation"; readonly target?: UniqueConflictTarget }
  | { readonly reason: "stale_preimage"; readonly target?: PreimageConflictTarget }
  | { readonly reason: "expected_current_mismatch" | "idempotency_content_mismatch" };

/**
 * Resultado da EXECUCAO de um plano ja decidido pelo dominio. A persistencia
 * NUNCA decide regra de negocio: ela aplica, nao aplica (noop) ou reporta
 * conflito.
 */
export type PersistenceOutcome<T> =
  | { readonly kind: "applied"; readonly value: T }
  | { readonly kind: "noop"; readonly reason: string }
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

/** Identificador de linha recem-escrita (null quando o plano nao inseriu). */
export interface WrittenRowRef {
  readonly id: bigint | null;
}

// ---------------------------------------------------------------------------
// C7B0 — IDENTIDADE
//
// DTOs derivados dos fluxos REAIS (auth/flows.ts): `decideSignup` precisa saber
// se o e-mail ja existe; `decideLogin` precisa de existencia + status. Nada
// alem disso entra: os campos sao justificados um a um em
// docs/product/user-product-identity-credential-ports.md.
// ---------------------------------------------------------------------------

/**
 * Identidade como a PERSISTENCIA devolve ao dominio. Minimo ESTRITO — cada
 * campo tem consumidor real:
 *  - `id`     -> chave do dono (busca da credencial; futura sessao);
 *  - `status` -> unica coisa que `decideLogin` consulta (elegibilidade).
 *
 * EXCLUIDOS por NAO terem consumidor nestes fluxos: `email` bruto,
 * `emailNormalized` (quem consultou ja o tem; devolve-lo seria PII sem leitor),
 * `handle`, `displayName`, `role`, `emailVerifiedAt`, `createdAt`, `updatedAt`,
 * `deletedAt`, perfil, preferencias, privacidade e estatisticas.
 * NUNCA contem `passwordHash`, `algorithm`, token ou qualquer segredo.
 */
export interface IdentityRecord {
  readonly id: bigint;
  readonly status: UserStatus;
}

/**
 * Entrada de criacao de identidade. Espelha `SignupCommand` (contracts):
 * e-mail bruto + normalizado (a normalizacao e do DOMINIO — o adapter NAO
 * normaliza) e `displayName` opcional.
 *
 * `status`/`role` NAO entram: o schema tem defaults (`active`/`user`) e permitir
 * defini-los aqui criaria uma operacao administrativa que nenhum fluxo pede.
 * `handle` NAO entra: o cadastro nao o define (ver `SignupCommand`).
 */
export interface IdentityCreateInput {
  readonly email: string;
  readonly emailNormalized: string;
  readonly displayName: string | null;
}

export type IdentityCreateResult =
  | { readonly kind: "created"; readonly identity: IdentityRecord }
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

export type IdentityLookupResult =
  | { readonly kind: "found"; readonly identity: IdentityRecord }
  | { readonly kind: "not_found" };

// ---------------------------------------------------------------------------
// C7B0 — CREDENCIAL DE SENHA
//
// O schema mantem UMA credencial por usuario (relacao 1:1, unique em user_id).
// Nenhum historico e inventado aqui. Senha em texto claro NUNCA atravessa estes
// contratos: o dominio (auth/credentials.ts) ja entrega hash + rotulo de
// algoritmo derivado do proprio PHC. O port trata o hash como STRING OPACA:
// nao gera, nao verifica, nao interpreta PHC, nao extrai parametros de scrypt.
// ---------------------------------------------------------------------------

/**
 * Material de verificacao. E o UNICO tipo desta camada autorizado a carregar o
 * hash, devolvido SO por `PasswordCredentialStore.findForVerification`.
 */
export interface CredentialVerificationMaterial {
  /**
   * Hash PHC-like OPACO. Nunca logar, nunca colocar em mensagem de erro.
   *
   * `algorithm` NAO entra aqui: `authenticatePassword` (auth/credentials.ts:58)
   * so recebe `storedHash`, e ate um futuro rehash-on-login le os parametros de
   * DENTRO do proprio PHC. Transportar o rotulo ampliaria a superficie do unico
   * struct que carrega segredo, sem leitor.
   */
  readonly passwordHash: string;
}

/** Criacao da credencial INICIAL (cadastro). Recebe hash, nunca senha. */
export interface CredentialCreateInput {
  readonly userId: bigint;
  readonly passwordHash: string;
  readonly algorithm: string;
}

/**
 * Troca de senha por COMPARE-AND-SWAP. `user_password_credentials` NAO tem
 * coluna `version` (registrado em C7A), entao a pre-imagem e o proprio hash
 * atual — aquele que o chamador acabou de ler e verificar.
 */
export interface CredentialReplaceInput {
  readonly userId: bigint;
  /** Hash que o chamador leu; se nao for mais o vigente => conflict. */
  readonly expectedPasswordHash: string;
  readonly nextPasswordHash: string;
  readonly nextAlgorithm: string;
}

export type CredentialCreateResult =
  | { readonly kind: "created" }
  /** Ja existe credencial para o usuario (1:1). */
  | { readonly kind: "already_exists"; readonly conflict: PersistenceConflict }
  /** FK: o usuario nao existe (nao pode ocorrer dentro da transacao de cadastro). */
  | { readonly kind: "user_not_found" };

export type CredentialVerificationLookupResult =
  | { readonly kind: "found"; readonly material: CredentialVerificationMaterial }
  | { readonly kind: "not_found" };

export type CredentialReplaceResult =
  | { readonly kind: "updated" }
  /** Nao ha credencial para o usuario. */
  | { readonly kind: "not_found" }
  /** A pre-imagem nao corresponde mais (`stale_preimage`) — nunca sobrescrever. */
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

// ---------------------------------------------------------------------------
// C7B2 — SESSOES
//
// A struct persistivel ja existe no dominio: `SessionRecord` (auth/types.ts),
// produzida por `buildSessionCreation`/`buildSessionRotation` com SO hashes. A
// persistencia nao a redefine — recebe-a como esta.
// ---------------------------------------------------------------------------

/**
 * Sessao como a PERSISTENCIA devolve. Minimo ESTRITO, cada campo com consumidor:
 *  - `id`         -> `planLogout`/`planRevokeAll` revogam POR ID;
 *  - `userId`     -> buscar o status da conta (`accountCanHoldSession`);
 *  - `expiresAt`  -> `evaluateSessionAccess` compara com `now`;
 *  - `revokedAt`  -> `evaluateSessionAccess` distingue revogada de expirada.
 *
 * NAO carrega `tokenHash`: quem consultou ja o tem (a busca e POR ele), e
 * devolve-lo ampliaria a superficie do segredo sem leitor. Tambem nao carrega
 * `ipHash`, `userAgent`, `lastUsedAt`, `revokedReason` nem `rotatedFromId` —
 * nenhuma funcao pura os consome.
 *
 * `csrfTokenHash` ENTROU EM C7D, e a razao e que o argumento acima nao vale
 * para ele. Quem busca a sessao apresenta o token de SESSAO (cookie
 * `HttpOnly`); o token CSRF e outro segredo, apresentado em outro canal
 * (cabecalho `X-CSRF-Token`), e o chamador NAO tem como derivar um do outro.
 * Sem este campo, `requireCsrf` (core/request-guards.ts) — que existe desde a
 * missao §13 e nunca teve consumidor — permaneceria impossivel de chamar, e
 * toda mutacao autenticada ficaria sem double submit.
 *
 * Devolver o HASH (nunca o token cru) mantem a propriedade que importa: o valor
 * cru continua existindo so no cookie do cliente, e a comparacao e
 * `sha256(apresentado) == hash`, em tempo constante.
 */
export interface SessionAccessRecord {
  readonly id: bigint;
  readonly userId: bigint;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly csrfTokenHash: string;
}

export type SessionCreateResult =
  | { readonly kind: "created"; readonly sessionId: bigint }
  /** `token_hash` ja existe (colisao de token, praticamente impossivel). */
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

export type SessionLookupResult =
  | { readonly kind: "found"; readonly session: SessionAccessRecord }
  | { readonly kind: "not_found" };

/**
 * Revogacao em LOTE porque os tres planos do dominio (`planLogout`,
 * `planRevokeAll`, `planRevokeAllAfterSensitiveEvent`) produzem exatamente a
 * mesma forma: `revokeSessionIds: readonly bigint[]`. Um metodo por plano seria
 * tres nomes para uma operacao so.
 *
 * `now` entra por PARAMETRO — o adapter nunca le o relogio. Idempotente: ja
 * revogada nao e erro (o dominio declara isso em `planLogout`), entao o
 * resultado conta quantas mudaram, sem distinguir "nao existia" de "ja estava".
 */
export interface SessionRevokeInput {
  readonly sessionIds: readonly bigint[];
  readonly now: Date;
}

export interface SessionRevokeResult {
  /** Quantas sessoes SAIRAM de ativa nesta chamada. */
  readonly revokedCount: number;
}

/**
 * Entrada da listagem de sessoes ativas. `now` e explicito de proposito: o
 * criterio de vigencia (`expiresAt > now`) e temporal, e a regra do dominio e
 * que tempo entra por parametro. Deixar o adapter chamar o relogio quebraria a
 * determinismo dos testes e criaria uma segunda fonte de "agora".
 */
export interface SessionListActiveInput {
  readonly userId: bigint;
  readonly now: Date;
}

// ---------------------------------------------------------------------------
// C7B2 — TOKENS DE USO UNICO (verificacao de e-mail e recuperacao de senha)
//
// UMA tabela, UM contrato, discriminados por `purpose`: e o que o schema define
// (`user_verification_tokens` com o enum fechado `AuthTokenPurpose`) e o que o
// dominio produz (`VerificationTokenRecord`, identica para os dois fluxos, so
// mudando `purpose`). Dois stores sobre a mesma tabela seriam duplicacao
// artificial; um store generico "de qualquer coisa" seria abstracao vazia.
// ---------------------------------------------------------------------------

export type AuthTokenIssueResult =
  | { readonly kind: "issued"; readonly tokenId: bigint }
  /** `token_hash` ja existe. */
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

/**
 * Consumo de uso unico. Recebe o HASH (o token cru nunca chega aqui), o
 * proposito esperado e o `now` da decisao.
 *
 * O `purpose` e parte da PRE-CONDICAO, nao um filtro posterior: um token de
 * verificacao nunca pode redefinir senha, e vice-versa.
 */
export interface AuthTokenConsumeInput {
  readonly tokenHash: string;
  readonly purpose: AuthTokenPurpose;
  readonly now: Date;
}

/**
 * Resultado do consumo. Os motivos espelham `TokenConsumptionReason`
 * (auth/tokens.ts) porque sao os mesmos estados que o dominio ja sabe nomear —
 * nao ha taxonomia nova.
 *
 * `userId` sai junto do consumo porque `applyEmailVerification` e
 * `applyPasswordReset` precisam saber DE QUEM era o token, e essa e a unica
 * leitura que amarra o token ao usuario dentro do mesmo passo atomico. Buscar o
 * usuario depois, por fora, abriria janela entre consumir e aplicar.
 *
 * A borda publica NUNCA diferencia estes motivos (anti-enumeracao): o dominio ja
 * colapsa todos em `GENERIC_TOKEN_FAILURE_MESSAGE`.
 */
export type AuthTokenConsumeResult =
  | { readonly kind: "consumed"; readonly userId: bigint }
  | { readonly kind: "not_found" }
  | { readonly kind: "wrong_purpose" }
  | { readonly kind: "expired" }
  | { readonly kind: "already_consumed" };

/**
 * Invalidacao em lote dos tokens PENDENTES de um proposito.
 *
 * Consumidor real: `applyPasswordReset` devolve
 * `invalidateAllPendingResetTokens: true` — depois de trocar a senha, nenhum
 * outro link de reset pode continuar valendo. Marcar `consumedAt` e a forma de
 * "queimar" sem apagar historico.
 */
export interface AuthTokenInvalidatePendingInput {
  readonly userId: bigint;
  readonly purpose: AuthTokenPurpose;
  readonly now: Date;
}

export interface AuthTokenInvalidatePendingResult {
  readonly invalidatedCount: number;
}

// ---------------------------------------------------------------------------
// C7B2.1 — FECHAMENTO DA IDENTIDADE PARA AUTENTICACAO
//
// O C7B2 registrou um PORT_GAP: `SessionAccessRecord` devolve `userId` para que
// alguem busque o status da conta, e `AuthTokenStore.consume` devolve `userId`
// para que alguem marque o e-mail — mas nenhum metodo publicado fazia nem uma
// coisa nem outra. Sem isso, validar sessao e verificar e-mail nao fechavam.
// ---------------------------------------------------------------------------

/**
 * Resultado da marcacao de e-mail verificado.
 *
 * A taxonomia NAO foi inventada aqui: espelha `EmailVerificationApplication`
 * (auth/verification.ts), onde `changed=true` e a primeira verificacao e
 * `changed=false` significa "ja estava verificada, carimbo PRESERVADO".
 * `verified`/`already_verified` sao esses dois casos; `not_found` existe porque
 * o `userId` vem de um token consumido e a conta pode ter sido removida.
 *
 * Nao devolve o carimbo: quem chamou forneceu o `now` e, no caso idempotente, o
 * valor preservado e o que ja estava la — nenhum consumidor atual o le.
 */
export type EmailVerificationResult =
  | { readonly kind: "verified" }
  /** Ja estava verificada; o carimbo ORIGINAL permanece intacto. */
  | { readonly kind: "already_verified" }
  | { readonly kind: "not_found" };

/**
 * Entrada da marcacao. `now` e explicito porque toda a camada trata tempo como
 * parametro — o adapter nunca le o relogio.
 */
export interface EmailVerificationInput {
  readonly userId: bigint;
  readonly now: Date;
}

// ---------------------------------------------------------------------------
// C7B2.2 — ESTADO DE VERIFICACAO DE E-MAIL (leitura para o reenvio)
// ---------------------------------------------------------------------------

/**
 * Estado MINIMO que o reenvio de verificacao precisa ler.
 *
 * Devolve o FATO persistido (`emailVerifiedAt: Date | null`), nao a decisao:
 * `alreadyVerified` e politica, derivada pelo consumidor
 * (`emailVerifiedAt !== null`). Trocar o carimbo por um booleano aqui faria o
 * adapter decidir no lugar do dominio e jogaria fora a informacao de QUANDO —
 * que `markEmailVerified` preserva justamente para nao ser perdida.
 *
 * `userId` acompanha porque o passo seguinte do fluxo
 * (`buildEmailVerificationIssue`) precisa dele para emitir o token.
 *
 * Carrega `status` desde a decisao de elegibilidade: `evaluateVerificationResend`
 * passou a aplicar `accountCanHoldSession(status)` — o MESMO predicado do reset,
 * para nao existir uma segunda matriz de status divergente. O campo tem
 * consumidor real, entao entra; ate essa decisao ele nao existia, e nao existir
 * era o correto.
 */
export interface EmailVerificationState {
  readonly userId: bigint;
  readonly emailVerifiedAt: Date | null;
  readonly status: UserStatus;
}

export type EmailVerificationStateLookupResult =
  | { readonly kind: "found"; readonly state: EmailVerificationState }
  | { readonly kind: "not_found" };

// ---------------------------------------------------------------------------
// C7C — THROTTLE DURAVEL DE AUTENTICACAO
//
// O model `AuthThrottle` (`user_auth_throttles`) ja existia no schema desde
// 20260717150000, com `@@unique([scope, key])`, e a POLITICA pura ja existia em
// `auth/policy.ts` (`evaluateThrottle`, `registerFailure`). Faltava so o
// contrato entre as duas — e sem ele os endpoints publicos de C7C ficariam sem
// limite duravel, ou dependeriam de um `Map` em memoria que nao sobrevive a um
// restart nem vale entre replicas.
//
// NAO ha migration nesta unidade: nenhuma coluna foi criada, renomeada ou
// removida.
// ---------------------------------------------------------------------------

/**
 * Estado de contagem de UMA chave de throttle, exatamente como as colunas o
 * guardam. Espelha `ThrottleState` (auth/policy.ts) MENOS `previousLockouts`,
 * que nao tem coluna: o lockout progressivo entre janelas nao e persistivel
 * hoje, e inventar uma coluna aqui exigiria migration fora de escopo. O efeito
 * pratico esta documentado em docs/product/user-product-auth-runtime.md.
 */
export interface AuthThrottleState {
  readonly failureCount: number;
  readonly windowStartedAt: Date;
  readonly lockedUntil: Date | null;
}

/**
 * Chave natural da contagem. `key` NUNCA carrega IP em texto claro: para o
 * escopo `ip` o valor e um hash, como a propria coluna documenta no schema.
 */
export interface AuthThrottleKey {
  readonly scope: ThrottleScope;
  readonly key: string;
}

/**
 * Escrita por COMPARE-AND-SWAP.
 *
 * `expected = null` significa "a leitura nao encontrou linha" e vira insercao
 * nao-abortiva; `expected != null` vira update com a pre-imagem no WHERE. Sem a
 * pre-imagem, dois pedidos concorrentes leriam a mesma contagem e o segundo
 * sobrescreveria o primeiro — o limite seria silenciosamente maior do que a
 * politica declara.
 */
export interface AuthThrottleSaveInput {
  readonly scope: ThrottleScope;
  readonly key: string;
  readonly expected: AuthThrottleState | null;
  readonly next: AuthThrottleState;
}

export type AuthThrottleReadResult =
  | { readonly kind: "found"; readonly state: AuthThrottleState }
  | { readonly kind: "not_found" };

export type AuthThrottleSaveResult =
  | { readonly kind: "saved" }
  /** A linha mudou entre a leitura e a escrita: outro pedido ja contou. */
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

// ---------------------------------------------------------------------------
// C7D — PERFIL, CONSENTIMENTO, PEDIDOS LGPD E AUDITORIA
//
// Os quatro models (`user_profiles`, `user_consent_records`,
// `user_data_requests`, `user_auth_audit_logs`) existem no schema desde
// 20260717150000 e NENHUM tinha contrato de persistencia: uma busca por
// `ConsentStore|DataRequestStore|ProfileStore|AuthAuditLog` no repositorio
// inteiro nao retornava uma linha. O dominio puro correspondente
// (`privacy/consent.ts`, `privacy/export.ts`, `privacy/deletion.ts`,
// `privacy/preferences.ts`) tambem ja existia e tambem nao tinha consumidor.
// Esta unidade liga as duas pontas.
//
// NAO ha migration: nenhuma coluna e criada, renomeada ou removida.
// ---------------------------------------------------------------------------

/**
 * Perfil como a persistencia o devolve. Espelha `user_profiles` MAIS os dois
 * campos de nome publico que moram em `users` (`display_name`, `handle`).
 *
 * Os dois vem juntos DE PROPOSITO: a tela de perfil edita "quem eu sou
 * publicamente" como uma coisa so, e o schema por acaso a espalhou em duas
 * tabelas. Um port por tabela obrigaria a borda a orquestrar duas escritas e a
 * decidir sozinha o que fazer quando a segunda falhasse — decisao que nao
 * pertence a borda. O adapter faz as duas dentro da MESMA transacao.
 *
 * NUNCA carrega `email`: e-mail e identidade (IdentityStore), nao perfil, e
 * devolve-lo aqui espalharia PII por um caminho que nao a consome.
 */
export interface ProfileRecord {
  readonly displayName: string | null;
  readonly handle: string | null;
  readonly bio: string | null;
  readonly avatarPath: string | null;
  readonly locale: string;
  readonly countryCode: string | null;
  readonly timezone: string | null;
  readonly visibility: ProfileVisibility;
  /** Preferencias de apresentacao. Vocabulario fechado (ver account-commands). */
  readonly density: string;
  readonly posterSize: string;
}

/**
 * Escrita do perfil. TODOS os campos sao obrigatorios na entrada (nenhum
 * `?`): um `undefined` que significasse "nao mexe" tornaria impossivel, no
 * proprio tipo, distinguir "limpar a bio" de "nao tocar na bio". Quem chama ja
 * leu o registro atual e envia o estado COMPLETO desejado.
 */
export interface ProfileUpsertInput {
  readonly userId: bigint;
  readonly displayName: string | null;
  readonly handle: string | null;
  readonly bio: string | null;
  readonly avatarPath: string | null;
  readonly locale: string;
  readonly countryCode: string | null;
  readonly timezone: string | null;
  readonly visibility: ProfileVisibility;
  /** Preferencias de apresentacao. Vocabulario fechado (ver account-commands). */
  readonly density: string;
  readonly posterSize: string;
}

export type ProfileLookupResult =
  | { readonly kind: "found"; readonly profile: ProfileRecord }
  /** Conta existe mas ainda nao tem linha em `user_profiles`. */
  | { readonly kind: "not_found" };

export type ProfileUpsertResult =
  | { readonly kind: "saved"; readonly profile: ProfileRecord }
  /** `handle` ja pertence a outra conta (unique em `users.handle`). */
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

/**
 * Registro de consentimento ja gravado. Espelha EXATAMENTE
 * `StoredConsentRecord` (privacy/consent.ts) — o dominio e quem decide qual e o
 * vigente (`currentConsent`), entao o adapter nao ordena, nao filtra e nao
 * deduplica: devolve as linhas como estao.
 *
 * Deliberadamente NAO ha `update` nem `delete`: consentimento e APPEND-ONLY
 * (invariante LGPD de prova). Revogar e inserir `granted=false`.
 */
export interface ConsentRecordRow {
  readonly kind: ConsentKind;
  readonly granted: boolean;
  readonly policyVersion: string;
  readonly occurredAt: Date;
}

/** Entrada de gravacao; espelha `ConsentRecordPlan` (privacy/consent.ts). */
export interface ConsentAppendInput {
  readonly userId: bigint;
  readonly kind: ConsentKind;
  readonly granted: boolean;
  readonly policyVersion: string;
  readonly occurredAt: Date;
}

/** Pedido LGPD como a persistencia o devolve. */
export interface DataRequestRecord {
  readonly id: bigint;
  readonly kind: DataRequestKind;
  readonly status: DataRequestStatus;
  readonly requestedAt: Date;
  readonly processedAt: Date | null;
}

export interface DataRequestCreateInput {
  readonly userId: bigint;
  readonly kind: DataRequestKind;
  readonly status: DataRequestStatus;
  readonly requestedAt: Date;
}

export type DataRequestCreateResult =
  | { readonly kind: "created"; readonly request: DataRequestRecord }
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

export type DataRequestLookupResult =
  | { readonly kind: "found"; readonly request: DataRequestRecord }
  | { readonly kind: "not_found" };

/**
 * Transicao de estado de um pedido, por COMPARE-AND-SWAP sobre o status
 * esperado. Sem a pre-imagem, dois processadores concorrentes marcariam o mesmo
 * pedido como concluido duas vezes — e o segundo sobrescreveria o carimbo do
 * primeiro.
 *
 * `processedBy` e identidade HUMANA (o schema o documenta): nunca "agent",
 * nunca "system". Quando a conclusao e automatica o campo fica `null`.
 */
export interface DataRequestTransitionInput {
  readonly id: bigint;
  readonly expectedStatus: DataRequestStatus;
  readonly nextStatus: DataRequestStatus;
  readonly processedAt: Date | null;
  readonly processedBy: string | null;
}

export type DataRequestTransitionResult =
  | { readonly kind: "updated" }
  | { readonly kind: "not_found" }
  /** O status mudou entre a leitura e a escrita. */
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

/**
 * Entrada de auditoria de autenticacao (`user_auth_audit_logs`).
 *
 * A tabela e APPEND-ONLY por trigger no banco (UPDATE e proibido), entao o port
 * tem UM metodo e so: `append`. Nao ha `update`, `delete` nem varredura
 * administrativa.
 *
 * `ipHash` ja chega HASHEADO — o mesmo contrato do resto da autenticacao: IP
 * cru nunca atravessa esta camada. `detail` e um objeto de chaves controladas
 * pelo chamador; senha, token e hash de token NUNCA entram (a guarda de fonte
 * em `__tests__/boundary.test.ts` e o revisor humano cobrem isso).
 */
export interface AuthAuditAppendInput {
  readonly userId: bigint | null;
  readonly sessionId: bigint | null;
  readonly action: AuthAuditAction;
  readonly ipHash: string | null;
  readonly userAgent: string | null;
  readonly detail: Readonly<Record<string, string | number | boolean | null>> | null;
  readonly occurredAt: Date;
}

/**
 * Transicao de status da conta (`users.status`), por COMPARE-AND-SWAP.
 *
 * `deletedAt` acompanha a transicao porque o schema tem um CHECK que amarra os
 * dois: `deleted`/`pending_deletion` sao coerentes com `deleted_at`. Deixar o
 * carimbo para uma segunda escrita deixaria a linha temporariamente violando o
 * proprio CHECK — o banco recusaria.
 */
export interface AccountStatusTransitionInput {
  readonly userId: bigint;
  readonly expectedStatus: UserStatus;
  readonly nextStatus: UserStatus;
  readonly deletedAt: Date | null;
}

export type AccountStatusTransitionResult =
  | { readonly kind: "updated" }
  | { readonly kind: "not_found" }
  /** O status mudou entre a leitura e a escrita (ex.: duas abas pedindo). */
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

/**
 * Anonimizacao definitiva (LGPD art. 18, VI). A linha de `users` NUNCA some —
 * vira TUMBA: perde e-mail, handle e nome, mantem `id` para integridade
 * referencial do que a lei/contrato exige reter.
 *
 * Os valores anonimos chegam PRONTOS do dominio (`buildDeletionPlan`), nao sao
 * inventados pelo adapter: o dominio e quem sabe qual placeholder preserva a
 * unicidade das colunas `email`/`email_normalized`/`handle`.
 */
export interface AccountAnonymizeInput {
  readonly userId: bigint;
  readonly anonymizedEmail: string;
  readonly anonymizedEmailNormalized: string;
  readonly anonymizedAt: Date;
}

export type AccountAnonymizeResult =
  | { readonly kind: "anonymized" }
  | { readonly kind: "not_found" }
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

/**
 * Projecao de EXPORTACAO de UM titular.
 *
 * As chaves espelham as categorias EXPORTAVEIS de `DATA_CLASSIFICATION`
 * (privacy/policy.ts) e nada alem: `account_core`, `profile`,
 * `product_content`, `product_stats`, `governance_consents`,
 * `governance_requests`. Credencial, sessao, token, hash de IP e auditoria NAO
 * tem campo aqui — a ausencia e estrutural, nao uma checagem que alguem possa
 * esquecer de rodar.
 *
 * Os tipos sao deliberadamente frouxos (`unknown[]`) para o conteudo de
 * produto: esta unidade nao modela listas, tracking, ratings nem reviews (sao
 * dos Prompts 08+); ela apenas os transporta como linhas ja serializadas pelo
 * adapter, para que o export nao mude quando aquelas features chegarem.
 */
export interface ExportProjection {
  readonly accountCore: {
    readonly email: string;
    readonly status: UserStatus;
    readonly emailVerifiedAt: Date | null;
    readonly createdAt: Date;
  };
  readonly profile: ProfileRecord | null;
  readonly productContent: Readonly<Record<string, readonly unknown[]>>;
  readonly productStats: unknown | null;
  readonly governanceConsents: readonly ConsentRecordRow[];
  readonly governanceRequests: readonly DataRequestRecord[];
  /**
   * C8 — METADADO dos pedidos de importacao (nunca o arquivo enviado nem o
   * preview: sao Json de trabalho, e o titular ja tem o arquivo original).
   */
  readonly governanceImports: readonly unknown[];
}

export type ExportProjectionResult =
  | { readonly kind: "found"; readonly projection: ExportProjection }
  | { readonly kind: "not_found" };

/**
 * Usuario autenticado como a PERSISTENCIA o devolve (C7D).
 *
 * Mais largo que `IdentityRecord` de proposito: aquele existe para DECIDIR
 * (`decideLogin` so consulta `status`) e por isso e minimo; este existe para
 * MONTAR a resposta do proprio dono, e por isso carrega o que
 * `toCurrentUserDto` seleciona.
 *
 * A forma coincide com `AuthenticatedUserInternal` (contracts/auth-internal.ts)
 * e a duplicacao e deliberada: a persistencia nao importa `contracts/`. O
 * mapeamento campo a campo acontece em `auth-runtime/identity-read.ts`, onde
 * acrescentar uma coluna aqui NAO a publica sozinha do outro lado.
 *
 * Carrega PII (`email`, `emailNormalized`) porque a tela de conta a exibe ao
 * proprio titular. `toCurrentUserDto` e quem faz o whitelist para o DTO publico
 * — e ele NAO inclui e-mail.
 */
export interface AuthenticatedUserRecord {
  readonly id: bigint;
  readonly handle: string | null;
  readonly displayName: string | null;
  readonly email: string;
  readonly emailNormalized: string;
  readonly emailVerifiedAt: Date | null;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly locale: string;
  readonly profileVisibility: ProfileVisibility;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

export type AuthenticatedUserLookupResult =
  | { readonly kind: "found"; readonly user: AuthenticatedUserRecord }
  | { readonly kind: "not_found" };

// ---------------------------------------------------------------------------
// C8 — BIBLIOTECA PESSOAL: watch state, progresso, diario, listas, notas,
// importacao e leitura de catalogo.
//
// Todos os models (`user_watch_states`, `user_episode_progress`,
// `user_viewing_events`, `user_lists`, `user_list_items`, `user_ratings`,
// `user_import_jobs`) existem desde 20260717150000 e NENHUM tinha contrato de
// persistencia: o dominio puro (lists/*, tracking/*, ratings/*, stats/*) estava
// completo e sem um unico consumidor de producao. Esta unidade liga as pontas.
//
// NAO ha migration: nenhuma coluna e criada, renomeada ou removida.
// ---------------------------------------------------------------------------

/**
 * Referencia canonica a uma entidade do catalogo.
 *
 * O par `(entityType, entityId)` e a chave composta da tabela `entities`, alvo
 * das FKs de `user_watch_states` e `user_list_items`. NUNCA se usa slug: slug
 * muda (traducao, recanonizacao) e a biblioteca do usuario precisa sobreviver a
 * isso — a FK e por id.
 */
export interface EntityRefRecord {
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
}

/** Estado de acompanhamento como a persistencia o devolve. */
export interface WatchStateRecord {
  readonly entityType: WatchableEntityType;
  readonly entityId: bigint;
  readonly status: WatchState;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly lastActivityAt: Date;
  readonly rewatchCount: number;
  readonly visibility: Visibility;
  readonly version: number;
  readonly updatedAt: Date;
}

/**
 * Escrita do watch state por COMPARE-AND-SWAP sobre a versao.
 *
 * `expectedVersion = null` significa "linha ainda nao existe" e vira insercao
 * nao-abortiva. Nao-null vira update com `version` no WHERE: duas abas mudando
 * o mesmo titulo nao se sobrescrevem em silencio — a perdedora recebe
 * `conflict` e o cliente relê.
 */
export interface WatchStateUpsertInput {
  readonly userId: bigint;
  readonly entityType: WatchableEntityType;
  readonly entityId: bigint;
  readonly expectedVersion: number | null;
  readonly status: WatchState;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly rewatchCount: number;
  readonly nextVersion: number;
  readonly now: Date;
}

export type WatchStateLookupResult =
  | { readonly kind: "found"; readonly state: WatchStateRecord }
  | { readonly kind: "not_found" };

export type WatchStateUpsertResult =
  | { readonly kind: "saved"; readonly state: WatchStateRecord }
  /** A entidade nao existe em `entities` — a FK recusaria a escrita. */
  | { readonly kind: "entity_not_found" }
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

/** Pagina de watch states, para a biblioteca e o tracker. */
export interface WatchStatePage {
  readonly items: readonly WatchStateRecord[];
  readonly total: number;
}

/** Progresso de UM episodio como a persistencia o devolve. */
export interface EpisodeProgressRecord {
  readonly episodeId: bigint;
  readonly watched: boolean;
  readonly watchedAt: Date | null;
  readonly progressSeconds: number | null;
  readonly durationSeconds: number | null;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface EpisodeProgressUpsertInput {
  readonly userId: bigint;
  readonly episodeId: bigint;
  readonly expectedVersion: number | null;
  readonly watched: boolean;
  readonly watchedAt: Date | null;
  readonly progressSeconds: number | null;
  readonly durationSeconds: number | null;
  readonly nextVersion: number;
  readonly now: Date;
}

export type EpisodeProgressLookupResult =
  | { readonly kind: "found"; readonly progress: EpisodeProgressRecord }
  | { readonly kind: "not_found" };

export type EpisodeProgressUpsertResult =
  | { readonly kind: "saved"; readonly progress: EpisodeProgressRecord }
  /** O episodio nao existe no catalogo — a FK real recusaria a escrita. */
  | { readonly kind: "episode_not_found" }
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

/**
 * Marcacao EM LOTE de episodios (temporada inteira, serie inteira).
 *
 * Existe porque a alternativa — uma escrita por episodio — e inviavel no
 * catalogo real: `Tagesschau` tem ~21 mil episodios, e 21 mil round-trips
 * (ou 21 mil requisicoes do navegador) nao e uma implementacao, e um incidente.
 * O adapter processa em CHUNKS e cada chunk e idempotente, entao uma falha no
 * meio pode ser retentada sem duplicar nada.
 */
export interface EpisodeBulkMarkInput {
  readonly userId: bigint;
  readonly episodeIds: readonly bigint[];
  readonly watched: boolean;
  readonly watchedAt: Date | null;
  readonly now: Date;
}

export interface EpisodeBulkMarkResult {
  /** Linhas que passaram a existir (nao havia progresso antes). */
  readonly created: number;
  /** Linhas que mudaram de estado (idempotente: ja no alvo nao conta). */
  readonly updated: number;
}

/** Contagem de assistidos de uma serie, sem trazer as linhas. */
export interface WatchedEpisodeCount {
  readonly watched: number;
}

/** Evento de diario ja pronto para persistir (append-only). */
export interface ViewingEventAppendInput {
  readonly userId: bigint;
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
  readonly eventType: ViewingEventType;
  readonly occurredAt: Date;
  /** `app` ou `import:<source>`; a coluna exige texto nao vazio. */
  readonly source: string;
  readonly idempotencyKey: string;
}

/**
 * Resultado do append. `duplicate` NAO e erro: o unique
 * `(user_id, idempotency_key, event_type)` e o que torna o replay seguro — a
 * mesma operacao reenviada nao cria um segundo evento.
 */
export type ViewingEventAppendResult =
  | { readonly kind: "appended"; readonly eventId: bigint }
  | { readonly kind: "duplicate" };

/** Linha de diario devolvida ao usuario. */
export interface ViewingEventRecord {
  readonly id: bigint;
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
  readonly eventType: ViewingEventType;
  readonly occurredAt: Date;
  readonly source: string;
}

export interface ViewingEventPage {
  readonly items: readonly ViewingEventRecord[];
  readonly total: number;
}

/** Lista (system ou custom) como a persistencia a devolve. */
export interface UserListRecord {
  readonly id: bigint;
  readonly ownerId: bigint;
  readonly kind: UserListKind;
  readonly systemKey: SystemListKey | null;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  readonly visibility: Visibility;
  readonly ordered: boolean;
  readonly itemCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UserListCreateInput {
  readonly ownerId: bigint;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  readonly visibility: Visibility;
  readonly ordered: boolean;
}

export interface UserListUpdateInput {
  readonly listId: bigint;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  readonly visibility: Visibility;
  readonly ordered: boolean;
  readonly now: Date;
}

export type UserListLookupResult =
  | { readonly kind: "found"; readonly list: UserListRecord }
  | { readonly kind: "not_found" };

export type UserListCreateResult =
  | { readonly kind: "created"; readonly list: UserListRecord }
  /**
   * `(owner_id, slug)` ja ocupado. O unique NAO e parcial em `deleted_at`, entao
   * uma lista removida continua ocupando o slug — quem chama precisa desambiguar
   * (sufixo), nao reciclar cegamente.
   */
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

/** Item de lista como a persistencia o devolve. */
export interface UserListItemRecord {
  readonly id: bigint;
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
  readonly position: number | null;
  readonly note: string | null;
  readonly addedAt: Date;
}

export interface UserListItemAddInput {
  readonly listId: bigint;
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
  readonly position: number | null;
  readonly note: string | null;
  readonly now: Date;
}

export type UserListItemAddResult =
  | { readonly kind: "added"; readonly item: UserListItemRecord }
  /** Ja existe (unique `list_id, entity_type, entity_id`) — idempotente. */
  | { readonly kind: "already_present" }
  | { readonly kind: "entity_not_found" };

export interface UserListItemPage {
  readonly items: readonly UserListItemRecord[];
  readonly total: number;
}

/** Nova posicao de UM item; o plano vem de `lists/reorder.ts`. */
export interface ItemPositionInput {
  readonly itemId: bigint;
  readonly position: number;
}

/** Nota pessoal como a persistencia a devolve. Escala FIXA 5 (CHECK do banco). */
export interface UserRatingRecord {
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
  /** Decimal(2,1) do banco convertido para number — 0.5..5.0 em passo 0.5. */
  readonly value: number;
  readonly scale: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UserRatingUpsertInput {
  readonly userId: bigint;
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
  readonly value: number;
  readonly now: Date;
}

export type UserRatingUpsertResult =
  | { readonly kind: "saved"; readonly rating: UserRatingRecord }
  | { readonly kind: "entity_not_found" };

/** Pedido de importacao como a persistencia o devolve. */
export interface ImportJobRecord {
  readonly id: bigint;
  readonly userId: bigint;
  readonly source: ImportSource;
  readonly status: ImportJobStatus;
  readonly fileName: string | null;
  readonly itemCount: number;
  readonly conflictCount: number;
  readonly appliedCount: number;
  readonly error: string | null;
  readonly appliedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ImportJobCreateInput {
  readonly userId: bigint;
  readonly source: ImportSource;
  readonly status: ImportJobStatus;
  readonly fileName: string | null;
}

/**
 * Transicao de estado do job por COMPARE-AND-SWAP sobre o status esperado.
 *
 * E o que impede dois `apply` concorrentes do MESMO job: o segundo encontra o
 * status ja mudado e recebe `conflict`. Sem isso a idempotencia dependeria so
 * dos uniques das tabelas de destino — que protegem o dado, mas nao evitariam o
 * trabalho duplicado nem a contagem inflada.
 */
export interface ImportJobTransitionInput {
  readonly id: bigint;
  readonly expectedStatus: ImportJobStatus;
  readonly nextStatus: ImportJobStatus;
  readonly itemCount?: number;
  readonly conflictCount?: number;
  readonly appliedCount?: number;
  readonly error?: string | null;
  readonly appliedAt?: Date | null;
  /** Preview/conflitos serializados; `undefined` preserva o valor atual. */
  readonly preview?: unknown;
  readonly conflicts?: unknown;
  readonly now: Date;
}

export type ImportJobTransitionResult =
  | { readonly kind: "updated" }
  | { readonly kind: "not_found" }
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

export type ImportJobLookupResult =
  | {
      readonly kind: "found";
      readonly job: ImportJobRecord;
      /** Json bruto do preview; o dominio o valida antes de usar. */
      readonly preview: unknown;
      readonly conflicts: unknown;
    }
  | { readonly kind: "not_found" };

// ---------------------------------------------------------------------------
// Leitura de CATALOGO para a biblioteca (somente leitura)
// ---------------------------------------------------------------------------

/** Episodio como o tracker o enxerga: identidade + ordenacao + duracao. */
export interface CatalogEpisodeRecord {
  readonly episodeId: bigint;
  readonly seasonId: bigint;
  readonly seasonNumber: number;
  readonly episodeNumber: number;
  readonly airDate: Date | null;
  readonly runtimeMinutes: number | null;
}

/** Filtro de episodios de uma serie. */
export interface SeriesEpisodeQuery {
  readonly tvShowId: bigint;
  /**
   * `false` exclui `season_number = 0` (especiais). A politica e EXPLICITA e
   * testada — nao ha default implicito espalhado pelo codigo.
   */
  readonly includeSpecials: boolean;
  /** `null` = todas as temporadas; numero = uma temporada especifica. */
  readonly seasonNumber: number | null;
  /** Teto de linhas devolvidas; o tracker pagina series gigantes. */
  readonly limit: number;
  readonly offset: number;
}

/** Candidato de catalogo para o matching de importacao. */
export interface CatalogMatchCandidate {
  readonly entityType: WatchableEntityType;
  readonly entityId: bigint;
  readonly title: string;
  readonly year: number | null;
  readonly tmdbId: number | null;
  readonly imdbId: string | null;
}
