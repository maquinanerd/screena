/**
 * SERVICOS DE APLICACAO da recuperacao de senha (Backend C, C7C).
 *
 * Mesmas regras da verificacao: decisores puros decidem, ports persistem, o
 * fornecedor e chamado FORA da transacao e a resposta publica do PEDIDO e sempre
 * a mesma. A diferenca esta na CONFIRMACAO, que e um evento sensivel: troca a
 * senha, derruba todas as sessoes e queima os demais links de reset pendentes —
 * tudo na MESMA transacao.
 */

import { toGenericAcceptedDto } from "../contracts/auth-mappers.js";
import type { GenericAcceptedDto } from "../contracts/auth-dto.js";
import type {
  ConsumePasswordRecoveryCommand,
  RequestPasswordRecoveryCommand,
} from "../contracts/auth-commands.js";
import { type DomainResult, err, ok } from "../core/result.js";
import { applyPasswordReset, buildPasswordResetIssue, evaluatePasswordResetRequest } from "../auth/recovery.js";
import { GENERIC_TOKEN_FAILURE_MESSAGE } from "../auth/types.js";
import { buildPasswordResetUrl } from "../email/links.js";
import type { AuthEmailRuntimeDeps, AuthRequestContext } from "./deps.js";
import { dispatchAuthEmail, logAuthEmailEvent, type AuthEmailDelivery } from "./dispatch.js";
import { consumeAuthRequestBudget } from "./throttle.js";
import { AuthTransactionAbort, isAuthTransactionAbort } from "./transaction.js";

const PURPOSE = "password_reset" as const;

interface RequestOutcome {
  readonly internalReason: string;
  readonly delivery: AuthEmailDelivery | null;
}

/**
 * PEDIDO de recuperacao de senha.
 *
 * Resposta publica IDENTICA em todos os casos: conta existente, inexistente,
 * desativada, anonimizada, pedido barrado por throttle e fornecedor fora do ar
 * produzem `202` com o mesmo corpo. Nenhum token, `messageId`, `userId`, status
 * ou motivo interno atravessa para fora.
 *
 * NAO invalida tokens pendentes aqui. `evaluatePasswordResetRequest` nao pede
 * isso, e queimar os anteriores a cada pedido daria a qualquer pessoa que saiba
 * um e-mail o poder de invalidar o link legitimo que o dono acabou de receber.
 * A invalidacao em lote acontece na CONFIRMACAO, onde `applyPasswordReset` a
 * exige.
 */
export async function requestPasswordRecovery(
  deps: AuthEmailRuntimeDeps,
  command: RequestPasswordRecoveryCommand,
  context: AuthRequestContext,
): Promise<GenericAcceptedDto> {
  const now = deps.now();

  const outcome = await deps.runInTransaction<RequestOutcome>(async (scope, stores) => {
    const budget = await consumeAuthRequestBudget({
      throttles: stores.throttles,
      scope,
      purpose: PURPOSE,
      emailNormalized: command.emailNormalized,
      clientIpHash: context.clientIpHash,
      now,
    });
    if (budget.locked) {
      return { internalReason: "throttled", delivery: null };
    }

    const lookup = await stores.identities.findByNormalizedEmail(scope, command.emailNormalized);
    const identity = lookup.kind === "found" ? lookup.identity : null;

    const decision = evaluatePasswordResetRequest({
      userExists: identity !== null,
      userStatus: identity === null ? null : identity.status,
    });
    if (decision.internalReason !== "issue_token" || identity === null) {
      return { internalReason: decision.internalReason, delivery: null };
    }

    const issue = buildPasswordResetIssue({
      userId: identity.id,
      now,
      generateSecret: deps.generateSecret,
      hashSecret: deps.hashSecret,
      ttlMinutes: deps.passwordResetExpirationMinutes,
    });

    const issued = await stores.authTokens.issue(scope, issue.record);
    if (issued.kind !== "issued") {
      return { internalReason: "token_hash_conflict", delivery: null };
    }

    return {
      internalReason: decision.internalReason,
      delivery: {
        to: command.emailNormalized,
        actionUrl: buildPasswordResetUrl({
          publicAppUrl: deps.publicAppUrl,
          rawToken: issue.rawToken,
        }),
        expiresInMinutes: deps.passwordResetExpirationMinutes,
      },
    };
  });

  // FORA do caminho da resposta: ver `scheduleDelivery` em deps.ts. A resposta
  // publica sai com o MESMO tempo exista ou nao conta, e independentemente de o
  // fornecedor estar lento ou fora do ar.
  deps.scheduleDelivery(async () =>
    dispatchAuthEmail({
      provider: deps.emailProvider,
      logger: deps.logger,
      purpose: PURPOSE,
      correlationId: context.correlationId,
      internalReason: outcome.internalReason,
      delivery: outcome.delivery,
      durationMs: deps.now().getTime() - now.getTime(),
    }),
  );

  return toGenericAcceptedDto();
}

/**
 * CONFIRMACAO da recuperacao: troca a senha e derruba tudo.
 *
 * Passos, todos na MESMA transacao:
 *   1. consumir o token de `password_reset` (atomico, uso unico);
 *   2. checar a elegibilidade da conta pelo `userId` revelado no consumo;
 *   3. listar as sessoes ativas (insumo obrigatorio de `applyPasswordReset`);
 *   4. ler a PRE-IMAGEM do hash atual;
 *   5. trocar a senha por compare-and-swap sobre essa pre-imagem;
 *   6. revogar TODAS as sessoes;
 *   7. queimar os demais tokens de reset pendentes.
 *
 * Qualquer recusa depois do passo 1 ABORTA a transacao — devolvendo o token ao
 * estado pendente em vez de queima-lo sem trocar senha nenhuma.
 *
 * A senha nova ja passou pela politica no parser
 * (`parseConsumePasswordRecoveryCommand` chama `validatePasswordCandidate`); ela
 * nunca e logada e nunca sai deste escopo em texto claro.
 */
export async function confirmPasswordRecovery(
  deps: AuthEmailRuntimeDeps,
  command: ConsumePasswordRecoveryCommand,
  context: AuthRequestContext,
): Promise<DomainResult<{ readonly confirmed: true }>> {
  const now = deps.now();
  const tokenHash = deps.hashSecret(command.token);

  // O HASH DA SENHA E CALCULADO FORA DA TRANSACAO, de proposito.
  //
  // `hashPassword` e scrypt com N=2^15: ~100 ms de CPU SINCRONA e dezenas de MB.
  // Dentro da transacao isso (a) travaria o event loop do processo Node,
  // atrasando toda requisicao em voo, inclusive render, e (b) manteria uma
  // conexao do pool presa por esse tempo, aproximando o timeout de transacao
  // interativa do Prisma (P2028) — a MESMA razao pela qual a chamada ao
  // fornecedor tambem fica fora (ver dispatch.ts).
  //
  // O hash depende SO da senha, nunca do `userId`, entao antecipa-lo nao muda
  // resultado nenhum: `buildCredentialRegistration` deriva `algorithm` do
  // prefixo do proprio PHC. A porta injetada abaixo devolve este valor ja
  // pronto, mantendo a construcao da credencial no dominio.
  const nextPasswordHash = deps.hashPassword(command.newPassword);
  const preHashedPort = (): string => nextPasswordHash;

  let internalReason: string;
  try {
    internalReason = await deps.runInTransaction<string>(async (scope, stores) => {
      const consumed = await stores.authTokens.consume(scope, {
        tokenHash,
        purpose: PURPOSE,
        now,
      });
      if (consumed.kind !== "consumed") {
        return consumed.kind;
      }
      const userId = consumed.userId;

      const owner = await stores.identities.findById(scope, userId);
      if (owner.kind !== "found") {
        throw new AuthTransactionAbort("identity_not_found");
      }
      // MESMO predicado do resto da autenticacao: so conta `active` troca senha.
      // Uma conta desativada ou anonimizada com um link antigo em maos nao pode
      // recuperar acesso.
      const eligibility = evaluatePasswordResetRequest({
        userExists: true,
        userStatus: owner.identity.status,
      });
      if (eligibility.internalReason !== "issue_token") {
        throw new AuthTransactionAbort(eligibility.internalReason);
      }

      const activeSessionIds = await stores.sessions.listActiveIds(scope, { userId, now });

      const material = await stores.credentials.findForVerification(scope, userId);
      if (material.kind !== "found") {
        // Conta sem credencial de senha (ex.: futura conta so-OAuth). Nao ha o
        // que trocar; abortar preserva o token para nao queimar nada a toa.
        throw new AuthTransactionAbort("credential_not_found");
      }

      const plan = applyPasswordReset({
        userId,
        newPassword: command.newPassword,
        // Porta que devolve o hash JA calculado antes da transacao. Nenhum
        // scrypt roda aqui dentro.
        hashPassword: preHashedPort,
        activeSessionIds,
      });
      if (!plan.ok) {
        throw new AuthTransactionAbort("password_plan_rejected");
      }

      const replaced = await stores.credentials.replaceByPreimage(scope, {
        userId,
        // A pre-imagem e o hash que acabamos de ler DENTRO desta transacao. Se
        // outra troca vencer a corrida, o CAS falha e nada e sobrescrito.
        expectedPasswordHash: material.material.passwordHash,
        nextPasswordHash: plan.value.credentialChange.credential.passwordHash,
        nextAlgorithm: plan.value.credentialChange.credential.algorithm,
      });
      if (replaced.kind !== "updated") {
        throw new AuthTransactionAbort(
          replaced.kind === "not_found" ? "credential_not_found" : "credential_stale_preimage",
        );
      }

      // Evento sensivel: derruba TODAS as sessoes, sem excecao. Quem trocou a
      // senha reautentica; quem tinha roubado a sessao perde o acesso.
      await stores.sessions.revoke(scope, { sessionIds: plan.value.revokeSessionIds, now });

      // `applyPasswordReset` devolve `invalidateAllPendingResetTokens: true`:
      // trocada a senha, nenhum outro link de reset pode continuar valendo.
      if (plan.value.invalidateAllPendingResetTokens) {
        await stores.authTokens.invalidatePending(scope, { userId, purpose: PURPOSE, now });
      }

      return "password_reset_completed";
    });
  } catch (error) {
    if (!isAuthTransactionAbort(error)) {
      throw error;
    }
    internalReason = error.reason;
  }

  const confirmed = internalReason === "password_reset_completed";

  logAuthEmailEvent(deps.logger, {
    correlationId: context.correlationId,
    purpose: PURPOSE,
    provider: null,
    outcome: confirmed ? "confirmed" : "rejected",
    internalReason,
    durationMs: deps.now().getTime() - now.getTime(),
    failureCategory: null,
    providerMessageId: null,
  });

  return confirmed
    ? ok({ confirmed: true as const })
    : err("unauthorized", GENERIC_TOKEN_FAILURE_MESSAGE);
}
