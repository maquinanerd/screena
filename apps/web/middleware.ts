import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  resolveLocale,
  rootRedirectPath,
} from "./src/lib/root-locale";

/**
 * Middleware de locale do app publico @screena/web.
 *
 * Regras:
 *  - Detecta locale pelo primeiro segmento da URL em rotas ja prefixadas.
 *  - Redireciona somente o path exato "/" com 307 temporario.
 *  - Nunca redireciona /pt/*, aliases como /filmes, APIs ou assets estaticos.
 *  - Enquanto en/es nao tiverem conteudo real publicado, o fallback da raiz e
 *    /pt/. Atualize PUBLISHED_LOCALES quando esses idiomas ficarem prontos.
 */

export function middleware(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = rootRedirectPath(request.headers.get("accept-language"));
    return NextResponse.redirect(url, 307);
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
