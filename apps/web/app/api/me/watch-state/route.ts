/**
 * /api/me/watch-state (C8).
 *
 *  POST — Define o estado (quero assistir / assistido).
 *
 * Delegador de tres linhas: toda a regra vive em @screena/user-platform, sob a
 * suite de testes do monorepo. apps/web nao e coberto pelo vitest, entao
 * qualquer logica escrita aqui nasceria sem teste.
 */

import { runLibraryEndpoint } from "../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return runLibraryEndpoint((h) => h.setWatchState, request);
}
