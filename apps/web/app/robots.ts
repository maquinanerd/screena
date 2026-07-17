import type { MetadataRoute } from "next";

import {
  OFFICIAL_SITE_URL,
  isOfficialIndexableEnvironment,
  type SiteUrlEnv,
} from "../src/lib/site";

/**
 * robots.txt do app publico Cinerie (https://cinerie.com/robots.txt).
 *
 * DINAMICO (`force-dynamic`), de proposito. Antes era rota Static: o Next
 * executava `buildRobots()` no `next build` e assava o resultado em
 * `.next/server/app/robots.txt.body`. Como o Dockerfile passava
 * `THE_SCREEN_PUBLIC_INDEXING_ENABLED=1` no build, a imagem SEMPRE nascia com
 * `Allow: /` — e nenhuma env de runtime conseguia mudar isso. Um kill switch que
 * exige rebuild nao e um kill switch. Custo: o handler roda por request (puro,
 * so le env — sem DB e sem rede), o que e irrelevante para um arquivo de texto.
 *
 * Principios:
 *  - Producao oficial libera crawl publico geral somente quando
 *    CINERIE_PUBLIC_SITE_URL=https://cinerie.com e
 *    CINERIE_PUBLIC_INDEXING_ENABLED=true|1 (os nomes legados
 *    THE_SCREEN_PUBLIC_* seguem aceitos como fallback).
 *  - Dev, preview, staging, localhost e dominio temporario bloqueiam tudo com
 *    Disallow: / e nao anunciam sitemap.
 *  - Em producao oficial, Disallow fica restrito a areas tecnicas:
 *    /api/, /dev/ e /admin/.
 *  - /_next/ nao e bloqueado, porque os assets do Next sao necessarios para
 *    renderizacao por crawlers.
 *  - O sitemap so aparece na saida oficial e sempre aponta para
 *    https://cinerie.com/sitemap.xml. Puro: sem DB, sem rede.
 */
// Le a flag por REQUEST, nao no build. Ver o bloco acima.
export const dynamic = "force-dynamic";

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
