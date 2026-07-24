/**
 * /api/me/history (C8).
 *
 *  GET — Historico: consumo explicitamente registrado.
 *
 * Delegador de tres linhas: toda a regra vive em @screena/user-platform, sob a
 * suite de testes do monorepo. apps/web nao e coberto pelo vitest, entao
 * qualquer logica escrita aqui nasceria sem teste.
 */

import { runLibraryEndpoint } from "../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return runLibraryEndpoint((h) => h.history, request);
}
