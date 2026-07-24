/**
 * POST /api/account/export — Exportacao LGPD dos dados do proprio titular.
 * NUNCA inclui segredo/hash/token. E mutacao (registra o pedido), entao exige
 * CSRF. Delegador.
 */

import { runAuthenticatedEndpoint } from "../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return runAuthenticatedEndpoint((h) => h.exportData, request);
}
