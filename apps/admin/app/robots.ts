import type { MetadataRoute } from "next";

/**
 * robots.txt do painel interno: NADA e rastreavel.
 *
 * O painel nao tem sitemap e nunca tera — nao ha pagina dele que deva ser
 * encontrada por busca. Este arquivo e a terceira camada, nao a primeira: o
 * middleware ja exige credencial em producao (um robo recebe 401) e ja manda
 * `X-Robots-Tag: noindex` em toda resposta; o layout declara `noindex` no HTML.
 * Ele existe para que um robo educado nem tente.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
