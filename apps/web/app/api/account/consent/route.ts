/**
 * POST /api/account/consent — Registra uma decisao de consentimento (conceder
 * ou retirar). Retirada tem efeito real e imediato. Exige CSRF. Delegador.
 */

import { runAuthenticatedEndpoint } from "../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return runAuthenticatedEndpoint((h) => h.setConsent, request);
}
