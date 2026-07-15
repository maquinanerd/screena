/**
 * /sitemap.xml — Sitemap INDEX publico do Screen (Fase 3, §11).
 *
 * Route handler (Node runtime) que serve o sitemap-index apontando para os
 * shards por (idioma, tipo, pagina). Substitui o sitemap unico anterior. A
 * decisao do que entra vive em `src/server/seo/sitemap-index` (mesmos gates das
 * paginas + exclusao pela decisao vigente persistida). Zero API externa no
 * render; le so PostgreSQL local, com fail-closed em falha de banco.
 */

import { getSitemapIndexXml } from "../../src/server/seo/sitemap-index";

// Dinamico: o build roda sem DATABASE_URL; a cada request reflete o banco.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { xml, contentType } = await getSitemapIndexXml();
  return new Response(xml, {
    status: 200,
    headers: { "content-type": contentType },
  });
}
