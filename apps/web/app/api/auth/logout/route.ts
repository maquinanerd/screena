/**
 * POST /api/auth/logout — Encerra a sessao corrente e expurga os cookies.
 * Exige CSRF. Delegador.
 */

import { runAuthenticatedEndpoint } from "../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return runAuthenticatedEndpoint((h) => h.logout, request);
}
