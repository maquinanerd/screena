/**
 * Dubles em memoria dos cinco stores + do provedor de e-mail (C7C).
 *
 * Nao e um mock de conveniencia: reproduz as PRE-CONDICOES que os adapters
 * Prisma reais aplicam no banco - consumo atomico com `purpose` no criterio,
 * `emailVerifiedAt: null` preservando o primeiro carimbo, compare-and-swap sobre
 * pre-imagem e revogacao idempotente. Um duble mais frouxo faria os testes
 * passarem com uma composicao que o Postgres reprovaria.
 *
 * `runInTransaction` faz SNAPSHOT antes e RESTAURA em caso de excecao. Sem isso
 * seria impossivel provar a regra central da confirmacao: aborto deliberado
 * devolve o token ao estado pendente em vez de queima-lo.
 *
 * Este arquivo nao termina em `.test.ts` - o vitest nao o coleta como suite.
 */

import type {
  AccountLifecycleStore,
  AuthAuditStore,
  AuthThrottleStore,
  AuthTokenStore,
  ConsentStore,
  DataRequestStore,
  ExportReadStore,
  IdentityStore,
  PasswordCredentialStore,
  SessionStore,
  UserProfileStore,
} from "../../persistence/ports.js";
import type {
  AuthAuditAction,
  ConsentKind,
  DataRequestKind,
  DataRequestStatus,
  ProfileVisibility,
} from "../../core/types.js";
import type {
  AuthThrottleReadResult,
  AuthThrottleSaveInput,
  AuthThrottleSaveResult,
  AuthTokenConsumeInput,
  AuthTokenConsumeResult,
  AuthTokenInvalidatePendingInput,
  AuthTokenInvalidatePendingResult,
  AuthTokenIssueResult,
  AuthThrottleKey,
  AuthThrottleState,
  AccountAnonymizeInput,
  AccountAnonymizeResult,
  AccountStatusTransitionInput,
  AccountStatusTransitionResult,
  AuthAuditAppendInput,
  AuthenticatedUserLookupResult,
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
  CredentialCreateInput,
  CredentialCreateResult,
  CredentialReplaceInput,
  CredentialReplaceResult,
  CredentialVerificationLookupResult,
  EmailVerificationInput,
  EmailVerificationResult,
  EmailVerificationStateLookupResult,
  IdentityCreateInput,
  IdentityCreateResult,
  IdentityLookupResult,
  SessionCreateResult,
  SessionListActiveInput,
  SessionLookupResult,
  SessionRevokeInput,
  SessionRevokeResult,
  TransactionScope,
} from "../../persistence/types.js";
import type { SessionRecord, VerificationTokenRecord } from "../../auth/types.js";
import type { UserStatus } from "../../core/types.js";
import type {
  TransactionalEmailDelivery,
  TransactionalEmailDispatch,
  TransactionalEmailProvider,
} from "../../email/types.js";
import { TransactionalEmailError } from "../../email/types.js";
import { generateOpaqueToken, sha256Hex } from "../../core/crypto.js";
import type { AuthRuntimeDeps, AuthStores, AuthTransactionRunner } from "../deps.js";
import type { AuthEmailLogEvent } from "../observability.js";

const SCOPE: TransactionScope = { transactional: true };

export interface FakeUserRow {
  readonly id: bigint;
  readonly emailNormalized: string;
  status: UserStatus;
  emailVerifiedAt: Date | null;
}

export interface FakeTokenRow {
  readonly userId: bigint;
  readonly purpose: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  consumedAt: Date | null;
}

export interface FakeSessionRow {
  readonly id: bigint;
  readonly userId: bigint;
  readonly expiresAt: Date;
  revokedAt: Date | null;
  /** C7D: insumo do double submit; guardado como o banco guarda (hash). */
  readonly csrfTokenHash: string;
}

/** C7D: linha de consentimento (append-only, como a tabela). */
export interface FakeConsentRow {
  readonly userId: bigint;
  readonly kind: ConsentKind;
  readonly granted: boolean;
  readonly policyVersion: string;
  readonly occurredAt: Date;
}

/** C7D: pedido LGPD. */
export interface FakeDataRequestRow {
  readonly id: bigint;
  readonly userId: bigint;
  readonly kind: DataRequestKind;
  status: DataRequestStatus;
  readonly requestedAt: Date;
  processedAt: Date | null;
}

/** C7D: entrada de auditoria (append-only). */
export interface FakeAuditRow {
  readonly userId: bigint | null;
  readonly sessionId: bigint | null;
  readonly action: AuthAuditAction;
  readonly occurredAt: Date;
}

export interface FakeDb {
  users: Map<string, FakeUserRow>;
  credentials: Map<string, { passwordHash: string; algorithm: string }>;
  sessions: Map<string, FakeSessionRow>;
  tokens: Map<string, FakeTokenRow>;
  throttles: Map<string, AuthThrottleState>;
  /** C7D. Arrays, nao Maps: consentimento e auditoria sao APPEND-ONLY. */
  consents: FakeConsentRow[];
  dataRequests: FakeDataRequestRow[];
  audit: FakeAuditRow[];
  profiles: Map<string, FakeProfileRow>;
  nextId: bigint;
}

/** C7D: perfil publico (users.display_name/handle + user_profiles). */
export interface FakeProfileRow {
  displayName: string | null;
  handle: string | null;
  bio: string | null;
  avatarPath: string | null;
  locale: string;
  countryCode: string | null;
  timezone: string | null;
  visibility: ProfileVisibility;
}

export function createFakeDb(): FakeDb {
  return {
    users: new Map(),
    credentials: new Map(),
    sessions: new Map(),
    tokens: new Map(),
    throttles: new Map(),
    consents: [],
    dataRequests: [],
    audit: [],
    profiles: new Map(),
    nextId: 1n,
  };
}

/** Insere um usuario de teste e devolve o id. */
export function seedUser(
  db: FakeDb,
  input: {
    readonly emailNormalized: string;
    readonly status?: UserStatus;
    readonly emailVerifiedAt?: Date | null;
    readonly passwordHash?: string | null;
  },
): bigint {
  const id = db.nextId;
  db.nextId += 1n;
  db.users.set(input.emailNormalized, {
    id,
    emailNormalized: input.emailNormalized,
    status: input.status ?? "active",
    emailVerifiedAt: input.emailVerifiedAt ?? null,
  });
  if (input.passwordHash !== null) {
    db.credentials.set(String(id), {
      passwordHash: input.passwordHash ?? "scrypt$N=32768,r=8,p=1$aa$bb",
      algorithm: "scrypt",
    });
  }
  return id;
}

function findUserById(db: FakeDb, userId: bigint): FakeUserRow | null {
  for (const row of db.users.values()) {
    if (row.id === userId) return row;
  }
  return null;
}

function throttleKey(scope: string, key: string): string {
  return `${scope}|${key}`;
}

export function createFakeStores(db: FakeDb): AuthStores {
  const identities: IdentityStore = {
    async create(_s: TransactionScope, input: IdentityCreateInput): Promise<IdentityCreateResult> {
      if (db.users.has(input.emailNormalized)) {
        return {
          kind: "conflict",
          conflict: { reason: "unique_violation", target: "identity.emailNormalized" },
        };
      }
      // `passwordHash: null` de proposito: criar a IDENTIDADE nao cria
      // credencial. O `seedUser` default criaria uma (o cadastro real usa
      // `createInitial` como passo SEPARADO na mesma transacao), e essa
      // credencial fantasma faria o `createInitial` do signup colidir.
      const id = seedUser(db, { emailNormalized: input.emailNormalized, passwordHash: null });
      return { kind: "created", identity: { id, status: "active" } };
    },
    async findByNormalizedEmail(
      _s: TransactionScope,
      emailNormalized: string,
    ): Promise<IdentityLookupResult> {
      const row = db.users.get(emailNormalized);
      return row === undefined
        ? { kind: "not_found" }
        : { kind: "found", identity: { id: row.id, status: row.status } };
    },
    async findById(_s: TransactionScope, userId: bigint): Promise<IdentityLookupResult> {
      const row = findUserById(db, userId);
      return row === null
        ? { kind: "not_found" }
        : { kind: "found", identity: { id: row.id, status: row.status } };
    },
    async markEmailVerified(
      _s: TransactionScope,
      input: EmailVerificationInput,
    ): Promise<EmailVerificationResult> {
      const row = findUserById(db, input.userId);
      if (row === null) return { kind: "not_found" };
      // PRE-CONDICAO do adapter real: so grava quando ainda e null, o que
      // PRESERVA o primeiro carimbo.
      if (row.emailVerifiedAt !== null) return { kind: "already_verified" };
      row.emailVerifiedAt = input.now;
      return { kind: "verified" };
    },
    async findEmailVerificationStateByNormalizedEmail(
      _s: TransactionScope,
      emailNormalized: string,
    ): Promise<EmailVerificationStateLookupResult> {
      const row = db.users.get(emailNormalized);
      return row === undefined
        ? { kind: "not_found" }
        : {
            kind: "found",
            state: {
              userId: row.id,
              emailVerifiedAt: row.emailVerifiedAt,
              status: row.status,
            },
          };
    },
  };

  const credentials: PasswordCredentialStore = {
    async createInitial(
      _s: TransactionScope,
      input: CredentialCreateInput,
    ): Promise<CredentialCreateResult> {
      const key = String(input.userId);
      if (db.credentials.has(key)) {
        return {
          kind: "already_exists",
          conflict: { reason: "unique_violation", target: "credential.user" },
        };
      }
      db.credentials.set(key, {
        passwordHash: input.passwordHash,
        algorithm: input.algorithm,
      });
      return { kind: "created" };
    },
    async findForVerification(
      _s: TransactionScope,
      userId: bigint,
    ): Promise<CredentialVerificationLookupResult> {
      const row = db.credentials.get(String(userId));
      return row === undefined
        ? { kind: "not_found" }
        : { kind: "found", material: { passwordHash: row.passwordHash } };
    },
    async replaceByPreimage(
      _s: TransactionScope,
      input: CredentialReplaceInput,
    ): Promise<CredentialReplaceResult> {
      const key = String(input.userId);
      const row = db.credentials.get(key);
      if (row === undefined) return { kind: "not_found" };
      // COMPARE-AND-SWAP: pre-imagem divergente nunca sobrescreve.
      if (row.passwordHash !== input.expectedPasswordHash) {
        return {
          kind: "conflict",
          conflict: { reason: "stale_preimage", target: "credential.passwordHash" },
        };
      }
      db.credentials.set(key, {
        passwordHash: input.nextPasswordHash,
        algorithm: input.nextAlgorithm,
      });
      return { kind: "updated" };
    },
  };

  const sessions: SessionStore = {
    async create(_s: TransactionScope, record: SessionRecord): Promise<SessionCreateResult> {
      const id = db.nextId;
      db.nextId += 1n;
      db.sessions.set(record.tokenHash, {
        id,
        userId: record.userId,
        expiresAt: record.expiresAt,
        revokedAt: null,
        csrfTokenHash: record.csrfTokenHash,
      });
      return { kind: "created", sessionId: id };
    },
    async findByTokenHash(
      _s: TransactionScope,
      tokenHash: string,
    ): Promise<SessionLookupResult> {
      const row = db.sessions.get(tokenHash);
      return row === undefined
        ? { kind: "not_found" }
        : {
            kind: "found",
            session: {
              id: row.id,
              userId: row.userId,
              expiresAt: row.expiresAt,
              revokedAt: row.revokedAt,
              csrfTokenHash: row.csrfTokenHash,
            },
          };
    },
    async revoke(
      _s: TransactionScope,
      input: SessionRevokeInput,
    ): Promise<SessionRevokeResult> {
      let revokedCount = 0;
      for (const row of db.sessions.values()) {
        // Idempotente: ja revogada nao conta de novo.
        if (input.sessionIds.includes(row.id) && row.revokedAt === null) {
          row.revokedAt = input.now;
          revokedCount += 1;
        }
      }
      return { revokedCount };
    },
    async listActiveIds(
      _s: TransactionScope,
      input: SessionListActiveInput,
    ): Promise<readonly bigint[]> {
      const out: bigint[] = [];
      for (const row of db.sessions.values()) {
        if (
          row.userId === input.userId &&
          row.revokedAt === null &&
          row.expiresAt.getTime() > input.now.getTime()
        ) {
          out.push(row.id);
        }
      }
      return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    },
  };

  const authTokens: AuthTokenStore = {
    async issue(
      _s: TransactionScope,
      record: VerificationTokenRecord,
    ): Promise<AuthTokenIssueResult> {
      if (db.tokens.has(record.tokenHash)) {
        return {
          kind: "conflict",
          conflict: { reason: "unique_violation", target: "authToken.tokenHash" },
        };
      }
      const id = db.nextId;
      db.nextId += 1n;
      db.tokens.set(record.tokenHash, {
        userId: record.userId,
        purpose: record.purpose,
        tokenHash: record.tokenHash,
        expiresAt: record.expiresAt,
        consumedAt: null,
      });
      return { kind: "issued", tokenId: id };
    },
    async consume(
      _s: TransactionScope,
      input: AuthTokenConsumeInput,
    ): Promise<AuthTokenConsumeResult> {
      const row = db.tokens.get(input.tokenHash);
      // Mesma ordem de classificacao do adapter real.
      if (row === undefined) return { kind: "not_found" };
      if (row.purpose !== input.purpose) return { kind: "wrong_purpose" };
      if (row.consumedAt !== null) return { kind: "already_consumed" };
      // `now >= expiresAt` ja e expirado (o adapter usa `gt: now` no WHERE).
      if (input.now.getTime() >= row.expiresAt.getTime()) return { kind: "expired" };
      row.consumedAt = input.now;
      return { kind: "consumed", userId: row.userId };
    },
    async invalidatePending(
      _s: TransactionScope,
      input: AuthTokenInvalidatePendingInput,
    ): Promise<AuthTokenInvalidatePendingResult> {
      let invalidatedCount = 0;
      for (const row of db.tokens.values()) {
        if (row.userId === input.userId && row.purpose === input.purpose && row.consumedAt === null) {
          row.consumedAt = input.now;
          invalidatedCount += 1;
        }
      }
      return { invalidatedCount };
    },
  };

  const throttles: AuthThrottleStore = {
    async read(_s: TransactionScope, input: AuthThrottleKey): Promise<AuthThrottleReadResult> {
      const row = db.throttles.get(throttleKey(input.scope, input.key));
      return row === undefined ? { kind: "not_found" } : { kind: "found", state: row };
    },
    async save(
      _s: TransactionScope,
      input: AuthThrottleSaveInput,
    ): Promise<AuthThrottleSaveResult> {
      const key = throttleKey(input.scope, input.key);
      const current = db.throttles.get(key);
      const matches =
        input.expected === null
          ? current === undefined
          : current !== undefined &&
            current.failureCount === input.expected.failureCount &&
            current.windowStartedAt.getTime() === input.expected.windowStartedAt.getTime() &&
            (current.lockedUntil?.getTime() ?? null) ===
              (input.expected.lockedUntil?.getTime() ?? null);
      if (!matches) {
        return {
          kind: "conflict",
          conflict: { reason: "stale_preimage", target: "authThrottle.window" },
        };
      }
      db.throttles.set(key, input.next);
      return { kind: "saved" };
    },
  };

  // -------------------------------------------------------------------------
  // C7D — perfil, consentimento, pedidos LGPD, auditoria e ciclo de vida
  // -------------------------------------------------------------------------

  const profiles: UserProfileStore = {
    async findByUserId(_s: TransactionScope, userId: bigint): Promise<ProfileLookupResult> {
      const existeConta = [...db.users.values()].some((u) => u.id === userId);
      if (!existeConta) return { kind: "not_found" };
      const row = db.profiles.get(String(userId));
      // Conta sem perfil devolve os DEFAULTS de coluna, como o adapter real.
      return {
        kind: "found",
        profile: row ?? {
          displayName: null,
          handle: null,
          bio: null,
          avatarPath: null,
          locale: "pt-BR",
          countryCode: null,
          timezone: null,
          visibility: "private",
        },
      };
    },

    async findAuthenticatedUser(
      _s: TransactionScope,
      userId: bigint,
    ): Promise<AuthenticatedUserLookupResult> {
      const user = [...db.users.values()].find((u) => u.id === userId);
      if (user === undefined) return { kind: "not_found" };
      const perfil = db.profiles.get(String(userId));
      return {
        kind: "found",
        user: {
          id: user.id,
          handle: perfil?.handle ?? null,
          displayName: perfil?.displayName ?? null,
          email: user.emailNormalized,
          emailNormalized: user.emailNormalized,
          emailVerifiedAt: user.emailVerifiedAt,
          role: "user",
          status: user.status,
          locale: perfil?.locale ?? "pt-BR",
          profileVisibility: perfil?.visibility ?? "private",
          createdAt: new Date(0),
          deletedAt: null,
        },
      };
    },

    async upsert(_s: TransactionScope, input: ProfileUpsertInput): Promise<ProfileUpsertResult> {
      // Mesma PRE-CONDICAO do adapter real: handle de outra conta e conflito.
      if (input.handle !== null) {
        for (const [key, row] of db.profiles) {
          if (row.handle === input.handle && key !== String(input.userId)) {
            return {
              kind: "conflict",
              conflict: { reason: "unique_violation", target: "identity.handle" },
            };
          }
        }
      }
      const next: FakeProfileRow = {
        displayName: input.displayName,
        handle: input.handle,
        bio: input.bio,
        avatarPath: input.avatarPath,
        locale: input.locale,
        countryCode: input.countryCode,
        timezone: input.timezone,
        visibility: input.visibility,
      };
      db.profiles.set(String(input.userId), next);
      return { kind: "saved", profile: next };
    },
  };

  const consents: ConsentStore = {
    async append(_s: TransactionScope, input: ConsentAppendInput): Promise<void> {
      db.consents.push({ ...input });
    },
    async listByUser(_s: TransactionScope, userId: bigint): Promise<readonly ConsentRecordRow[]> {
      // SEM ordenar: o adapter real tambem nao ordena — `currentConsent` decide.
      return db.consents
        .filter((c) => c.userId === userId)
        .map(({ kind, granted, policyVersion, occurredAt }) => ({
          kind,
          granted,
          policyVersion,
          occurredAt,
        }));
    },
    async listByUserAndKind(
      _s: TransactionScope,
      input: { readonly userId: bigint; readonly kind: ConsentKind },
    ): Promise<readonly ConsentRecordRow[]> {
      return db.consents
        .filter((c) => c.userId === input.userId && c.kind === input.kind)
        .map(({ kind, granted, policyVersion, occurredAt }) => ({
          kind,
          granted,
          policyVersion,
          occurredAt,
        }));
    },
  };

  const dataRequests: DataRequestStore = {
    async create(
      _s: TransactionScope,
      input: DataRequestCreateInput,
    ): Promise<DataRequestCreateResult> {
      const id = db.nextId;
      db.nextId += 1n;
      const row: FakeDataRequestRow = {
        id,
        userId: input.userId,
        kind: input.kind,
        status: input.status,
        requestedAt: input.requestedAt,
        processedAt: null,
      };
      db.dataRequests.push(row);
      return {
        kind: "created",
        request: {
          id,
          kind: row.kind,
          status: row.status,
          requestedAt: row.requestedAt,
          processedAt: null,
        },
      };
    },
    async findLatestByKind(
      _s: TransactionScope,
      input: { readonly userId: bigint; readonly kind: DataRequestKind },
    ): Promise<DataRequestLookupResult> {
      const candidatos = db.dataRequests.filter(
        (r) => r.userId === input.userId && r.kind === input.kind,
      );
      if (candidatos.length === 0) return { kind: "not_found" };
      // Mesmo criterio do adapter: requestedAt DESC, id DESC (determinismo).
      const row = candidatos.reduce((a, b) =>
        b.requestedAt.getTime() > a.requestedAt.getTime() ||
        (b.requestedAt.getTime() === a.requestedAt.getTime() && b.id > a.id)
          ? b
          : a,
      );
      return {
        kind: "found",
        request: {
          id: row.id,
          kind: row.kind,
          status: row.status,
          requestedAt: row.requestedAt,
          processedAt: row.processedAt,
        },
      };
    },
    async listByUser(
      _s: TransactionScope,
      userId: bigint,
    ): Promise<readonly DataRequestRecord[]> {
      return db.dataRequests
        .filter((r) => r.userId === userId)
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          status: r.status,
          requestedAt: r.requestedAt,
          processedAt: r.processedAt,
        }));
    },
    async transition(
      _s: TransactionScope,
      input: DataRequestTransitionInput,
    ): Promise<DataRequestTransitionResult> {
      const row = db.dataRequests.find((r) => r.id === input.id);
      if (row === undefined) return { kind: "not_found" };
      // COMPARE-AND-SWAP sobre o status esperado, como o adapter real.
      if (row.status !== input.expectedStatus) {
        return {
          kind: "conflict",
          conflict: { reason: "stale_preimage", target: "dataRequest.status" },
        };
      }
      row.status = input.nextStatus;
      row.processedAt = input.processedAt;
      return { kind: "updated" };
    },
  };

  const audit: AuthAuditStore = {
    async append(_s: TransactionScope, input: AuthAuditAppendInput): Promise<void> {
      db.audit.push({
        userId: input.userId,
        sessionId: input.sessionId,
        action: input.action,
        occurredAt: input.occurredAt,
      });
    },
  };

  const accountLifecycle: AccountLifecycleStore = {
    async transitionStatus(
      _s: TransactionScope,
      input: AccountStatusTransitionInput,
    ): Promise<AccountStatusTransitionResult> {
      const user = [...db.users.values()].find((u) => u.id === input.userId);
      if (user === undefined) return { kind: "not_found" };
      if (user.status !== input.expectedStatus) {
        return {
          kind: "conflict",
          conflict: { reason: "stale_preimage", target: "identity.status" },
        };
      }
      user.status = input.nextStatus;
      return { kind: "updated" };
    },
    async anonymize(
      _s: TransactionScope,
      input: AccountAnonymizeInput,
    ): Promise<AccountAnonymizeResult> {
      const entry = [...db.users.entries()].find(([, u]) => u.id === input.userId);
      if (entry === undefined) return { kind: "not_found" };
      const [key, user] = entry;
      // PRE-CONDICAO do adapter real: so anonimiza quem ja pediu encerramento.
      if (user.status !== "pending_deletion") {
        return {
          kind: "conflict",
          conflict: { reason: "stale_preimage", target: "identity.status" },
        };
      }
      db.users.delete(key);
      db.users.set(input.anonymizedEmailNormalized, {
        id: user.id,
        emailNormalized: input.anonymizedEmailNormalized,
        status: "deleted",
        emailVerifiedAt: null,
      });
      db.profiles.delete(String(input.userId));
      return { kind: "anonymized" };
    },
  };

  const exportReader: ExportReadStore = {
    async project(_s: TransactionScope, userId: bigint): Promise<ExportProjectionResult> {
      const user = [...db.users.values()].find((u) => u.id === userId);
      if (user === undefined) return { kind: "not_found" };
      const perfil = db.profiles.get(String(userId));
      return {
        kind: "found",
        projection: {
          accountCore: {
            email: user.emailNormalized,
            status: user.status,
            emailVerifiedAt: user.emailVerifiedAt,
            createdAt: new Date(0),
          },
          profile: perfil ?? null,
          // Vazio: este duble nao modela conteudo de produto (Prompts 08+).
          productContent: {},
          productStats: null,
          governanceConsents: db.consents
            .filter((c) => c.userId === userId)
            .map(({ kind, granted, policyVersion, occurredAt }) => ({
              kind,
              granted,
              policyVersion,
              occurredAt,
            })),
          governanceRequests: db.dataRequests
            .filter((r) => r.userId === userId)
            .map((r) => ({
              id: r.id,
              kind: r.kind,
              status: r.status,
              requestedAt: r.requestedAt,
              processedAt: r.processedAt,
            })),
          // C8: este duble nao modela importacao (o fluxo tem dubles proprios).
          governanceImports: [],
        },
      };
    },
  };

  return {
    identities,
    credentials,
    sessions,
    authTokens,
    throttles,
    profiles,
    consents,
    dataRequests,
    audit,
    accountLifecycle,
    exportReader,
  };
}

/**
 * Runner com ROLLBACK real: snapshot antes, restaura em caso de excecao.
 *
 * E o que permite provar que um aborto deliberado devolve o token ao estado
 * pendente. Um runner que so repassasse a excecao deixaria o consumo aplicado
 * e o teste passaria descrevendo um comportamento que o Postgres nao teria.
 */
export function createFakeRunner(db: FakeDb): AuthTransactionRunner {
  return async <T>(
    work: (scope: TransactionScope, stores: AuthStores) => Promise<T>,
  ): Promise<T> => {
    const snapshot = {
      users: structuredClone(db.users),
      credentials: structuredClone(db.credentials),
      sessions: structuredClone(db.sessions),
      tokens: structuredClone(db.tokens),
      throttles: structuredClone(db.throttles),
      // C7D. Sem estas cinco, um cadastro ABORTADO deixaria consentimento e
      // auditoria para tras, e o teste que prova "aborto nao grava nada"
      // passaria por engano — a prova estaria olhando so metade das tabelas.
      consents: structuredClone(db.consents),
      dataRequests: structuredClone(db.dataRequests),
      audit: structuredClone(db.audit),
      profiles: structuredClone(db.profiles),
      nextId: db.nextId,
    };
    try {
      return await work(SCOPE, createFakeStores(db));
    } catch (error) {
      db.users = snapshot.users;
      db.credentials = snapshot.credentials;
      db.sessions = snapshot.sessions;
      db.tokens = snapshot.tokens;
      db.throttles = snapshot.throttles;
      db.consents = snapshot.consents;
      db.dataRequests = snapshot.dataRequests;
      db.audit = snapshot.audit;
      db.profiles = snapshot.profiles;
      db.nextId = snapshot.nextId;
      throw error;
    }
  };
}

export interface RecordedEmail {
  readonly kind: "email_verification" | "password_reset";
  readonly dispatch: TransactionalEmailDispatch;
}

export interface FakeEmailProvider extends TransactionalEmailProvider {
  readonly sent: RecordedEmail[];
}

/**
 * Provedor de e-mail em memoria. `failWith` faz todo envio falhar com a
 * categoria dada - necessario para provar que falha de fornecedor NAO altera a
 * resposta publica.
 */
export function createFakeEmailProvider(options: {
  readonly failWith?: TransactionalEmailError;
} = {}): FakeEmailProvider {
  const sent: RecordedEmail[] = [];
  async function send(
    kind: RecordedEmail["kind"],
    dispatch: TransactionalEmailDispatch,
  ): Promise<TransactionalEmailDelivery> {
    if (options.failWith !== undefined) {
      throw options.failWith;
    }
    sent.push({ kind, dispatch });
    return { providerMessageId: `<fake-${sent.length}@example.test>` };
  }
  return {
    sent,
    sendEmailVerification: (dispatch) => send("email_verification", dispatch),
    sendPasswordReset: (dispatch) => send("password_reset", dispatch),
  };
}

// ---------------------------------------------------------------------------
// Montagem das dependencias de runtime para os testes de aplicacao
// ---------------------------------------------------------------------------

/**
 * Relogio controlavel. Tempo e parametro em toda a camada; aqui ele vira um
 * ponteiro que o teste avanca para provar expiracao e janela de throttle.
 */
export interface TestClock {
  now: Date;
  advanceMinutes(minutes: number): void;
}

export function createTestClock(start = new Date("2026-07-22T12:00:00.000Z")): TestClock {
  const clock: TestClock = {
    now: start,
    advanceMinutes(minutes: number): void {
      clock.now = new Date(clock.now.getTime() + minutes * 60_000);
    },
  };
  return clock;
}

/**
 * Hash de senha FICTICIO em formato PHC-like.
 *
 * O scrypt real usa N=2^15 e leva ~100ms por chamada — inviavel numa suite que
 * troca senha dezenas de vezes. O formato e preservado porque
 * `buildCredentialRegistration` deriva `algorithm` do prefixo antes do primeiro
 * "$"; um hash sem essa forma faria o rotulo virar "unknown" e o teste passaria
 * validando algo que producao nao faz.
 */
export function fakeHashPassword(password: string): string {
  return `scrypt$N=2,r=1,p=1$0011$${Buffer.from(password, "utf8").toString("hex")}`;
}

/**
 * Verificacao PAR do `fakeHashPassword`: re-hasheia e compara. Determinista e
 * sem custo, mas com a MESMA semantica de producao (senha errada -> false, hash
 * malformado -> false), para que os testes de login/troca/encerramento provem o
 * caminho real de credencial em vez de um booleano plantado.
 */
export function fakeVerifyPassword(password: string, storedHash: string): boolean {
  return fakeHashPassword(password) === storedHash;
}

export interface TestRuntime {
  readonly deps: AuthRuntimeDeps;
  readonly db: FakeDb;
  readonly clock: TestClock;
  readonly emails: FakeEmailProvider;
  readonly logs: AuthEmailLogEvent[];
  /**
   * Aguarda as entregas agendadas.
   *
   * Em producao `scheduleDelivery` SOLTA a tarefa: a resposta publica nao pode
   * esperar o fornecedor, senao o tempo de resposta vira oraculo de existencia
   * de conta. Nos testes o duble coleta as promessas para que a suite possa
   * observar o envio — e a existencia deste `flush` e, por si so, a prova de que
   * o envio nao acontece antes de o servico retornar.
   */
  flush(): Promise<void>;
}

/**
 * Monta um runtime completo em memoria.
 *
 * Usa `generateOpaqueToken` e `sha256Hex` REAIS: o token cru nunca e conhecido
 * pelo teste antecipadamente, exatamente como em producao. Para confirmar um
 * fluxo, o teste extrai o token do LINK que foi de fato enviado — o que prova o
 * caminho inteiro (emissao -> hash persistido -> link -> consumo) em vez de
 * confiar num valor plantado.
 */
export function createTestRuntime(options: {
  readonly clock?: TestClock;
  readonly emails?: FakeEmailProvider;
  readonly db?: FakeDb;
  readonly passwordResetExpirationMinutes?: number;
  readonly emailVerificationExpirationMinutes?: number;
  readonly sessionTtlHours?: number;
  readonly production?: boolean;
  readonly termsPolicyVersion?: string;
  readonly privacyPolicyVersion?: string;
  readonly deletionGraceDays?: number;
} = {}): TestRuntime {
  const db = options.db ?? createFakeDb();
  const clock = options.clock ?? createTestClock();
  const emails = options.emails ?? createFakeEmailProvider();
  const logs: AuthEmailLogEvent[] = [];
  const agendadas: Promise<void>[] = [];

  const deps: AuthRuntimeDeps = {
    runInTransaction: createFakeRunner(db),
    emailProvider: emails,
    scheduleDelivery: (task) => {
      agendadas.push(task());
    },
    publicAppUrl: new URL("https://cinerie.com"),
    passwordResetExpirationMinutes: options.passwordResetExpirationMinutes ?? 30,
    emailVerificationExpirationMinutes: options.emailVerificationExpirationMinutes ?? 1440,
    now: () => clock.now,
    generateSecret: generateOpaqueToken,
    hashSecret: sha256Hex,
    hashPassword: fakeHashPassword,
    logger: (event) => logs.push(event),

    // C7D
    verifyPassword: fakeVerifyPassword,
    decoyPasswordHash: fakeHashPassword("cinerie-login-decoy-fixo"),
    sessionTtlHours: options.sessionTtlHours ?? 720,
    production: options.production ?? false,
    policyVersions: {
      terms_of_service: options.termsPolicyVersion ?? "2026-07",
      privacy_policy: options.privacyPolicyVersion ?? "2026-07",
    },
    deletionGraceDays: options.deletionGraceDays ?? 30,
  };

  return {
    deps,
    db,
    clock,
    emails,
    logs,
    async flush(): Promise<void> {
      // `splice` para que um flush nao reaguarde entregas ja drenadas.
      await Promise.all(agendadas.splice(0, agendadas.length));
    },
  };
}

/** Extrai o token CRU do link que foi realmente enviado por e-mail. */
export function tokenFromSentEmail(email: RecordedEmail): string {
  const token = new URL(email.dispatch.actionUrl).searchParams.get("token");
  if (token === null) {
    throw new Error("o link enviado nao carrega token");
  }
  return token;
}
