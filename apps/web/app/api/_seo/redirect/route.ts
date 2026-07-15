/**
 * /api/_seo/redirect — Resolucao Node-runtime de REDIRECT PERSISTIDO (Fase 3, §10).
 *
 * O middleware roda no Edge e nao acessa Postgres; este route handler (Node) le
 * a tabela `redirects` e devolve a resolucao da cadeia como JSON. Fica sob
 * `/api/` (excluido do matcher do middleware => sem recursao) e e bloqueado no
 * robots (`Disallow: /api/`). Zero API externa; so PostgreSQL local.
 */

import { lookupRedirect } from "../../../../src/server/seo/redirect-lookup";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const path = new URL(request.url).searchParams.get("path");
  if (path === null || !path.startsWith("/")) {
    return Response.json({ status: "none", location: null, statusCode: null });
  }
  const result = await lookupRedirect(path);
  return Response.json(result);
}
