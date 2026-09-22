import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { TMDB_IMAGE_HOST } from "@screena/public-contracts";

import {
  resolveLocale,
  rootRedirectPath,
} from "./src/lib/root-locale";
import { needsTrailingSlash } from "./src/lib/trailing-slash";

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
  // `upgrade-insecure-requests` ESTAVA aqui e foi removida em 2026-09-11.
  //
  // Ela nao fazia nada: o navegador IGNORA essa diretiva em politica
  // `Report-Only` (ela muda requisicao, e report-only nao muda nada por
  // definicao), e ainda emitia um aviso de console em TODA pagina — medido na
  // auditoria de SEO. Ou seja: custo visivel, efeito zero.
  //
  // Quem forca HTTPS aqui e o HSTS de 2 anos com `preload`
  // (`next.config.ts`), que age antes da requisicao sair do navegador. Se um
  // dia esta politica virar bloqueante, a diretiva volta JUNTO com a promocao
  // do cabecalho — nao antes, porque antes ela continua inerte.
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
    // 308, nao 307 (mudado em 2026-09-11, decisao do dono).
    //
    // O 307 dizia ao buscador "este destino e temporario, continue pedindo a
    // raiz" — e a raiz NAO e temporaria: `PUBLISHED_URL_LOCALES` tem um idioma
    // so, e `rootRedirectPath` devolve `/pt/` para QUALQUER `Accept-Language`,
    // inclusive `en`. Um destino que nao varia e permanente por definicao.
    //
    // Os dois preservam metodo e corpo (e essa a diferenca deles para 302/301);
    // o que muda e o sinal de cache e de consolidacao de sinal para o indice.
    // Quando um segundo idioma publicar, isto volta a 307 no mesmo movimento em
    // que a negociacao passar a ter mais de uma saida possivel.
    return withSecurityHeaders(NextResponse.redirect(url, 308));
  }

  const persisted = await resolvePersistedRedirect(request);
  if (persisted !== null) {
    const destination = new URL(persisted.location, request.nextUrl.origin);
    return withSecurityHeaders(NextResponse.redirect(destination, persisted.statusCode));
  }

  // A barra final passa a ser resolvida AQUI, depois do redirect persistido
  // (para nao mudar a ordem de consulta que ja existia) e antes do `next()`.
  // Ver `needsTrailingSlash`: o 308 do roteador saia sem cabecalho de seguranca
  // nenhum, porque ele descarta a resposta do middleware.
  if (needsTrailingSlash(request.nextUrl.pathname)) {
    // `URL` padrao, NAO `request.nextUrl.clone()`. Com
    // `skipTrailingSlashRedirect`, o `NextURL` reformata o caminho na hora de
    // serializar e DEVOLVE a barra que acabamos de acrescentar: o `Location`
    // saia identico a URL pedida, e o navegador entrava em laco infinito.
    // Medido num servidor real antes de existir este comentario.
    const url = new URL(request.url);
    url.pathname = `${url.pathname}/`;
    return withSecurityHeaders(NextResponse.redirect(url, 308));
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
