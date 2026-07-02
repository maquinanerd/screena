import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  buildUnauthorizedHeaders,
  evaluateAdminAccess,
} from "./src/lib/access-protection";

/**
 * Middleware de protecao de ACESSO do admin interno (@screena/admin).
 *
 * Coloca um portao HTTP Basic Auth na frente de TODAS as telas do admin. Toda a
 * logica de decisao vive em `src/lib/access-protection` (modulo puro, testado);
 * este arquivo e so o adaptador fino para o runtime do Next.
 *
 * ESCOPO (Fase 6B). E protecao operacional MINIMA, nao autenticacao completa:
 * SEM sessao, SEM cookie, SEM login, SEM JWT, SEM OAuth, SEM banco, SEM usuario
 * persistido, SEM chamada a API externa. Stateless: cada request reapresenta o
 * par usuario/senha via Basic Auth.
 *
 * Comportamento:
 *   - `ADMIN_PROTECTION_ENABLED` != "true"  -> segue (dev/local, acesso aberto).
 *   - protecao ligada, sem usuario/senha em ENV -> 401 (nega por seguranca).
 *   - protecao ligada, Basic Auth ausente/invalido -> 401 + desafio.
 *   - protecao ligada, Basic Auth valido -> segue.
 *
 * As tres ENV sao lidas como referencias literais a `process.env.*` para que o
 * Next as injete no Edge runtime; a senha nunca aparece no HTML nem em log.
 */
export function middleware(request: NextRequest): NextResponse {
  const decision = evaluateAdminAccess(request.headers.get("authorization"), {
    ADMIN_PROTECTION_ENABLED: process.env.ADMIN_PROTECTION_ENABLED,
    ADMIN_BASIC_AUTH_USER: process.env.ADMIN_BASIC_AUTH_USER,
    ADMIN_BASIC_AUTH_PASSWORD: process.env.ADMIN_BASIC_AUTH_PASSWORD,
  });

  if (decision.outcome === "allow") {
    return NextResponse.next();
  }

  return new NextResponse("Autenticacao necessaria.", {
    status: 401,
    headers: buildUnauthorizedHeaders(),
  });
}

/**
 * matcher: aplica o middleware a TODAS as rotas do admin (`/`, `/articles`,
 * `/content-blocks`, `/health`, ...), exceto os assets internos do Next e o
 * favicon — que nao expoem dado editorial e cujo bloqueio so quebraria o app.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
