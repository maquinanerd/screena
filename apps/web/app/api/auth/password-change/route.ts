/**
 * POST /api/auth/password-change — Troca de senha autenticada. Exige a senha
 * atual e CSRF; revoga todas as sessoes e limpa os cookies. Delegador.
 */

import { runAuthenticatedEndpoint } from "../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return runAuthenticatedEndpoint((h) => h.changePassword, request);
}
