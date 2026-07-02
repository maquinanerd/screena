import type { MetadataRoute } from "next";

import { SITE_URL } from "../src/lib/site";

/**
 * robots.txt do app publico Screen (https://thescreen.media/robots.txt).
 *
 * Principios (espelham .claude/rules/seo.md):
 *  - Crawl publico geral LIBERADO; o controle fino de indexacao (pagina fina,
 *    draft, en/es) e feito por `<meta name="robots">` por pagina — nunca por
 *    Disallow (Disallow esconde o conteudo mas pode manter a URL no indice).
 *  - Disallow apenas para areas tecnicas/administrativas que nem devem ser
 *    rastreadas: /api/, /dev/ (preview interno) e /admin/ (painel futuro).
 *  - `/_next/` NAO e bloqueado: os assets do Next (JS/CSS/imagens otimizadas)
 *    sao necessarios para o Google renderizar as paginas corretamente.
 *  - Dominio canonico unico: https://thescreen.media. O dominio legado nao
 *    aparece na saida. Puro: sem DB, sem rede.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dev/", "/admin/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
