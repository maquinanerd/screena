/**
 * HARNESS do validador C7D: monta um AuthRuntimeDeps REAL (stores Prisma sobre
 * `prisma.$transaction`) e expoe os servicos de conta/privacidade ja ligados.
 *
 * NAO e a composicao de producao — nao le `process.env`, nao chama a Brevo, nao
 * envia e-mail (o provedor e um duble que descarta a entrega). E deliberado: o
 * validador prova PERSISTENCIA e ORQUESTRACAO contra Postgres real, nao o
 * transporte de e-mail (esse ja tem o smoke da Brevo). Assim o validador roda
 * sem nenhum segredo configurado.
 */

import type { PrismaClient } from "@prisma/client";

import {
  generateOpaqueToken,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from "../src/core/crypto.js";
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
} from "../src/persistence/prisma/index.js";
import type { AuthRuntimeDeps, AuthStores } from "../src/auth-runtime/deps.js";
import type { TransactionScope } from "../src/persistence/types.js";
import {
  changePassword as changePasswordSvc,
  login as loginSvc,
  resolveAuthenticatedContext as resolveSvc,
  signup as signupSvc,
} from "../src/auth-runtime/account.js";
import {
  anonymizeAccount as anonymizeSvc,
  hasActiveConsent as hasActiveConsentSvc,
  requestAccountClosure as closeSvc,
  requestDataExport as exportSvc,
  setConsent as setConsentSvc,
  updateProfile as updateProfileSvc,
} from "../src/auth-runtime/privacy-services.js";

/** Re-export para o validador chamar a troca de senha diretamente. */
export const changePassword = changePasswordSvc;

const SCOPE: TransactionScope = { transactional: true };

/** Provedor de e-mail que descarta a entrega (o validador nao testa transporte). */
const noopEmailProvider = {
  sendEmailVerification: async () => ({ providerMessageId: "noop" }),
  sendPasswordReset: async () => ({ providerMessageId: "noop" }),
};

/** Monta as deps reais e devolve, ao lado, a fila de entregas agendadas. */
function buildRealRuntimeDeps(prisma: PrismaClient): {
  readonly deps: AuthRuntimeDeps;
  readonly pending: Promise<void>[];
} {
  const pending: Promise<void>[] = [];
  const deps: AuthRuntimeDeps = {
    runInTransaction: <T>(work: (scope: TransactionScope, stores: AuthStores) => Promise<T>): Promise<T> =>
      prisma.$transaction((tx) =>
        work(SCOPE, {
          identities: createPrismaIdentityStore(tx),
          credentials: createPrismaPasswordCredentialStore(tx),
          sessions: createPrismaSessionStore(tx),
          authTokens: createPrismaAuthTokenStore(tx),
          throttles: createPrismaAuthThrottleStore(tx),
          profiles: createPrismaUserProfileStore(tx),
          consents: createPrismaConsentStore(tx),
          dataRequests: createPrismaDataRequestStore(tx),
          audit: createPrismaAuthAuditStore(tx),
          accountLifecycle: createPrismaAccountLifecycleStore(tx),
          exportReader: createPrismaExportReadStore(tx),
        }),
      ),
    emailProvider: noopEmailProvider,
    scheduleDelivery: (task) => {
      pending.push(task());
    },
    publicAppUrl: new URL("https://validator.local"),
    passwordResetExpirationMinutes: 120,
    emailVerificationExpirationMinutes: 1440,
    now: () => new Date(),
    generateSecret: generateOpaqueToken,
    hashSecret: sha256Hex,
    hashPassword,
    logger: () => undefined,
    verifyPassword,
    decoyPasswordHash: hashPassword(`cinerie-login-decoy-${generateOpaqueToken()}`),
    sessionTtlHours: 720,
    production: false,
    policyVersions: { terms_of_service: "2026-07", privacy_policy: "2026-07" },
    deletionGraceDays: 30,
  };
  return { deps, pending };
}

/** Fachada com os servicos ja ligados ao runtime real, + utilitarios do teste. */
export function createFullAuthRuntimeForTest(prisma: PrismaClient) {
  const { deps, pending } = buildRealRuntimeDeps(prisma);
  const flush = async (): Promise<void> => {
    await Promise.all(pending.splice(0, pending.length));
  };
  return {
    signup: (cmd: Parameters<typeof signupSvc>[1], ctx: Parameters<typeof signupSvc>[2]) =>
      signupSvc(deps, cmd, ctx),
    login: (cmd: Parameters<typeof loginSvc>[1], ctx: Parameters<typeof loginSvc>[2]) =>
      loginSvc(deps, cmd, ctx),
    resolveAuthenticatedContext: (token: string | null) => resolveSvc(deps, token),
    updateProfile: (
      auth: Parameters<typeof updateProfileSvc>[1],
      cmd: Parameters<typeof updateProfileSvc>[2],
      ctx: Parameters<typeof updateProfileSvc>[3],
    ) => updateProfileSvc(deps, auth, cmd, ctx),
    setConsent: (
      auth: Parameters<typeof setConsentSvc>[1],
      cmd: Parameters<typeof setConsentSvc>[2],
      ctx: Parameters<typeof setConsentSvc>[3],
    ) => setConsentSvc(deps, auth, cmd, ctx),
    hasActiveConsent: (userId: bigint, kind: Parameters<typeof hasActiveConsentSvc>[2]) =>
      hasActiveConsentSvc(deps, userId, kind),
    requestDataExport: (
      auth: Parameters<typeof exportSvc>[1],
      ctx: Parameters<typeof exportSvc>[2],
    ) => exportSvc(deps, auth, ctx),
    requestAccountClosure: (
      auth: Parameters<typeof closeSvc>[1],
      cmd: Parameters<typeof closeSvc>[2],
      ctx: Parameters<typeof closeSvc>[3],
    ) => closeSvc(deps, auth, cmd, ctx),
    anonymizeAccount: (userId: bigint, operator: string) => anonymizeSvc(deps, userId, operator),
    changePassword: (
      auth: Parameters<typeof changePasswordSvc>[1],
      cmd: Parameters<typeof changePasswordSvc>[2],
      ctx: Parameters<typeof changePasswordSvc>[3],
    ) => changePasswordSvc(deps, auth, cmd, ctx),
    flush,
    /** Cadastra e ATIVA uma conta (verifica e-mail direto no banco) para os checks de corrida. */
    signupAndActivate: async (input: {
      readonly email: string;
      readonly emailNormalized: string;
      readonly password: string;
    }): Promise<bigint> => {
      await signupSvc(
        deps,
        {
          email: input.email,
          emailNormalized: input.emailNormalized,
          password: input.password,
          displayName: null,
          acceptedTerms: true,
          acceptedMarketingEmail: false,
          acceptedAnalytics: false,
        },
        { correlationId: "seed", clientIpHash: null, userAgent: null },
      );
      await flush();
      const rows = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
        `SELECT id FROM "users" WHERE email_normalized = '${input.emailNormalized}'`,
      );
      return rows[0]!.id;
    },
  };
}
