/**
 * GET /api/auth/session — Leitura da sessao atual. Nunca 401: responde
 * `authenticated:false` quando nao ha sessao. Delegador.
 */

import { runAuthenticatedEndpoint } from "../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return runAuthenticatedEndpoint((h) => h.session, request);
}
