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
  AuthThrottleStore,
  AuthTokenStore,
  IdentityStore,
  PasswordCredentialStore,
  SessionStore,
} from "../../persistence/ports.js";
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
import type { AuthEmailRuntimeDeps, AuthStores, AuthTransactionRunner } from "../deps.js";
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
}

export interface FakeDb {
  users: Map<string, FakeUserRow>;
  credentials: Map<string, { passwordHash: string; algorithm: string }>;
  sessions: Map<string, FakeSessionRow>;
  tokens: Map<string, FakeTokenRow>;
  throttles: Map<string, AuthThrottleState>;
  nextId: bigint;
}

export function createFakeDb(): FakeDb {
  return {
    users: new Map(),
    credentials: new Map(),
    sessions: new Map(),
    tokens: new Map(),
    throttles: new Map(),
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
      const id = seedUser(db, { emailNormalized: input.emailNormalized });
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

  return { identities, credentials, sessions, authTokens, throttles };
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

export interface TestRuntime {
  readonly deps: AuthEmailRuntimeDeps;
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
} = {}): TestRuntime {
  const db = options.db ?? createFakeDb();
  const clock = options.clock ?? createTestClock();
  const emails = options.emails ?? createFakeEmailProvider();
  const logs: AuthEmailLogEvent[] = [];
  const agendadas: Promise<void>[] = [];

  const deps: AuthEmailRuntimeDeps = {
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
