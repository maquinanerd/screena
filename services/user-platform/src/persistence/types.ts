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

import type { AuthTokenPurpose, UserStatus } from "../core/types.js";

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
  | "authToken.tokenHash";

/**
 * Alvos de divergencia de PRE-IMAGEM (compare-and-swap). NAO indica unicidade:
 * o hash NAO tem unique — e apenas o valor comparado no swap.
 */
export type PreimageConflictTarget = "credential.passwordHash";

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
 * NAO carrega `tokenHash` nem `csrfTokenHash`: quem consultou ja tem o hash, e
 * devolve-lo ampliaria a superficie do segredo sem leitor. Tambem nao carrega
 * `ipHash`, `userAgent`, `lastUsedAt`, `revokedReason` nem `rotatedFromId` —
 * nenhuma funcao pura os consome.
 */
export interface SessionAccessRecord {
  readonly id: bigint;
  readonly userId: bigint;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
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
 * NAO carrega `status`: `evaluateVerificationResend` recebe apenas
 * `{ userExists, alreadyVerified }` — devolver status seria campo sem leitor.
 */
export interface EmailVerificationState {
  readonly userId: bigint;
  readonly emailVerifiedAt: Date | null;
}

export type EmailVerificationStateLookupResult =
  | { readonly kind: "found"; readonly state: EmailVerificationState }
  | { readonly kind: "not_found" };
