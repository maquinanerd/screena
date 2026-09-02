import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { TMDB_IMAGE_HOST } from "@screena/public-contracts";

import {
  resolveLocale,
  rootRedirectPath,
} from "./src/lib/root-locale";

/**
 * Middleware de locale + REDIRECTS PERSISTIDOS do app publico @screena/web.
 *
 * Regras:
 *  - Redireciona somente o path exato "/" com 307 temporario para o fallback.
 *  - Aplica REDIRECTS PERSISTIDOS (tabela `redirects`, Fase 3, §10): resolve a
 *    cadeia (301/302/alias, com deteccao de loop e teto de saltos) por um route
 *    handler Node (`/api/seo/redirect`) — o middleware roda no Edge e nao
 *    acessa Postgres. FAIL-CLOSED COM PRAZO: qualquer falha, ou estouro de
 *    `REDIRECT_LOOKUP_TIMEOUT_MS`, => sem redirect (segue o fluxo). Fail-closed
 *    sem prazo nao e protecao: e espera indefinida com tratamento de erro no fim.
 *  - Nunca redireciona /pt/*, aliases como /filmes, APIs ou assets estaticos.
 *  - Enquanto en/es nao tiverem conteudo real publicado, o fallback da raiz e
 *    /pt/. Atualize PUBLISHED_LOCALES quando esses idiomas ficarem prontos.
 *
 * Follow-up de performance: com Node middleware (Next 15.5) a leitura da tabela
 * pode ocorrer direto no middleware, eliminando o subrequest. Mantido via route
 * handler para compatibilidade garantida de build.
 */

/**
 * CSP em REPORT-ONLY — o cabecalho que o `next.config` nao consegue emitir.
 *
 * ============================================================================
 * POR QUE AQUI, E NAO JUNTO DOS OUTROS QUATRO
 * ============================================================================
 * `next.config.ts` aplica os cabecalhos de seguranca na regra `/:path*`, que TEM
 * parametro — e o Next roda `compileNonPath()` sobre chave e valor quando a
 * regra tem parametro. Essa funcao so devolve cedo quando NAO ha `:` no valor.
 * Um CSP e dois-pontos por toda parte (o host de imagem, `data:`), e ali eles
 * seriam lidos como sintaxe de path-to-regexp. Aqui o cabecalho e escrito direto
 * na resposta: nenhuma compilacao de rota o toca.
 *
 * ============================================================================
 * POR QUE REPORT-ONLY, E O QUE ISSO SIGNIFICA
 * ============================================================================
 * Um CSP mal calibrado nao degrada — ele QUEBRA a pagina, e quebra em silencio
 * para quem esta com o console fechado. `Report-Only` aplica a mesma politica e
 * NAO bloqueia nada: o navegador so reporta o que teria sido barrado. E o passo
 * que permite descobrir o que a politica quebraria antes de ela quebrar.
 *
 * Promover para `Content-Security-Policy` (sem `-Report-Only`) e uma decisao
 * separada, depois de olhar os relatos. Nao ha `report-uri`/`report-to` ainda:
 * sem coletor, os relatos ficam no console do navegador — que ja e o suficiente
 * para a primeira calibragem, e nao envia dado de leitor para lugar nenhum.
 *
 * ============================================================================
 * DE ONDE VEM CADA ORIGEM
 * ============================================================================
 * `img-src`   O host de imagem vem de `TMDB_IMAGE_HOST`, IMPORTADO de
 *             `@screena/public-contracts` — o unico lugar do repositorio
 *             autorizado a escreve-lo (travado por
 *             `image-host-single-source.test.ts`). Importar em vez de repetir
 *             nao e so obediencia a regra: e o que impede o CSP de continuar
 *             liberando um host que o produto deixou de usar. `data:`/`blob:`
 *             cobrem placeholder e imagem gerada pelo proprio Next.
 * `frame-src` `youtube-nocookie.com` e o UNICO iframe do site publico, montado
 *             so apos clique explicito no trailer.
 * `script-src`/`style-src` precisam de `unsafe-inline` enquanto o App Router
 *             emitir script e estilo inline no streaming de RSC. Estreitar isso
 *             exige nonce por request, que e outra PR.
 * `frame-ancestors 'none'` e o equivalente moderno do `X-Frame-Options: DENY`
 *             que o `next.config` ja emite — os dois convivem de proposito.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `img-src 'self' https://${TMDB_IMAGE_HOST} data: blob:`,
  "media-src 'self'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "frame-src https://www.youtube-nocookie.com",
  "upgrade-insecure-requests",
].join("; ");

/**
 * Escreve o CSP na resposta. Uma funcao para os TRES caminhos de saida do
 * middleware — o redirect da raiz, o redirect persistido e o `next()`.
 *
 * Uma funcao, e nao tres `headers.set`: um caminho novo que esquecesse a linha
 * sairia sem politica nenhuma, e ninguem notaria (a pagina funciona igual).
 */
function withSecurityHeaders(response: NextResponse): NextResponse {
  // Se um dia isto virar bloqueante, e AQUI que o nome do cabecalho muda — em
  // um lugar so, para os tres caminhos.
  response.headers.set("Content-Security-Policy-Report-Only", CONTENT_SECURITY_POLICY);
  return response;
}

interface PersistedRedirect {
  location: string;
  statusCode: number;
}

/**
 * Teto de espera do subrequest de redirect, em milissegundos.
 *
 * POR QUE ELE PRECISA EXISTIR
 * ---------------------------------------------------------------------------
 * `resolvePersistedRedirect` roda em TODA requisicao que casa o `matcher` — ou
 * seja, em toda pagina publica. Sem teto, um `/api/seo/redirect` lento (Postgres
 * sob carga, pool esgotado, deploy pela metade) segurava a requisicao do leitor
 * pelo tempo que fosse: o `fetch` sem `signal` nao desiste sozinho, e o
 * `catch` abaixo so age depois que a promessa se resolve de algum jeito.
 *
 * O `try/catch` ja era fail-closed, mas fail-closed sem prazo nao e protecao —
 * e uma espera indefinida com tratamento de erro no fim.
 *
 * POR QUE 1500 ms
 * ---------------------------------------------------------------------------
 * O subrequest e local (mesmo processo, mesma maquina): o caso saudavel e de
 * milissegundos. 1,5 s e uma ordem de grandeza acima do normal, entao ele nunca
 * corta uma consulta sadia — e fica bem abaixo do que o leitor percebe como
 * pagina travada.
 *
 * O QUE ACONTECE QUANDO ESTOURA
 * ---------------------------------------------------------------------------
 * `AbortSignal.timeout` rejeita o `fetch`, o `catch` devolve `null`, e o
 * middleware SEGUE sem redirect persistido — a pagina responde normalmente. Um
 * redirect 301 perdido e um custo de SEO recuperavel no proximo request; uma
 * requisicao pendurada nao e recuperavel para quem esta esperando.
 */
export const REDIRECT_LOOKUP_TIMEOUT_MS = 1500;

async function resolvePersistedRedirect(
  request: NextRequest,
): Promise<PersistedRedirect | null> {
  try {
    const lookupUrl = new URL("/api/seo/redirect", request.nextUrl.origin);
    lookupUrl.searchParams.set("path", request.nextUrl.pathname);
    const response = await fetch(lookupUrl, {
      headers: { "x-screena-internal": "redirect-lookup" },
      signal: AbortSignal.timeout(REDIRECT_LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      status?: string;
      location?: string | null;
      statusCode?: number | null;
    };
    if (
      data.status === "resolved" &&
      typeof data.location === "string" &&
      data.location.startsWith("/") &&
      typeof data.statusCode === "number"
    ) {
      return { location: data.location, statusCode: data.statusCode };
    }
    return null;
  } catch {
    // Fail-closed: nenhum redirect persistido em caso de erro OU de estouro do
    // prazo acima. Degradar aqui e deliberado — a requisicao segue sem o
    // redirect em vez de esperar por ele.
    return null;
  }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = rootRedirectPath(request.headers.get("accept-language"));
    return withSecurityHeaders(NextResponse.redirect(url, 307));
  }

  const persisted = await resolvePersistedRedirect(request);
  if (persisted !== null) {
    const destination = new URL(persisted.location, request.nextUrl.origin);
    return withSecurityHeaders(NextResponse.redirect(destination, persisted.statusCode));
  }

  const locale = resolveLocale(request.nextUrl.pathname);
  const response = NextResponse.next();
  response.headers.set("x-screena-locale", locale);
  return withSecurityHeaders(response);
}

/**
 * matcher: aplica o middleware a todas as rotas exceto assets internos do
 * Next, a API interna e os assets estaticos servidos de `public/`
 * (`/media/`, `/brand/`, `/uploads/`).
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|media|brand|uploads).*)"],
};
