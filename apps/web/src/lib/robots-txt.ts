import type { MetadataRoute } from "next";

import {
  OFFICIAL_SITE_URL,
  PRIVACY_PATH,
  TERMS_PATH,
  isOfficialIndexableEnvironment,
  isOfficialLegalDocsIndexableEnvironment,
  type SiteUrlEnv,
} from "./site";

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
 * POR QUE ESTE MODULO SAIU DE `app/robots.ts` (22/09/2026): a rota de metadados
 * do Next serializa somente `User-Agent`/`Allow`/`Disallow`/`Crawl-delay`. A D7
 * exige tambem a diretiva `Content-Signal`, que nao cabe naquele tipo — entao o
 * arquivo passou a ser um Route Handler (`app/robots.txt/route.ts`) alimentado
 * por `renderRobotsTxt`. `buildRobots` continua sendo a fonte das regras, com os
 * mesmos testes.
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

/**
 * Crawlers de TREINO de modelo — bloqueados pela D7 (decisao do dono,
 * 11/09/2026: "crawlers de busca/resposta ao vivo seguem liberados; crawlers de
 * treino seguem bloqueados").
 *
 * Nao confundir com os tokens de BUSCA/RESPOSTA AO VIVO, que a D7 mantem
 * liberados e que por isso NAO aparecem aqui: `Googlebot`, `Googlebot-News`,
 * `Bingbot`, `Applebot`, `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`,
 * `Claude-User`, `PerplexityBot`. O casamento de user-agent e por TOKEN, nao por
 * prefixo (RFC 9309 §2.2.1): `ClaudeBot` nao pega `Claude-User`, e
 * `Applebot-Extended` nao pega `Applebot`.
 *
 * Os de busca tambem NAO ganham grupo proprio de propósito: um grupo so para
 * eles os tiraria do grupo `*` e, com isso, do `Disallow: /api/`, `/dev/` e
 * `/admin/` — o crawler obedece a UM grupo so, o mais especifico.
 */
export const AI_TRAINING_USER_AGENTS: readonly string[] = [
  "Amazonbot",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "ClaudeBot",
  "Google-Extended",
  "GPTBot",
  "meta-externalagent",
];

/**
 * A declaracao legivel por maquina de https://contentsignals.org: o que pode ser
 * feito com o conteudo do site, separado por finalidade. `search=yes` e
 * `ai-input=yes` mantem busca e resposta ao vivo liberadas; `ai-train=no` reserva
 * o uso para treino.
 *
 * Ela SOZINHA nao basta — diretiva desconhecida e ignorada por parser antigo
 * (RFC 9309 §2.2.4). Por isso o bloqueio explicito de `AI_TRAINING_USER_AGENTS`
 * anda junto: um declara a reserva, o outro a aplica em quem nao a entende.
 */
export const CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=no";

type RobotsRule = {
  userAgent?: string | string[];
  allow?: string | string[];
  disallow?: string | string[];
};

function toList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Serializa o robots.txt final. A forma dos grupos de `buildRobots` e a MESMA
 * que o gerador do Next produzia (`User-Agent:`, depois `Allow:`, depois
 * `Disallow:`, e os `Sitemap:` no fim, apos linha em branco) — a unica diferenca
 * em producao oficial e o que a D7 acrescenta.
 *
 * Fora da producao oficial nada da D7 e emitido, e nao e omissao: aquele ramo ja
 * responde `Disallow: /` para `*`, que vale para TODO crawler, inclusive os de
 * treino. Repetir o bloqueio ali nao mudaria nada e criaria uma segunda verdade
 * para manter.
 */
export function renderRobotsTxt(env: SiteUrlEnv = process.env): string {
  const robots = buildRobots(env);
  const official = isOfficialIndexableEnvironment(env);
  const blocks: string[] = [];

  for (const rule of robots.rules as RobotsRule[]) {
    const lines: string[] = [];
    for (const agent of toList(rule.userAgent)) lines.push(`User-Agent: ${agent}`);
    // A diretiva vale para o grupo em que esta, e o grupo `*` e o unico que
    // descreve o site inteiro.
    if (official) lines.push(`Content-Signal: ${CONTENT_SIGNAL}`);
    for (const allow of toList(rule.allow)) lines.push(`Allow: ${allow}`);
    for (const disallow of toList(rule.disallow)) lines.push(`Disallow: ${disallow}`);
    blocks.push(lines.join("\n"));
  }

  if (official) {
    // Um grupo so, com os user-agents empilhados: e a forma mais antiga e mais
    // amplamente suportada de dizer "estes, todos, o mesmo". NENHUMA linha em
    // branco entre eles e o `Disallow` — linha em branco encerra o grupo.
    const training = [
      "# Crawlers de TREINO de modelo: bloqueados (decisão do dono, D7 de 11/09/2026).",
      "# Os de busca e resposta ao vivo continuam liberados pelo grupo acima.",
      ...AI_TRAINING_USER_AGENTS.map((agent) => `User-Agent: ${agent}`),
      "Disallow: /",
    ];
    blocks.push(training.join("\n"));
  }

  const sitemaps = toList(robots.sitemap);
  if (sitemaps.length > 0) {
    blocks.push(sitemaps.map((url) => `Sitemap: ${url}`).join("\n"));
  }

  const header = official
    ? [
        "# Política de conteúdo da Cinerie (https://contentsignals.org):",
        "# busca e resposta ao vivo LIBERADAS; uso para TREINO de modelo RESERVADO.",
        "",
      ].join("\n")
    : "";

  return `${header}${blocks.join("\n\n")}\n`;
}
