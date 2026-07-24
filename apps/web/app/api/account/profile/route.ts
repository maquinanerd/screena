/**
 * /api/account/profile — Perfil do proprio dono.
 *   GET  le o perfil (sem CSRF; leitura).
 *   POST atualiza (exige CSRF; mutacao).
 * Delegador.
 */

import { runAuthenticatedEndpoint } from "../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return runAuthenticatedEndpoint((h) => h.readProfile, request);
}

export async function POST(request: Request): Promise<Response> {
  return runAuthenticatedEndpoint((h) => h.updateProfile, request);
}
