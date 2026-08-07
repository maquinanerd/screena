import type { MetadataRoute } from "next";

import {
  OFFICIAL_SITE_URL,
  PRIVACY_PATH,
  TERMS_PATH,
  isOfficialIndexableEnvironment,
  isOfficialLegalDocsIndexableEnvironment,
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
    // SITE FECHADO, DOCUMENTOS LEGAIS LIBERADOS.
    //
    // `CINERIE_LEGAL_DOCS_INDEXING_ENABLED` sozinha nao bastaria: o
    // `<meta robots>` de `/pt/termos/` e `/pt/privacidade/` diria `index`,
    // enquanto `Disallow: /` impediria o crawler de buscar a pagina — e ele
    // nunca leria o meta. O resultado nao seria "nao indexado": seria o pior
    // dos dois mundos, a URL entrando no indice SEM conteudo (o Google indexa
    // URL bloqueada que encontra por link). Por isso o robots.txt acompanha a
    // chave.
    //
    // `Allow` mais especifico vence `Disallow: /` (RFC 9309 §2.2.2: o match de
    // maior comprimento decide, e empate resolve a favor do allow). Nao ha
    // sitemap aqui de proposito: o sitemap lista o catalogo, que continua
    // noindex — anuncia-lo convidaria o crawler exatamente ao que esta fechado.
    if (isOfficialLegalDocsIndexableEnvironment(env)) {
      return {
        rules: [
          {
            userAgent: "*",
            allow: [TERMS_PATH, PRIVACY_PATH],
            disallow: "/",
          },
        ],
      };
    }

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
    // Os DOIS sitemaps sao anunciados. O de noticias e um arquivo separado
    // porque o Google News tem janela de 48h, teto de 1.000 URLs e namespace
    // proprio; mante-lo fora do robots.txt significaria depender de descoberta
    // por link, que para este arquivo nao existe.
    sitemap: [
      `${OFFICIAL_SITE_URL}/sitemap.xml`,
      `${OFFICIAL_SITE_URL}/news-sitemap.xml`,
    ],
  };
}

export default function robots(): MetadataRoute.Robots {
  return buildRobots();
}
