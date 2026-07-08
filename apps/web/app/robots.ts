import type { MetadataRoute } from "next";

import {
  OFFICIAL_SITE_URL,
  isOfficialIndexableEnvironment,
  type SiteUrlEnv,
} from "../src/lib/site";

/**
 * robots.txt do app publico Screen (https://thescreen.media/robots.txt).
 *
 * Principios:
 *  - Producao oficial libera crawl publico geral somente quando
 *    THE_SCREEN_PUBLIC_SITE_URL=https://thescreen.media e
 *    THE_SCREEN_PUBLIC_INDEXING_ENABLED=1.
 *  - Dev, preview, staging, localhost e dominio temporario bloqueiam tudo com
 *    Disallow: / e nao anunciam sitemap.
 *  - Em producao oficial, Disallow fica restrito a areas tecnicas:
 *    /api/, /dev/ e /admin/.
 *  - /_next/ nao e bloqueado, porque os assets do Next sao necessarios para
 *    renderizacao por crawlers.
 *  - O sitemap so aparece na saida oficial e sempre aponta para
 *    https://thescreen.media/sitemap.xml. Puro: sem DB, sem rede.
 */
export function buildRobots(env: SiteUrlEnv = process.env): MetadataRoute.Robots {
  if (!isOfficialIndexableEnvironment(env)) {
    return {
      rules: [
        {
          userAgent: "*",
          disallow: "/",
        },
      ],
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dev/", "/admin/"],
      },
    ],
    sitemap: `${OFFICIAL_SITE_URL}/sitemap.xml`,
  };
}

export default function robots(): MetadataRoute.Robots {
  return buildRobots();
}
