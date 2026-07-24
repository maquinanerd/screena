/**
 * GET /api/account/privacy — Estado de consentimentos, pedidos LGPD e status da
 * conta. Leitura autenticada (sem CSRF). Delegador.
 */

import { runAuthenticatedEndpoint } from "../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return runAuthenticatedEndpoint((h) => h.readPrivacy, request);
}
