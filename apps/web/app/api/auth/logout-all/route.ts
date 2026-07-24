/**
 * POST /api/auth/logout-all — Derruba TODAS as sessoes (todos os dispositivos),
 * inclusive a corrente. Exige CSRF. Delegador.
 */

import { runAuthenticatedEndpoint } from "../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return runAuthenticatedEndpoint((h) => h.logoutAll, request);
}
