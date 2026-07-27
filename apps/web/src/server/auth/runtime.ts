/**
 * Ponte SERVER-ONLY entre o app publico e o runtime de autenticacao (C7C).
 *
 * Este e o UNICO arquivo de `apps/web` que alcanca `@screena/user-platform`. As
 * rotas sob `app/api/auth/**` sao arquivos de tres linhas que delegam para os
 * handlers daqui — assim toda a logica de borda fica em `services/`, sob a suite
 * de testes do monorepo (que nao roda `apps/web`).
 *
 * Fica em `src/server/` pela MESMA razao que `src/server/seo/redirect-lookup.ts`:
 * e o unico lugar de `apps/web` onde acesso a PostgreSQL e permitido, e a
 * governanca de pureza de render (`tests/governance/web-render-layering.test.ts`
 * + `scripts/audit/check-render-purity.mjs`) o verifica.
 *
 * NAO E RENDER. Estas rotas sao mutacoes `POST` sob `/api/`, bloqueadas no
 * robots (`Disallow: /api/`) e nunca alcancadas por pagina indexavel. A
 * invariante 3 governa o caminho de RENDER de pagina publica; um endpoint de
 * autenticacao que precisa entregar um e-mail nao tem como ser um worker offline
 * sem uma tabela de outbox, que esta unidade deliberadamente nao cria.
 */

import {
  AUTH_SECURITY_HEADERS,
  createFullAuthRuntime,
  isAuthRuntimeConfigurationError,
} from "@screena/user-platform/auth-runtime";
import type {
  AuthEmailLogEvent,
  AuthenticatedHttpHandlers,
  AuthHttpHandlers,
  AuthRuntimeHandlers,
  LibraryHttpHandlers,
} from "@screena/user-platform/auth-runtime";

/**
 * Coletor de observabilidade. O evento ja e um tipo FECHADO — nao ha campo por
 * onde e-mail, token, hash, IP ou corpo do fornecedor possam entrar —, entao
 * serializa-lo inteiro e seguro por construcao, e nao por disciplina.
 */
function logAuthEvent(event: AuthEmailLogEvent): void {
  console.log(JSON.stringify({ scope: "auth-email", ...event }));
}

/**
 * Falha inesperada. Recebe SO o identificador de correlacao: o objeto de erro
 * nao atravessa, porque uma excecao de driver pode citar parametros de query e
 * um deles pode ser o hash de um token.
 */
function logUnexpected(correlationId: string): void {
  console.error(JSON.stringify({ scope: "auth-email", outcome: "unexpected_error", correlationId }));
}

let cached: AuthRuntimeHandlers | null = null;

/**
 * Constroi AMBOS os conjuntos de handlers na PRIMEIRA requisicao, nao no
 * carregamento do modulo.
 *
 * `createFullAuthRuntime` lanca quando a configuracao esta incompleta. Se isso
 * acontecesse no import, `next build` quebraria — e o build roda de proposito
 * SEM nenhuma env (ver o Dockerfile), porque as variaveis publicas passaram a
 * ser 100% de runtime. A falha continua sendo cedo o suficiente: acontece antes
 * de qualquer e-mail ser enviado, na primeira chamada ao endpoint, e vira 500
 * generico com o motivo (nomes de variavel, nunca valores) no log do servidor.
 */
function fullRuntime(): AuthRuntimeHandlers {
  if (cached === null) {
    cached = createFullAuthRuntime({
      logger: logAuthEvent,
      onUnexpectedError: logUnexpected,
    });
  }
  return cached;
}

function authHandlers(): AuthHttpHandlers {
  return fullRuntime().email;
}

function authenticatedHandlers(): AuthenticatedHttpHandlers {
  return fullRuntime().authenticated;
}

function libraryHandlers(): LibraryHttpHandlers {
  return fullRuntime().library;
}

/**
 * Executa um endpoint da BIBLIOTECA PESSOAL (C8): watchlist, tracker, listas,
 * notas e importacao. Mesma casca de protecao dos anteriores — so a construcao
 * do runtime pode lancar aqui; os handlers ja contem as proprias excecoes.
 */
export async function runLibraryEndpoint(
  pick: (handlers: LibraryHttpHandlers) => (request: Request) => Promise<Response>,
  request: Request,
): Promise<Response> {
  try {
    return await pick(libraryHandlers())(request);
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "library",
        outcome: "runtime_unavailable",
        detail: isAuthRuntimeConfigurationError(error)
          ? error.details
          : "falha de construcao do runtime (detalhe omitido de proposito)",
      }),
    );
    return new Response(
      JSON.stringify({ ok: false, code: "error", message: "nao foi possivel completar a operacao." }),
      { status: 500, headers: { ...AUTH_SECURITY_HEADERS } },
    );
  }
}

/**
 * Executa um endpoint de autenticacao.
 *
 * O `try` cobre a CONSTRUCAO do runtime, nao o handler: os handlers ja contem
 * as proprias excecoes e nunca lancam. O que pode lancar aqui e
 * `createAuthRuntime` com configuracao invalida — e essa falha vira 500
 * generico, com a lista de nomes de variavel apenas no log do servidor. Deixar a
 * excecao subir entregaria uma pagina de erro do Next com stack.
 */
/**
 * Executa um endpoint AUTENTICADO (cadastro, login, sessao, perfil,
 * privacidade). Mesma casca de protecao do `runAuthEndpoint`: so a construcao
 * do runtime pode lancar aqui — os handlers ja contem as proprias excecoes.
 */
export async function runAuthenticatedEndpoint(
  pick: (handlers: AuthenticatedHttpHandlers) => (request: Request) => Promise<Response>,
  request: Request,
): Promise<Response> {
  try {
    return await pick(authenticatedHandlers())(request);
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "auth-session",
        outcome: "runtime_unavailable",
        detail: isAuthRuntimeConfigurationError(error)
          ? error.details
          : "falha de construcao do runtime (detalhe omitido de proposito)",
      }),
    );
    return new Response(
      JSON.stringify({ ok: false, code: "error", message: "nao foi possivel completar a operacao." }),
      { status: 500, headers: { ...AUTH_SECURITY_HEADERS } },
    );
  }
}

export async function runAuthEndpoint(
  pick: (handlers: AuthHttpHandlers) => (request: Request) => Promise<Response>,
  request: Request,
): Promise<Response> {
  try {
    return await pick(authHandlers())(request);
  } catch (error) {
    // SO o erro de CONFIGURACAO tem os detalhes registrados, porque so ele
    // garante que carrega apenas NOMES de variavel (ver `config.ts`).
    //
    // Qualquer outra falha de construcao e silenciada de proposito: o `try`
    // tambem cobre `getPrismaClient()`, e uma recusa do driver (`P1013`, erro de
    // conexao) traz a `DATABASE_URL` — senha inclusa — dentro de `error.message`.
    // Registrar `error.message` genericamente transformaria o log em canal de
    // vazamento, fora do alcance de qualquer varredura de fonte.
    console.error(
      JSON.stringify({
        scope: "auth-email",
        outcome: "runtime_unavailable",
        detail: isAuthRuntimeConfigurationError(error)
          ? error.details
          : "falha de construcao do runtime (detalhe omitido de proposito)",
      }),
    );
    return new Response(
      JSON.stringify({
        ok: false,
        code: "error",
        message: "nao foi possivel completar a operacao.",
      }),
      { status: 500, headers: { ...AUTH_SECURITY_HEADERS } },
    );
  }
}
