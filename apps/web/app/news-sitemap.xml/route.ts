/**
 * /news-sitemap.xml — Google News sitemap da Cinerie.
 *
 * Arquivo SEPARADO do sitemap comum de proposito: o Google News tem janela de
 * 48h, teto de 1.000 URLs e namespace proprio. Misturar os dois faria o sitemap
 * geral perder materias antigas ou o de noticias ganhar materias fora da
 * janela — e a segunda opcao desqualifica o arquivo inteiro.
 *
 * Zero API externa no render (invariante 3): le apenas PostgreSQL local.
 */

import { getNewsSitemapXml } from "../../src/server/seo/news-sitemap";

// Dinamico: o build roda sem DATABASE_URL, e a janela de 48h muda a cada
// request. Um sitemap de noticias cacheado no build nasceria vencido.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { xml, contentType } = await getNewsSitemapXml();
  return new Response(xml, {
    status: 200,
    headers: { "content-type": contentType },
  });
}
