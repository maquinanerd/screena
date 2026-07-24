/**
 * POST /api/auth/signup — Cadastro. Responde SEMPRE 202 generico (anti-enumeracao).
 *
 * Delegador: a regra vive em `@screena/user-platform`, sob a suite do monorepo.
 */

import { runAuthenticatedEndpoint } from "../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return runAuthenticatedEndpoint((h) => h.signup, request);
}
