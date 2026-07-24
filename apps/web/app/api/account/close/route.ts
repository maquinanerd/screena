/**
 * POST /api/account/close — Encerramento de conta. Exige reautenticacao por
 * senha e CSRF; leva a conta a pending_deletion, revoga todas as sessoes e
 * limpa os cookies. Delegador.
 */

import { runAuthenticatedEndpoint } from "../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return runAuthenticatedEndpoint((h) => h.closeAccount, request);
}
