/**
 * HANDLERS HTTP da autenticacao por e-mail (Backend C, C7C).
 *
 * TRANSPORT-AGNOSTIC de proposito: `(Request) => Promise<Response>`, sem
 * Next.js, sem Express, sem cookie. As rotas do app publico sao arquivos de
 * TRES linhas que delegam para ca — assim toda a logica de borda fica sob a
 * suite de testes do monorepo (que nao roda `apps/web`), e trocar de framework
 * nao toca uma regra.
 *
 * NENHUMA POLITICA MORA AQUI. O handler faz quatro coisas: le a requisicao com
 * fail-closed, parseia o comando com os parsers ja existentes de `contracts/`,
 * chama o servico de aplicacao e traduz o resultado em resposta. Elegibilidade,
 * throttle, anti-enumeracao, transacao e envio pertencem a `auth-runtime/`.
 *
 * REGRA DE OURO DESTA BORDA: os dois endpoints de PEDIDO respondem sempre `202`
 * com o mesmo corpo. Nao existe caminho neste arquivo em que a existencia de uma
 * conta mude status, corpo ou cabecalho.
 */

import {
  parseConsumeEmailVerificationCommand,
  parseConsumePasswordRecoveryCommand,
  parseRequestEmailVerificationCommand,
  parseRequestPasswordRecoveryCommand,
} from "../contracts/auth-commands.js";
import type { DomainResult } from "../core/result.js";
import {
  confirmEmailVerification,
  requestEmailVerification,
} from "../auth-runtime/email-verification.js";
import {
  confirmPasswordRecovery,
  requestPasswordRecovery,
} from "../auth-runtime/password-recovery.js";
import type { AuthEmailRuntimeDeps, AuthRequestContext } from "../auth-runtime/deps.js";
import { readClientIp, readJsonBody, resolveCorrelationId } from "./request.js";
import {
  acceptedResponse,
  confirmedResponse,
  malformedRequestResponse,
  methodNotAllowedResponse,
  tokenRejectedResponse,
  unexpectedFailureResponse,
  validationFailedResponse,
} from "./responses.js";

export interface AuthHttpDeps {
  readonly runtime: AuthEmailRuntimeDeps;
  /** sha256 do IP com sal de servidor. So esta borda ve o endereco cru. */
  readonly hashClientIp: (ip: string) => string;
  /** Correlacao gerada localmente quando o cliente nao manda uma valida. */
  readonly newCorrelationId: () => string;
  /**
   * Aviso de falha inesperada. Recebe SO o identificador de correlacao — nunca o
   * objeto de erro. Uma excecao de driver pode citar parametros de query, e um
   * deles pode ser o hash de um token; repassar o erro tornaria o log um canal
   * de vazamento fora do alcance de qualquer varredura de fonte. O custo
   * (perder a stack) e deliberado e esta registrado na documentacao.
   */
  readonly onUnexpectedError?: (correlationId: string) => void;
}

/** Os quatro endpoints, prontos para uma rota delegar. */
export interface AuthHttpHandlers {
  readonly requestPasswordReset: (request: Request) => Promise<Response>;
  readonly confirmPasswordReset: (request: Request) => Promise<Response>;
  readonly requestEmailVerification: (request: Request) => Promise<Response>;
  readonly confirmEmailVerification: (request: Request) => Promise<Response>;
}

function buildContext(deps: AuthHttpDeps, request: Request): AuthRequestContext {
  const clientIp = readClientIp(request);
  return {
    correlationId: resolveCorrelationId(request, deps.newCorrelationId()),
    // O endereco cru vira hash AQUI e nao atravessa. `clientIpHash` e o unico
    // formato que as camadas seguintes conhecem.
    clientIpHash: clientIp === null ? null : deps.hashClientIp(clientIp),
  };
}

/**
 * Casca comum: le o corpo, parseia e delega. Centraliza o `try` para que NENHUM
 * endpoint possa esquecer de conter uma excecao — um 500 com stack so nos casos
 * em que houve trabalho de verdade seria, por si so, um sinal observavel.
 */
async function handle<TCommand>(
  deps: AuthHttpDeps,
  request: Request,
  parse: (input: unknown) => DomainResult<TCommand>,
  run: (command: TCommand, context: AuthRequestContext) => Promise<Response>,
): Promise<Response> {
  const context = buildContext(deps, request);
  try {
    const body = await readJsonBody(request);
    if (body.kind === "method_not_allowed") {
      return methodNotAllowedResponse();
    }
    if (body.kind === "malformed") {
      return malformedRequestResponse();
    }

    const command = parse(body.value);
    if (!command.ok) {
      // `details` vem dos parsers de `contracts/`: descrevem FORMATO, nunca
      // valor. Ausente, cai numa lista vazia — nunca no texto do erro interno.
      return validationFailedResponse(command.error.details ?? []);
    }

    return await run(command.value, context);
  } catch {
    deps.onUnexpectedError?.(context.correlationId);
    return unexpectedFailureResponse();
  }
}

function confirmationResponse(result: DomainResult<{ readonly confirmed: true }>): Response {
  return result.ok ? confirmedResponse() : tokenRejectedResponse();
}

export function createAuthHttpHandlers(deps: AuthHttpDeps): AuthHttpHandlers {
  return {
    async requestPasswordReset(request: Request): Promise<Response> {
      return handle(
        deps,
        request,
        parseRequestPasswordRecoveryCommand,
        async (command, context) =>
          acceptedResponse(await requestPasswordRecovery(deps.runtime, command, context)),
      );
    },

    async confirmPasswordReset(request: Request): Promise<Response> {
      return handle(
        deps,
        request,
        parseConsumePasswordRecoveryCommand,
        async (command, context) =>
          confirmationResponse(await confirmPasswordRecovery(deps.runtime, command, context)),
      );
    },

    async requestEmailVerification(request: Request): Promise<Response> {
      return handle(
        deps,
        request,
        parseRequestEmailVerificationCommand,
        async (command, context) =>
          acceptedResponse(await requestEmailVerification(deps.runtime, command, context)),
      );
    },

    async confirmEmailVerification(request: Request): Promise<Response> {
      return handle(
        deps,
        request,
        parseConsumeEmailVerificationCommand,
        async (command, context) =>
          confirmationResponse(await confirmEmailVerification(deps.runtime, command, context)),
      );
    },
  };
}
