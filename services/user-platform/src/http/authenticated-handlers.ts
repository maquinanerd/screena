/**
 * BORDA HTTP autenticada (Backend C, C7D).
 *
 * Mesma forma da borda de e-mail: `(Request) => Promise<Response>`, sem
 * Next.js, sem Express. As rotas do app publico continuam sendo arquivos de
 * tres linhas.
 *
 * QUATRO GARANTIAS SAO APLICADAS AQUI, E EM UM LUGAR SO:
 *
 *  1. AUTENTICACAO. `resolveAuthenticatedContext` e o UNICO caminho — nenhuma
 *     rota interpreta cookie por conta propria. Presenca de cookie nao e prova:
 *     a sessao e buscada, e `evaluateSessionAccess` decide (expirada, revogada
 *     e conta inelegivel falham fechado).
 *
 *  2. CSRF. Toda MUTACAO passa por `requireCsrf` contra o `csrfTokenHash`
 *     daquela sessao. Leitura nao exige (nao muda estado); mutacao exige sempre.
 *
 *  3. OWNERSHIP. Nenhum handler le `userId` do corpo ou da URL. O titular vem
 *     do contexto autenticado, entao nao existe caminho por onde um cliente
 *     escolha de quem e o dado — nao e uma checagem que alguem possa esquecer,
 *     e a ausencia do parametro.
 *
 *  4. FAIL-CLOSED. Excecao inesperada nunca escapa: vira 500 de corpo fixo, sem
 *     stack, sem mensagem de driver.
 */

import {
  parseRequestClosureCommand,
  parseSetConsentCommand,
  parseUpdateProfileCommand,
} from "../contracts/account-commands.js";
import { parseChangePasswordCommand } from "../contracts/auth-commands.js";
import { requireCsrf } from "../core/request-guards.js";
import type { DomainResult } from "../core/result.js";
import {
  changePassword,
  login,
  logout,
  logoutAll,
  readCurrentSession,
  resolveAuthenticatedContext,
  signup,
} from "../auth-runtime/account.js";
import {
  readPrivacyState,
  readProfile,
  requestAccountClosure,
  requestDataExport,
  setConsent,
  updateProfile,
} from "../auth-runtime/privacy-services.js";
import { parseLoginCommand, parseSignupCommand } from "../contracts/auth-commands.js";
import type { AuthenticatedContext, AuthRequestContext, AuthRuntimeDeps } from "../auth-runtime/deps.js";
import {
  buildClearedSessionCookies,
  buildSessionCookies,
  readPresentedCsrfToken,
  readSessionToken,
} from "./cookies.js";
import { readClientIp, readJsonBody, readUserAgent, resolveCorrelationId } from "./request.js";
import {
  AUTH_SECURITY_HEADERS,
  acceptedResponse,
  malformedRequestResponse,
  methodNotAllowedResponse,
  unexpectedFailureResponse,
  validationFailedResponse,
} from "./responses.js";

export interface AuthenticatedHttpDeps {
  readonly runtime: AuthRuntimeDeps;
  readonly hashClientIp: (ip: string) => string;
  readonly newCorrelationId: () => string;
  readonly onUnexpectedError?: (correlationId: string) => void;
}

/** Resposta JSON com os cabecalhos de seguranca e, opcionalmente, cookies. */
function jsonResponse(
  status: number,
  body: unknown,
  cookies: readonly string[] = [],
): Response {
  const headers = new Headers({ ...AUTH_SECURITY_HEADERS });
  // `append`, nunca `set`: sao DOIS (ou quatro) `Set-Cookie` e um `set`
  // sobrescreveria o anterior, deixando o login sem token CSRF.
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Recusa generica de autenticacao (401).
 *
 * Sempre o MESMO corpo para: sem cookie, sessao inexistente, expirada,
 * revogada e conta inelegivel. A causa fica no motivo interno de
 * `evaluateSessionAccess`, nunca na resposta.
 */
function unauthenticatedResponse(): Response {
  return jsonResponse(401, {
    ok: false,
    code: "unauthorized",
    message: "sessao invalida ou expirada.",
  });
}

function csrfRejectedResponse(): Response {
  return jsonResponse(403, {
    ok: false,
    code: "csrf_mismatch",
    message: "requisicao nao autorizada.",
  });
}

function failureResponse(error: DomainResult<unknown> & { ok: false }): Response {
  const status =
    error.error.code === "unauthorized"
      ? 401
      : error.error.code === "forbidden"
        ? 403
        : error.error.code === "not_found"
          ? 404
          : error.error.code === "conflict"
            ? 409
            : error.error.code === "rate_limited" || error.error.code === "locked_out"
              ? 429
              : error.error.code === "precondition_failed"
                ? 412
                : 400;
  return jsonResponse(status, {
    ok: false,
    code: error.error.code,
    message: error.error.message,
  });
}

function buildContext(deps: AuthenticatedHttpDeps, request: Request): AuthRequestContext {
  const clientIp = readClientIp(request);
  return {
    correlationId: resolveCorrelationId(request, deps.newCorrelationId()),
    clientIpHash: clientIp === null ? null : deps.hashClientIp(clientIp),
    userAgent: readUserAgent(request),
  };
}

/**
 * Casca das MUTACOES autenticadas: metodo -> corpo -> sessao -> CSRF -> parse.
 *
 * A ORDEM importa. O CSRF e conferido ANTES do parse do comando para que um
 * pedido forjado nunca chegue a tocar validacao de dominio, e DEPOIS da
 * resolucao da sessao porque o hash de comparacao pertence aquela sessao.
 */
async function handleAuthenticatedMutation<TCommand>(
  deps: AuthenticatedHttpDeps,
  request: Request,
  parse: (input: unknown) => DomainResult<TCommand>,
  run: (
    authenticated: AuthenticatedContext,
    command: TCommand,
    context: AuthRequestContext,
  ) => Promise<Response>,
): Promise<Response> {
  const context = buildContext(deps, request);
  try {
    const body = await readJsonBody(request);
    if (body.kind === "method_not_allowed") return methodNotAllowedResponse();
    if (body.kind === "malformed") return malformedRequestResponse();

    const authenticated = await resolveAuthenticatedContext(
      deps.runtime,
      readSessionToken(request),
    );
    if (authenticated === null) return unauthenticatedResponse();

    const csrf = requireCsrf(
      readPresentedCsrfToken(request) ?? undefined,
      authenticated.csrfTokenHash,
    );
    if (!csrf.ok) return csrfRejectedResponse();

    const command = parse(body.value);
    if (!command.ok) {
      return validationFailedResponse(command.error.details ?? []);
    }

    return await run(authenticated, command.value, context);
  } catch {
    deps.onUnexpectedError?.(context.correlationId);
    return unexpectedFailureResponse();
  }
}

/** Casca das LEITURAS autenticadas. Sem corpo, sem CSRF (nao muda estado). */
async function handleAuthenticatedRead(
  deps: AuthenticatedHttpDeps,
  request: Request,
  run: (authenticated: AuthenticatedContext) => Promise<Response>,
): Promise<Response> {
  const context = buildContext(deps, request);
  try {
    if (request.method.toUpperCase() !== "GET") {
      return methodNotAllowedResponse();
    }
    const authenticated = await resolveAuthenticatedContext(
      deps.runtime,
      readSessionToken(request),
    );
    if (authenticated === null) return unauthenticatedResponse();
    return await run(authenticated);
  } catch {
    deps.onUnexpectedError?.(context.correlationId);
    return unexpectedFailureResponse();
  }
}

export interface AuthenticatedHttpHandlers {
  readonly signup: (request: Request) => Promise<Response>;
  readonly login: (request: Request) => Promise<Response>;
  readonly logout: (request: Request) => Promise<Response>;
  readonly logoutAll: (request: Request) => Promise<Response>;
  readonly session: (request: Request) => Promise<Response>;
  readonly changePassword: (request: Request) => Promise<Response>;
  readonly readProfile: (request: Request) => Promise<Response>;
  readonly updateProfile: (request: Request) => Promise<Response>;
  readonly readPrivacy: (request: Request) => Promise<Response>;
  readonly setConsent: (request: Request) => Promise<Response>;
  readonly exportData: (request: Request) => Promise<Response>;
  readonly closeAccount: (request: Request) => Promise<Response>;
}

export function createAuthenticatedHttpHandlers(
  deps: AuthenticatedHttpDeps,
): AuthenticatedHttpHandlers {
  const production = deps.runtime.production;

  return {
    /**
     * CADASTRO. Publico (sem sessao) e SEM CSRF — nao ha sessao a proteger, e o
     * `content-type: application/json` exigido por `readJsonBody` ja barra o
     * envio por formulario HTML entre origens.
     */
    async signup(request: Request): Promise<Response> {
      const context = buildContext(deps, request);
      try {
        const body = await readJsonBody(request);
        if (body.kind === "method_not_allowed") return methodNotAllowedResponse();
        if (body.kind === "malformed") return malformedRequestResponse();

        const command = parseSignupCommand(body.value);
        if (!command.ok) {
          return validationFailedResponse(command.error.details ?? []);
        }
        // 202 SEMPRE — exista ou nao o e-mail.
        return acceptedResponse(await signup(deps.runtime, command.value, context));
      } catch {
        deps.onUnexpectedError?.(context.correlationId);
        return unexpectedFailureResponse();
      }
    },

    /**
     * LOGIN. Publico. Em sucesso emite os DOIS cookies; em falha responde 401
     * generico e NAO emite cookie nenhum.
     */
    async login(request: Request): Promise<Response> {
      const context = buildContext(deps, request);
      try {
        const body = await readJsonBody(request);
        if (body.kind === "method_not_allowed") return methodNotAllowedResponse();
        if (body.kind === "malformed") return malformedRequestResponse();

        const command = parseLoginCommand(body.value);
        if (!command.ok) {
          return validationFailedResponse(command.error.details ?? []);
        }

        const result = await login(deps.runtime, command.value, context);
        if (result.sessionDelivery === null) {
          // `locked_out` responde 429; credencial invalida responde 401. Os dois
          // usam a MESMA mensagem — o lockout nao confirma existencia de conta,
          // ele descreve a chave apresentada.
          const locked = result.internalReason === "throttled";
          return jsonResponse(locked ? 429 : 401, result.publicDto);
        }

        return jsonResponse(
          200,
          result.publicDto,
          buildSessionCookies({
            rawSessionToken: result.sessionDelivery.rawSessionToken,
            rawCsrfToken: result.sessionDelivery.rawCsrfToken,
            expiresAt: result.sessionDelivery.expiresAt,
            now: deps.runtime.now(),
            production,
          }),
        );
      } catch {
        deps.onUnexpectedError?.(context.correlationId);
        return unexpectedFailureResponse();
      }
    },

    async logout(request: Request): Promise<Response> {
      return handleAuthenticatedMutation(
        deps,
        request,
        () => ({ ok: true as const, value: {} as Record<string, never> }),
        async (authenticated, _command, context) => {
          const dto = await logout(deps.runtime, authenticated, context);
          // Expurga os cookies no MESMO response que revoga a sessao.
          return jsonResponse(200, dto, buildClearedSessionCookies());
        },
      );
    },

    async logoutAll(request: Request): Promise<Response> {
      return handleAuthenticatedMutation(
        deps,
        request,
        () => ({ ok: true as const, value: {} as Record<string, never> }),
        async (authenticated, _command, context) => {
          const dto = await logoutAll(deps.runtime, authenticated, context);
          return jsonResponse(200, dto, buildClearedSessionCookies());
        },
      );
    },

    /**
     * SESSAO ATUAL. Nunca 401: `authenticated=false` e uma resposta valida —
     * a pagina publica precisa saber que ninguem esta logado sem tratar erro.
     */
    async session(request: Request): Promise<Response> {
      const context = buildContext(deps, request);
      try {
        if (request.method.toUpperCase() !== "GET") return methodNotAllowedResponse();
        const authenticated = await resolveAuthenticatedContext(
          deps.runtime,
          readSessionToken(request),
        );
        return jsonResponse(200, await readCurrentSession(deps.runtime, authenticated));
      } catch {
        deps.onUnexpectedError?.(context.correlationId);
        return unexpectedFailureResponse();
      }
    },

    /**
     * TROCA DE SENHA. Derruba TODAS as sessoes (inclusive a que pediu), entao a
     * resposta ja limpa os cookies — deixar o cookie vivo apontando para uma
     * sessao revogada faria toda acao seguinte falhar com 401 sem explicacao.
     */
    async changePassword(request: Request): Promise<Response> {
      return handleAuthenticatedMutation(
        deps,
        request,
        parseChangePasswordCommand,
        async (authenticated, command, context) => {
          const result = await changePassword(deps.runtime, authenticated, command, context);
          if (!result.ok) return failureResponse(result);
          return jsonResponse(200, { ok: true, status: "password_changed" }, buildClearedSessionCookies());
        },
      );
    },

    async readProfile(request: Request): Promise<Response> {
      return handleAuthenticatedRead(deps, request, async (authenticated) => {
        const profile = await readProfile(deps.runtime, authenticated);
        return profile === null
          ? jsonResponse(404, { ok: false, code: "not_found", message: "perfil nao encontrado." })
          : jsonResponse(200, { ok: true, profile });
      });
    },

    async updateProfile(request: Request): Promise<Response> {
      return handleAuthenticatedMutation(
        deps,
        request,
        parseUpdateProfileCommand,
        async (authenticated, command, context) => {
          const result = await updateProfile(deps.runtime, authenticated, command, context);
          return result.ok
            ? jsonResponse(200, { ok: true, profile: result.value })
            : failureResponse(result);
        },
      );
    },

    async readPrivacy(request: Request): Promise<Response> {
      return handleAuthenticatedRead(deps, request, async (authenticated) =>
        jsonResponse(200, { ok: true, privacy: await readPrivacyState(deps.runtime, authenticated) }),
      );
    },

    async setConsent(request: Request): Promise<Response> {
      return handleAuthenticatedMutation(
        deps,
        request,
        parseSetConsentCommand,
        async (authenticated, command, context) => {
          const result = await setConsent(deps.runtime, authenticated, command, context);
          return result.ok ? jsonResponse(200, { ok: true }) : failureResponse(result);
        },
      );
    },

    /**
     * EXPORTACAO. E uma MUTACAO (registra o pedido em `user_data_requests`),
     * entao exige CSRF como qualquer outra — apesar de "baixar meus dados"
     * parecer leitura.
     */
    async exportData(request: Request): Promise<Response> {
      return handleAuthenticatedMutation(
        deps,
        request,
        () => ({ ok: true as const, value: {} as Record<string, never> }),
        async (authenticated, _command, context) => {
          const result = await requestDataExport(deps.runtime, authenticated, context);
          return result.ok ? jsonResponse(200, result.value) : failureResponse(result);
        },
      );
    },

    /**
     * ENCERRAMENTO. Revoga todas as sessoes, entao limpa os cookies junto.
     */
    async closeAccount(request: Request): Promise<Response> {
      return handleAuthenticatedMutation(
        deps,
        request,
        parseRequestClosureCommand,
        async (authenticated, command, context) => {
          const result = await requestAccountClosure(
            deps.runtime,
            authenticated,
            command,
            context,
          );
          if (!result.ok) return failureResponse(result);
          return jsonResponse(
            200,
            { ok: true, status: "pending_deletion", effectiveAt: result.value.effectiveAt },
            buildClearedSessionCookies(),
          );
        },
      );
    },
  };
}
