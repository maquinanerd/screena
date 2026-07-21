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
  CredentialCreateInput,
  CredentialCreateResult,
  CredentialReplaceInput,
  CredentialReplaceResult,
  CredentialVerificationLookupResult,
  IdentityCreateInput,
  IdentityCreateResult,
  IdentityLookupResult,
  PersistenceOutcome,
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
 * handle, `markEmailVerified` nem `transitionStatus` — nenhum fluxo desta
 * unidade os consome (verificacao e C7B2; LGPD e C7B3). Sem CRUD generico e sem
 * operacao administrativa.
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
