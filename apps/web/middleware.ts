import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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
 *    acessa Postgres. FAIL-CLOSED: qualquer falha => sem redirect (segue o fluxo).
 *  - Nunca redireciona /pt/*, aliases como /filmes, APIs ou assets estaticos.
 *  - Enquanto en/es nao tiverem conteudo real publicado, o fallback da raiz e
 *    /pt/. Atualize PUBLISHED_LOCALES quando esses idiomas ficarem prontos.
 *
 * Follow-up de performance: com Node middleware (Next 15.5) a leitura da tabela
 * pode ocorrer direto no middleware, eliminando o subrequest. Mantido via route
 * handler para compatibilidade garantida de build.
 */

interface PersistedRedirect {
  location: string;
  statusCode: number;
}

async function resolvePersistedRedirect(
  request: NextRequest,
): Promise<PersistedRedirect | null> {
  try {
    const lookupUrl = new URL("/api/seo/redirect", request.nextUrl.origin);
    lookupUrl.searchParams.set("path", request.nextUrl.pathname);
    const response = await fetch(lookupUrl, {
      headers: { "x-screena-internal": "redirect-lookup" },
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
    // Fail-closed: nenhum redirect persistido em caso de erro.
    return null;
  }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = rootRedirectPath(request.headers.get("accept-language"));
    return NextResponse.redirect(url, 307);
  }

  const persisted = await resolvePersistedRedirect(request);
  if (persisted !== null) {
    const destination = new URL(persisted.location, request.nextUrl.origin);
    return NextResponse.redirect(destination, persisted.statusCode);
  }

  const locale = resolveLocale(request.nextUrl.pathname);
  const response = NextResponse.next();
  response.headers.set("x-screena-locale", locale);
  return response;
}

/**
 * matcher: aplica o middleware a todas as rotas exceto assets internos do
 * Next, a API interna e os assets estaticos servidos de `public/`
 * (`/media/`, `/brand/`, `/uploads/`).
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|media|brand|uploads).*)"],
};
