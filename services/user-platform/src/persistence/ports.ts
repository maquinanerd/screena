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
import type { SessionRecord, VerificationTokenRecord } from "../auth/types.js";
import type {
  AuthTokenConsumeInput,
  AuthTokenConsumeResult,
  AuthTokenInvalidatePendingInput,
  AuthTokenInvalidatePendingResult,
  AuthTokenIssueResult,
  CredentialCreateInput,
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
 * PORT_GAP REGISTRADO EM C7B2 (nao resolvido aqui, de proposito):
 *
 *  - falta `findById(userId) -> status`. `evaluateSessionAccess` exige
 *    `userStatus`, e `SessionAccessRecord` devolve `userId` justamente para
 *    busca-lo — mas nenhum metodo publicado o obtem a partir de um id. Sem isso,
 *    VALIDAR SESSAO (o caminho de toda requisicao autenticada) nao e componivel.
 *  - falta `markEmailVerified` e um `emailVerifiedAt` legivel.
 *    `AuthTokenStore.consume` devolve o `userId` do token para
 *    `applyEmailVerification`, mas nada persiste o carimbo nem alimenta o
 *    `alreadyVerified` de `evaluateVerificationResend`.
 *
 * Contraste que delimita o gap: recuperacao de senha FECHA de ponta a ponta
 * (provado em PostgreSQL real); verificacao de e-mail e validacao de sessao NAO.
 * Ampliar este port pertence a unidade que trouxer esses fluxos — corrigi-lo
 * dentro do C7B2 seria mexer no contrato de outra unidade sem escopo.
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
