/**
 * SERVICOS DE APLICACAO da verificacao de e-mail (Backend C, C7C).
 *
 * Orquestram o que ja existe: decisores puros (`auth/verification.ts`), ports de
 * persistencia (C7B) e o port de e-mail. NAO decidem regra de negocio, NAO
 * chamam relogio global, NAO abrem conexao e NAO conhecem HTTP.
 *
 * ORDEM CANONICA DO PEDIDO (secao 14 da missao):
 *   validar (parser, ja feito) -> throttle -> localizar identidade -> dominio
 *   decide -> gerar token cru -> hashear -> persistir em transacao CURTA ->
 *   COMMIT -> montar link -> chamar o fornecedor -> registrar -> responder.
 *
 * A chamada ao fornecedor acontece DEPOIS do commit, nunca dentro da transacao.
 */

import { toGenericAcceptedDto } from "../contracts/auth-mappers.js";
import type { GenericAcceptedDto } from "../contracts/auth-dto.js";
import type {
  ConsumeEmailVerificationCommand,
  RequestEmailVerificationCommand,
} from "../contracts/auth-commands.js";
import { type DomainResult, err, ok } from "../core/result.js";
import {
  applyEmailVerification,
  buildEmailVerificationIssue,
  evaluateVerificationResend,
} from "../auth/verification.js";
import { GENERIC_TOKEN_FAILURE_MESSAGE } from "../auth/types.js";
import { buildEmailVerificationUrl } from "../email/links.js";
import type { EmailVerificationState } from "../persistence/types.js";
import type { AuthEmailRuntimeDeps, AuthRequestContext } from "./deps.js";
import { dispatchAuthEmail, logAuthEmailEvent, type AuthEmailDelivery } from "./dispatch.js";
import { consumeAuthRequestBudget } from "./throttle.js";
import { AuthTransactionAbort, isAuthTransactionAbort } from "./transaction.js";

const PURPOSE = "email_verification" as const;

interface RequestOutcome {
  readonly internalReason: string;
  readonly delivery: AuthEmailDelivery | null;
}

/**
 * PEDIDO de (re)envio da verificacao de e-mail.
 *
 * A resposta publica e SEMPRE a mesma — conta inexistente, desativada,
 * anonimizada, ja verificada, elegivel, throttled ou fornecedor fora do ar
 * produzem `202` com o mesmo corpo generico. E por isso que esta funcao devolve
 * um DTO e nao um `DomainResult`: nao ha ramo de erro publico a expressar.
 */
export async function requestEmailVerification(
  deps: AuthEmailRuntimeDeps,
  command: RequestEmailVerificationCommand,
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
      // Barrado ANTES de qualquer leitura de identidade: um pedido bloqueado nao
      // deve nem sequer tocar a tabela de usuarios.
      return { internalReason: "throttled", delivery: null };
    }

    const lookup = await stores.identities.findEmailVerificationStateByNormalizedEmail(
      scope,
      command.emailNormalized,
    );
    const state: EmailVerificationState | null = lookup.kind === "found" ? lookup.state : null;

    // `alreadyVerified` e derivado do CARIMBO aqui, e nao no adapter: o port
    // entrega o fato (`emailVerifiedAt`), e a conclusao e politica do dominio.
    const decision = evaluateVerificationResend({
      userExists: state !== null,
      userStatus: state === null ? null : state.status,
      alreadyVerified: state !== null && state.emailVerifiedAt !== null,
    });
    if (decision.internalReason !== "issue_token" || state === null) {
      return { internalReason: decision.internalReason, delivery: null };
    }

    const issue = buildEmailVerificationIssue({
      userId: state.userId,
      now,
      generateSecret: deps.generateSecret,
      hashSecret: deps.hashSecret,
      ttlMinutes: deps.emailVerificationExpirationMinutes,
    });

    const issued = await stores.authTokens.issue(scope, issue.record);
    if (issued.kind !== "issued") {
      // Colisao do unique de `token_hash`. Astronomicamente improvavel com 256
      // bits, mas o contrato a representa — e nao ha link a enviar sem token.
      return { internalReason: "token_hash_conflict", delivery: null };
    }

    return {
      internalReason: decision.internalReason,
      delivery: {
        to: command.emailNormalized,
        actionUrl: buildEmailVerificationUrl({
          publicAppUrl: deps.publicAppUrl,
          rawToken: issue.rawToken,
        }),
        expiresInMinutes: deps.emailVerificationExpirationMinutes,
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
 * CONFIRMACAO da verificacao de e-mail.
 *
 * Ordem obrigatoria dentro de UMA transacao: consumir o token (atomico) ->
 * carregar a identidade pelo `userId` que o consumo revelou -> aplicar a
 * politica de status -> marcar o carimbo SOMENTE se elegivel.
 *
 * Se a politica recusar depois do consumo, a transacao e ABORTADA de proposito:
 * sem isso o consumo comitaria e o link de uma conta inelegivel ficaria queimado
 * sem nada ter sido verificado. Reabilitada a conta, o MESMO link volta a valer.
 *
 * Toda recusa — token inexistente, expirado, ja usado, de proposito errado, ou
 * conta inelegivel — devolve a MESMA mensagem generica. Uma mensagem propria
 * para "conta inelegivel" transformaria esta rota num oraculo: quem tivesse um
 * token qualquer distinguiria "token ruim" de "a conta existe mas esta
 * desativada".
 */
export async function confirmEmailVerification(
  deps: AuthEmailRuntimeDeps,
  command: ConsumeEmailVerificationCommand,
  context: AuthRequestContext,
): Promise<DomainResult<{ readonly confirmed: true }>> {
  const now = deps.now();
  // O token CRU vira hash aqui e nao vai a lugar nenhum alem disto.
  const tokenHash = deps.hashSecret(command.token);

  let internalReason: string;
  try {
    internalReason = await deps.runInTransaction<string>(async (scope, stores) => {
      const consumed = await stores.authTokens.consume(scope, {
        tokenHash,
        purpose: PURPOSE,
        now,
      });
      if (consumed.kind !== "consumed") {
        // Nada foi escrito: nao ha o que abortar. Os quatro motivos
        // (`not_found`, `wrong_purpose`, `expired`, `already_consumed`) sao
        // rotulos de auditoria; a resposta publica e uma so.
        return consumed.kind;
      }

      const owner = await stores.identities.findById(scope, consumed.userId);
      const status = owner.kind === "found" ? owner.identity.status : null;

      // `currentEmailVerifiedAt: null` de proposito: `IdentityLookupResult` nao
      // carrega o carimbo, e nao precisa. A idempotencia real e garantida
      // ATOMICAMENTE por `markEmailVerified`, cuja pre-condicao
      // (`emailVerifiedAt: null`) preserva o primeiro carimbo. Ler o carimbo
      // aqui para decidir em memoria reabriria a janela que essa pre-condicao
      // fecha.
      const decision = applyEmailVerification({
        now,
        userStatus: status,
        currentEmailVerifiedAt: null,
      });
      if (!decision.publicResult.ok) {
        throw new AuthTransactionAbort(decision.internalReason);
      }

      const marked = await stores.identities.markEmailVerified(scope, {
        userId: consumed.userId,
        now,
      });
      if (marked.kind === "not_found") {
        // A identidade sumiu entre o consumo e a marcacao. Abortar devolve o
        // token ao estado pendente em vez de queima-lo por um estado impossivel.
        throw new AuthTransactionAbort("identity_not_found");
      }
      return marked.kind;
    });
  } catch (error) {
    if (!isAuthTransactionAbort(error)) {
      throw error;
    }
    internalReason = error.reason;
  }

  const confirmed = internalReason === "verified" || internalReason === "already_verified";

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
