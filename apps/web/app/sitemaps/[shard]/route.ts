/**
 * /sitemaps/{id}.xml — Shard de sitemap por (idioma, tipo, pagina) (Fase 3, §11).
 *
 * Route handler (Node runtime) que serve um `<urlset>` de um shard identificado
 * por `sitemap-{language}-{type}-{page}.xml`. A lista e coerente com o meta
 * robots das paginas (mesma fonte que o index). Zero API externa; so PostgreSQL
 * local. Shard inexistente -> 404.
 */

import { getSitemapShardXml } from "../../../src/server/seo/sitemap-index";

export const dynamic = "force-dynamic";

interface ShardRouteContext {
  params: Promise<{ shard: string }>;
}

export async function GET(
  _request: Request,
  context: ShardRouteContext,
): Promise<Response> {
  const { shard } = await context.params;
  const result = await getSitemapShardXml(shard);
  if (result === null) {
    return new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(result.xml, {
    status: 200,
    headers: { "content-type": result.contentType },
  });
}
