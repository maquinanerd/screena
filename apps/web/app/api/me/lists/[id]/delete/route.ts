/**
 * POST /api/me/lists/[id]/delete (C8).
 *
 *  Remove a lista (soft delete).
 *
 * POST, e nao DELETE: a leitura de corpo desta borda
 * (readJsonBody) aceita SOMENTE POST — um handler DELETE responderia 405
 * em toda chamada. A convencao de mutacao-por-POST e a mesma do C7C/C7D.
 *
 * Delegador de tres linhas: a regra vive em @screena/user-platform.
 */

import { runLibraryEndpoint } from "../../../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return runLibraryEndpoint((h) => h.deleteList, request);
}
