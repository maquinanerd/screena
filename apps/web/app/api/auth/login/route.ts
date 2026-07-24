/**
 * POST /api/auth/login — Login. Sucesso emite cookies de sessao (HttpOnly) e
 * CSRF (legivel); falha responde 401 sem cookie. Delegador.
 */

import { runAuthenticatedEndpoint } from "../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return runAuthenticatedEndpoint((h) => h.login, request);
}
