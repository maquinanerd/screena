/**
 * SERVICOS DE APLICACAO da conta e da sessao (Backend C, C7D).
 *
 * Cadastro, login, leitura da sessao corrente, logout, logout global e troca de
 * senha autenticada. Mesma arquitetura das duas unidades anteriores: decisores
 * puros decidem, ports persistem, tudo dentro de UMA transacao, e o segredo
 * bruto sai por um canal separado do corpo publico (`SensitiveSessionDelivery`,
 * que a borda transforma em cookie).
 *
 * TRES REGRAS DE SEGURANCA MORAM AQUI:
 *
 *  1. ANTI-ENUMERACAO NO CADASTRO E NO LOGIN. O cadastro responde 202 com o
 *     MESMO corpo exista ou nao o e-mail; o login responde 401 com a MESMA
 *     mensagem para conta inexistente, senha errada e conta inelegivel. A causa
 *     real vive so em `user_auth_audit_logs`.
 *
 *  2. SESSION FIXATION E IMPOSSIVEL POR CONSTRUCAO. O login nao recebe, nao le
 *     e nao reaproveita identificador de sessao nenhum: `generateSecret()`
 *     produz um token novo de 256 bits a cada autenticacao, e o registro nasce
 *     de `buildSessionCreation`. Nao existe caminho de codigo que promova uma
 *     sessao pre-existente a autenticada — o parametro para isso nao existe na
 *     assinatura.
 *
 *  3. EVENTO SENSIVEL DERRUBA TUDO. Trocar a senha revoga TODAS as sessoes,
 *     inclusive a que fez o pedido, no mesmo commit da troca.
 */

import {
  toGenericAcceptedDto,
  toPublicAuthFailureDto,
  toPublicLoginSuccessDto,
  toPublicLogoutDto,
  toPublicSessionDto,
} from "../contracts/auth-mappers.js";
import type {
  GenericAcceptedDto,
  PublicLogoutDto,
  PublicSessionDto,
} from "../contracts/auth-dto.js";
import type {
  LoginInternalResult,
  SensitiveSessionDelivery,
} from "../contracts/auth-internal.js";
import type {
  ChangePasswordCommand,
  LoginCommand,
  SignupCommand,
} from "../contracts/auth-commands.js";
import { type DomainResult, err, ok } from "../core/result.js";
import { authenticatePassword, buildPasswordChange } from "../auth/credentials.js";
import { buildCredentialRegistration } from "../auth/credentials.js";
import { decideLogin, decideSignup } from "../auth/flows.js";
import {
  buildSessionCreation,
  evaluateSessionAccess,
  planLogout,
  planRevokeAll,
} from "../auth/sessions.js";
import { buildEmailVerificationIssue } from "../auth/verification.js";
import { validatePasswordCandidate } from "../auth/policy.js";
import { GENERIC_LOGIN_FAILURE_MESSAGE, GENERIC_SESSION_FAILURE_MESSAGE } from "../auth/types.js";
import { recordConsent } from "../privacy/consent.js";
import { buildEmailVerificationUrl } from "../email/links.js";
import type { AuthenticatedContext, AuthRuntimeDeps, AuthRequestContext } from "./deps.js";
import { dispatchAuthEmail, type AuthEmailDelivery } from "./dispatch.js";
import { consumeAuthRequestBudget } from "./throttle.js";
import { AuthTransactionAbort, isAuthTransactionAbort } from "./transaction.js";
import { loadAuthenticatedUser } from "./identity-read.js";

/**
 * Resultado de um fluxo que ESTABELECE sessao. Espelha `LoginInternalResult`,
 * mas nomeado para os dois usos (cadastro tambem poderia estabelecer sessao no
 * futuro — hoje nao estabelece, ver `signup`).
 */
export type { LoginInternalResult };

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

/**
 * CADASTRO.
 *
 * Resposta publica: SEMPRE `202` com o corpo generico, exista ou nao o e-mail.
 * E a mesma regra dos pedidos de recuperacao — e aqui ela e ainda mais critica,
 * porque um cadastro que respondesse "e-mail ja em uso" seria um oraculo de
 * existencia consultavel sem nenhuma credencial.
 *
 * O QUE ACONTECE NA MESMA TRANSACAO quando o e-mail e novo: identidade,
 * credencial, aceite dos documentos obrigatorios, consentimentos opcionais,
 * token de verificacao e auditoria. Qualquer recusa aborta tudo — nao existe
 * conta criada sem prova de aceite, nem prova de aceite sem conta.
 *
 * NAO ESTABELECE SESSAO. Cadastrar e autenticar sao decisoes separadas: emitir
 * sessao aqui daria acesso a uma conta cujo e-mail ninguem confirmou ainda.
 *
 * O HASH DA SENHA E CALCULADO FORA DA TRANSACAO (scrypt N=2^15, ~100 ms de CPU
 * sincrona) pela mesma razao ja registrada em `password-recovery.ts`: dentro
 * dela travaria o event loop e prenderia uma conexao do pool.
 */
export async function signup(
  deps: AuthRuntimeDeps,
  command: SignupCommand,
  context: AuthRequestContext,
): Promise<GenericAcceptedDto> {
  const now = deps.now();
  const passwordHash = deps.hashPassword(command.password);
  const preHashedPort = (): string => passwordHash;

  const outcome = await deps.runInTransaction<{
    readonly internalReason: string;
    readonly delivery: AuthEmailDelivery | null;
  }>(async (scope, stores) => {
    const budget = await consumeAuthRequestBudget({
      throttles: stores.throttles,
      scope,
      purpose: "signup",
      emailNormalized: command.emailNormalized,
      clientIpHash: context.clientIpHash,
      now,
    });
    if (budget.locked) {
      return { internalReason: "throttled", delivery: null };
    }

    const existing = await stores.identities.findByNormalizedEmail(
      scope,
      command.emailNormalized,
    );

    const decision = decideSignup({
      emailNormalized: command.emailNormalized,
      emailAlreadyRegistered: existing.kind === "found",
      passwordValidation: validatePasswordCandidate(command.password, command.emailNormalized),
    });
    if (!decision.ok) {
      // O parser ja aplicou a politica; chegar aqui e divergencia entre as duas
      // camadas. Recusa sem detalhe — e sem criar nada.
      return { internalReason: "signup_rejected", delivery: null };
    }
    if (decision.value.action === "notice_existing_email") {
      // E-mail ja registrado. NENHUMA escrita, e a resposta la fora e
      // identica a de um cadastro novo. (Avisar o dono por e-mail que alguem
      // tentou cadastrar com o endereco dele e um fluxo desejavel, mas exige
      // seu proprio orcamento e template — fica registrado como pendencia em
      // docs/product/user-product-identity-privacy.md.)
      return { internalReason: "email_already_registered", delivery: null };
    }

    const created = await stores.identities.create(scope, {
      email: command.email,
      emailNormalized: command.emailNormalized,
      displayName: command.displayName,
    });
    if (created.kind !== "created") {
      // Corrida real: outro cadastro com o mesmo e-mail venceu entre a leitura
      // e a escrita. Continua sendo indistinguivel la fora.
      return { internalReason: "identity_conflict", delivery: null };
    }
    const userId = created.identity.id;

    const credential = buildCredentialRegistration({
      userId,
      password: command.password,
      hashPassword: preHashedPort,
    });
    if (!credential.ok) {
      throw new AuthTransactionAbort("credential_plan_rejected");
    }
    const persisted = await stores.credentials.createInitial(scope, {
      userId,
      passwordHash: credential.value.passwordHash,
      algorithm: credential.value.algorithm,
    });
    if (persisted.kind !== "created") {
      throw new AuthTransactionAbort("credential_conflict");
    }

    // PROVA DE ACEITE, na mesma transacao. A versao e SEMPRE a do servidor.
    for (const kind of ["terms_of_service", "privacy_policy"] as const) {
      const plan = recordConsent({
        userId,
        kind,
        granted: true,
        policyVersion: deps.policyVersions[kind],
        now,
      });
      if (!plan.ok) {
        throw new AuthTransactionAbort("consent_plan_rejected");
      }
      await stores.consents.append(scope, plan.value);
    }

    // Finalidades OPCIONAIS: gravadas SEMPRE, inclusive quando negadas.
    // Registrar o "nao" explicito e o que distingue uma recusa de uma ausencia
    // de resposta — e a ausencia nunca pode ser lida como consentimento.
    for (const [kind, granted] of [
      ["marketing_email", command.acceptedMarketingEmail],
      ["analytics", command.acceptedAnalytics],
    ] as const) {
      const plan = recordConsent({
        userId,
        kind,
        granted,
        policyVersion: deps.policyVersions.privacy_policy,
        now,
      });
      if (!plan.ok) {
        throw new AuthTransactionAbort("consent_plan_rejected");
      }
      await stores.consents.append(scope, plan.value);
    }

    const issue = buildEmailVerificationIssue({
      userId,
      now,
      generateSecret: deps.generateSecret,
      hashSecret: deps.hashSecret,
      ttlMinutes: deps.emailVerificationExpirationMinutes,
    });
    const issued = await stores.authTokens.issue(scope, issue.record);
    if (issued.kind !== "issued") {
      throw new AuthTransactionAbort("token_hash_conflict");
    }

    await stores.audit.append(scope, {
      userId,
      sessionId: null,
      action: "signup",
      ipHash: context.clientIpHash,
      userAgent: context.userAgent,
      detail: null,
      occurredAt: now,
    });

    return {
      internalReason: "signup_completed",
      delivery: {
        to: command.emailNormalized,
        actionUrl: buildEmailVerificationUrl({
          publicAppUrl: deps.publicAppUrl,
          rawToken: issue.rawToken,
        }),
        expiresInMinutes: deps.emailVerificationExpirationMinutes,
      },
    };
  }).catch((error: unknown) => {
    if (!isAuthTransactionAbort(error)) {
      throw error;
    }
    return { internalReason: error.reason, delivery: null };
  });

  // Fora do caminho da resposta: o tempo tambem e canal de enumeracao.
  deps.scheduleDelivery(async () =>
    dispatchAuthEmail({
      provider: deps.emailProvider,
      logger: deps.logger,
      purpose: "email_verification",
      correlationId: context.correlationId,
      internalReason: outcome.internalReason,
      delivery: outcome.delivery,
      durationMs: deps.now().getTime() - now.getTime(),
    }),
  );

  return toGenericAcceptedDto();
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * LOGIN.
 *
 * Precedencia: lockout > (existencia | status | senha), exatamente como
 * `decideLogin` define. Toda falha de credencial produz a MESMA `401`.
 *
 * A VERIFICACAO DA SENHA ACONTECE MESMO QUANDO A CONTA NAO EXISTE. Sem isso, um
 * e-mail inexistente responderia sem pagar o scrypt (~100 ms) e um existente
 * pagaria — uma diferenca de tempo grande o bastante para enumerar contas
 * confortavelmente. O hash-isca tem o mesmo custo do real.
 *
 * A senha e verificada FORA da transacao, antes de abri-la, pela mesma razao de
 * sempre: scrypt sincrono nao pode segurar uma conexao do pool.
 */
export async function login(
  deps: AuthRuntimeDeps,
  command: LoginCommand,
  context: AuthRequestContext,
): Promise<LoginInternalResult> {
  const now = deps.now();

  const resultado = await deps.runInTransaction<{
    readonly internalReason: string;
    readonly delivery: SensitiveSessionDelivery | null;
    readonly userId: bigint | null;
  }>(async (scope, stores) => {
    const budget = await consumeAuthRequestBudget({
      throttles: stores.throttles,
      scope,
      purpose: "login",
      emailNormalized: command.emailNormalized,
      clientIpHash: context.clientIpHash,
      now,
    });

    const lookup = await stores.identities.findByNormalizedEmail(
      scope,
      command.emailNormalized,
    );
    const identity = lookup.kind === "found" ? lookup.identity : null;

    const material =
      identity === null
        ? null
        : await stores.credentials.findForVerification(scope, identity.id);
    const storedHash =
      material !== null && material.kind === "found" ? material.material.passwordHash : null;

    // TIMING: verifica SEMPRE contra um hash com custo real de scrypt. Quando
    // nao ha credencial, a verificacao roda contra a ISCA (`decoyPasswordHash`)
    // e o resultado e descartado — `passwordMatches` so pode ser true se havia
    // um hash real. Sem isto, `authenticatePassword` retornaria `false` sem
    // rodar o KDF para conta inexistente, e a diferenca de tempo (~100 ms)
    // enumeraria contas apesar do corpo de resposta identico.
    const rawMatch = authenticatePassword({
      password: command.password,
      storedHash: storedHash ?? deps.decoyPasswordHash,
      verify: deps.verifyPassword,
    });
    const passwordMatches = storedHash !== null && rawMatch;

    const decision = decideLogin({
      throttleLocked: budget.locked,
      userExists: identity !== null,
      userStatus: identity === null ? null : identity.status,
      passwordMatches,
    });

    if (!decision.publicResult.ok || identity === null) {
      // Auditoria da FALHA. `userId` fica null quando a conta nao existe — a FK
      // e `Restrict` e apontar para uma linha inexistente seria recusado.
      await stores.audit.append(scope, {
        userId: identity?.id ?? null,
        sessionId: null,
        action: decision.internalReason === "throttled" ? "lockout_triggered" : "login_failed",
        ipHash: context.clientIpHash,
        userAgent: context.userAgent,
        detail: { reason: decision.internalReason },
        occurredAt: now,
      });
      return { internalReason: decision.internalReason, delivery: null, userId: null };
    }

    // SESSAO NOVA, SEMPRE. Nenhum identificador apresentado pelo cliente
    // participa: o token nasce aqui, de `generateSecret`.
    const rawSessionToken = deps.generateSecret();
    const rawCsrfToken = deps.generateSecret();

    const record = buildSessionCreation({
      userId: identity.id,
      userStatus: identity.status,
      rawToken: rawSessionToken,
      rawCsrfToken,
      now,
      ttlHours: deps.sessionTtlHours,
      hashSecret: deps.hashSecret,
      ipHash: context.clientIpHash,
      userAgent: context.userAgent,
    });
    if (!record.ok) {
      throw new AuthTransactionAbort("session_plan_rejected");
    }

    const created = await stores.sessions.create(scope, record.value);
    if (created.kind !== "created") {
      throw new AuthTransactionAbort("session_conflict");
    }

    await stores.audit.append(scope, {
      userId: identity.id,
      sessionId: created.sessionId,
      action: "login_succeeded",
      ipHash: context.clientIpHash,
      userAgent: context.userAgent,
      detail: null,
      occurredAt: now,
    });

    return {
      internalReason: "ok",
      delivery: {
        rawSessionToken,
        rawCsrfToken,
        expiresAt: record.value.expiresAt,
      },
      userId: identity.id,
    };
  }).catch((error: unknown) => {
    if (!isAuthTransactionAbort(error)) {
      throw error;
    }
    return { internalReason: error.reason, delivery: null, userId: null };
  });

  if (resultado.delivery === null || resultado.userId === null) {
    return {
      publicDto: toPublicAuthFailureDto({
        code: resultado.internalReason === "throttled" ? "locked_out" : "unauthorized",
        message: GENERIC_LOGIN_FAILURE_MESSAGE,
      }),
      sessionDelivery: null,
      internalReason: resultado.internalReason,
    };
  }

  // Leitura do usuario publico em transacao PROPRIA: a de escrita ja comitou, e
  // manter uma conexao aberta para montar DTO nao traz garantia nenhuma.
  const user = await deps.runInTransaction((scope, stores) =>
    loadAuthenticatedUser(stores, scope, resultado.userId as bigint),
  );
  if (user === null) {
    return {
      publicDto: toPublicAuthFailureDto({
        code: "unauthorized",
        message: GENERIC_LOGIN_FAILURE_MESSAGE,
      }),
      sessionDelivery: null,
      internalReason: "identity_vanished",
    };
  }

  return {
    publicDto: toPublicLoginSuccessDto(user),
    sessionDelivery: resultado.delivery,
    internalReason: "ok",
  };
}

// ---------------------------------------------------------------------------
// Sessao corrente
// ---------------------------------------------------------------------------

/**
 * Resolve a sessao apresentada no cookie. E o UNICO caminho de autenticacao do
 * produto — nenhuma rota interpreta cookie por conta propria.
 *
 * Fail-closed em todos os ramos: token ausente, sessao inexistente, revogada,
 * expirada ou de conta inelegivel devolvem `null`. A distincao entre elas fica
 * so no motivo interno de `evaluateSessionAccess`.
 *
 * NAO faz `touch`/`lastUsedAt`: o port nao o expoe (nenhuma funcao pura o
 * produz), e escrever a cada leitura tornaria toda pagina autenticada uma
 * escrita.
 */
export async function resolveAuthenticatedContext(
  deps: AuthRuntimeDeps,
  rawSessionToken: string | null,
): Promise<AuthenticatedContext | null> {
  if (rawSessionToken === null || rawSessionToken.length === 0) {
    return null;
  }
  const now = deps.now();
  const tokenHash = deps.hashSecret(rawSessionToken);

  return deps.runInTransaction(async (scope, stores) => {
    const lookup = await stores.sessions.findByTokenHash(scope, tokenHash);
    if (lookup.kind !== "found") {
      return null;
    }
    const session = lookup.session;

    const owner = await stores.identities.findById(scope, session.userId);
    const status = owner.kind === "found" ? owner.identity.status : null;

    const decision = evaluateSessionAccess({
      now,
      session: { expiresAt: session.expiresAt, revokedAt: session.revokedAt },
      userStatus: status,
    });
    if (!decision.publicResult.ok || status === null) {
      return null;
    }

    return {
      userId: session.userId,
      sessionId: session.id,
      userStatus: status,
      csrfTokenHash: session.csrfTokenHash,
    };
  });
}

/** Leitura publica da sessao. `authenticated=false` nunca revela o porque. */
export async function readCurrentSession(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext | null,
): Promise<PublicSessionDto> {
  if (authenticated === null) {
    return toPublicSessionDto(null);
  }
  const user = await deps.runInTransaction((scope, stores) =>
    loadAuthenticatedUser(stores, scope, authenticated.userId),
  );
  return toPublicSessionDto(user);
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/**
 * LOGOUT de uma sessao. Idempotente: revogar sessao ja revogada nao e erro —
 * `planLogout` diz isso e o adapter conta 0 sem reclamar.
 */
export async function logout(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  context: AuthRequestContext,
): Promise<PublicLogoutDto> {
  const now = deps.now();
  const plan = planLogout({ currentSessionId: authenticated.sessionId });

  await deps.runInTransaction(async (scope, stores) => {
    await stores.sessions.revoke(scope, { sessionIds: plan.revokeSessionIds, now });
    await stores.audit.append(scope, {
      userId: authenticated.userId,
      sessionId: authenticated.sessionId,
      action: "logout",
      ipHash: context.clientIpHash,
      userAgent: context.userAgent,
      detail: null,
      occurredAt: now,
    });
  });

  return toPublicLogoutDto();
}

/**
 * LOGOUT GLOBAL — derruba TODAS as sessoes, inclusive a corrente.
 *
 * `exceptSessionId: null` de proposito: "sair de todos os dispositivos" e a
 * acao de quem suspeita de acesso indevido, e preservar a sessao que pediu
 * deixaria viva justamente a que pode ser a do invasor. O usuario reautentica.
 */
export async function logoutAll(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  context: AuthRequestContext,
): Promise<PublicLogoutDto> {
  const now = deps.now();

  await deps.runInTransaction(async (scope, stores) => {
    const activeSessionIds = await stores.sessions.listActiveIds(scope, {
      userId: authenticated.userId,
      now,
    });
    const plan = planRevokeAll({ activeSessionIds, exceptSessionId: null });
    await stores.sessions.revoke(scope, { sessionIds: plan.revokeSessionIds, now });
    await stores.audit.append(scope, {
      userId: authenticated.userId,
      sessionId: authenticated.sessionId,
      action: "all_sessions_revoked",
      ipHash: context.clientIpHash,
      userAgent: context.userAgent,
      detail: { revoked: plan.revokeSessionIds.length },
      occurredAt: now,
    });
  });

  return toPublicLogoutDto();
}

// ---------------------------------------------------------------------------
// Troca de senha autenticada
// ---------------------------------------------------------------------------

/**
 * TROCA DE SENHA com sessao valida.
 *
 * Exige a senha ATUAL — sessao sozinha nao basta. Uma sessao roubada nao pode
 * virar posse permanente da conta trocando a senha sem conhece-la.
 *
 * Revoga TODAS as sessoes, inclusive a que pediu (`buildPasswordChange` nao
 * oferece excecao). Quem trocou reautentica; quem havia roubado perde o acesso.
 */
export async function changePassword(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  command: ChangePasswordCommand,
  context: AuthRequestContext,
): Promise<DomainResult<{ readonly changed: true }>> {
  const now = deps.now();
  // Fora da transacao: scrypt sincrono (~100 ms) nao segura conexao do pool.
  const nextPasswordHash = deps.hashPassword(command.newPassword);
  const preHashedPort = (): string => nextPasswordHash;

  let internalReason: string;
  try {
    internalReason = await deps.runInTransaction<string>(async (scope, stores) => {
      const material = await stores.credentials.findForVerification(
        scope,
        authenticated.userId,
      );
      if (material.kind !== "found") {
        throw new AuthTransactionAbort("credential_not_found");
      }

      const currentMatches = authenticatePassword({
        password: command.currentPassword,
        storedHash: material.material.passwordHash,
        verify: deps.verifyPassword,
      });
      if (!currentMatches) {
        await stores.audit.append(scope, {
          userId: authenticated.userId,
          sessionId: authenticated.sessionId,
          action: "login_failed",
          ipHash: context.clientIpHash,
          userAgent: context.userAgent,
          detail: { reason: "change_password_wrong_current" },
          occurredAt: now,
        });
        throw new AuthTransactionAbort("wrong_current_password");
      }

      const activeSessionIds = await stores.sessions.listActiveIds(scope, {
        userId: authenticated.userId,
        now,
      });

      const plan = buildPasswordChange({
        userId: authenticated.userId,
        newPassword: command.newPassword,
        hashPassword: preHashedPort,
        activeSessionIds,
      });
      if (!plan.ok) {
        throw new AuthTransactionAbort("password_plan_rejected");
      }

      const replaced = await stores.credentials.replaceByPreimage(scope, {
        userId: authenticated.userId,
        expectedPasswordHash: material.material.passwordHash,
        nextPasswordHash: plan.value.credential.passwordHash,
        nextAlgorithm: plan.value.credential.algorithm,
      });
      if (replaced.kind !== "updated") {
        throw new AuthTransactionAbort(
          replaced.kind === "not_found" ? "credential_not_found" : "credential_stale_preimage",
        );
      }

      await stores.sessions.revoke(scope, { sessionIds: plan.value.revokeSessionIds, now });

      // Tokens de reset pendentes tambem morrem: quem trocou a senha nao pode
      // deixar um link antigo capaz de troca-la de novo.
      await stores.authTokens.invalidatePending(scope, {
        userId: authenticated.userId,
        purpose: "password_reset",
        now,
      });

      await stores.audit.append(scope, {
        userId: authenticated.userId,
        sessionId: authenticated.sessionId,
        action: "password_changed",
        ipHash: context.clientIpHash,
        userAgent: context.userAgent,
        detail: null,
        occurredAt: now,
      });

      return "password_changed";
    });
  } catch (error) {
    if (!isAuthTransactionAbort(error)) {
      throw error;
    }
    internalReason = error.reason;
  }

  if (internalReason !== "password_changed") {
    // Mensagem UNICA para senha atual errada e para credencial ausente: a
    // diferenca so interessa a auditoria.
    return err("unauthorized", GENERIC_SESSION_FAILURE_MESSAGE);
  }
  return ok({ changed: true as const });
}
