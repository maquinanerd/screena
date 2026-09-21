/**
 * A extensao de imagem do sitemap — a compensacao da decisao do dono D1.
 *
 * A galeria saiu do indice como pagina propria; a imagem continua descobrivel
 * pela entidade dona. O que se trava aqui: o XML sem imagem NAO muda nem um byte,
 * e o XML com imagem declara o namespace e escapa a URL.
 */

import { describe, expect, it } from "vitest";

import { SITEMAP_PROTOCOL_URL_LIMIT, SITEMAP_URL_LIMIT } from "./sitemap-plan.js";
import { SITEMAP_IMAGE_NAMESPACE, renderUrlset, type SitemapXmlUrl } from "./sitemap-xml.js";

const URL_BASE = { loc: "https://cinerie.com/pt/filmes/a-origem/" };

describe("sitemap — extensao de imagem", () => {
  it("(1) sem imagem, o urlset sai EXATAMENTE como antes (sem namespace de imagem)", () => {
    const xml = renderUrlset([URL_BASE]);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).not.toContain("xmlns:image");
    expect(xml).not.toContain("<image:image>");
  });

  it("(2) com imagem, declara o namespace e emite image:loc dentro do url", () => {
    const xml = renderUrlset([
      { ...URL_BASE, images: [{ loc: "https://image.tmdb.org/t/p/w500/abc.jpg" }] },
    ]);
    expect(xml).toContain(`xmlns:image="${SITEMAP_IMAGE_NAMESPACE}"`);
    expect(xml).toContain("<image:loc>https://image.tmdb.org/t/p/w500/abc.jpg</image:loc>");
    // Dentro do <url> certo, e nao solto no urlset.
    const url = xml.slice(xml.indexOf("<url>"), xml.indexOf("</url>"));
    expect(url).toContain("<image:image>");
  });

  it("(3) a URL da imagem e escapada como qualquer outro texto do XML", () => {
    const xml = renderUrlset([{ ...URL_BASE, images: [{ loc: "https://x.test/a.jpg?w=1&h=2" }] }]);
    expect(xml).toContain("<image:loc>https://x.test/a.jpg?w=1&amp;h=2</image:loc>");
  });

  it("(4) imagem com loc vazia ou so espaco NAO conta — nem declara o namespace", () => {
    const xml = renderUrlset([{ ...URL_BASE, images: [{ loc: "" }, { loc: "   " }] }]);
    expect(xml).not.toContain("xmlns:image");
    expect(xml).not.toContain("<image:image>");
  });

  it("(5) numa lista mista, so a url com imagem ganha image:image", () => {
    const xml = renderUrlset([
      URL_BASE,
      { loc: "https://cinerie.com/pt/series/dark/", images: [{ loc: "https://x.test/d.jpg" }] },
    ]);
    const blocos = xml.split("<url>").slice(1);
    expect(blocos[0]).not.toContain("<image:image>");
    expect(blocos[1]).toContain("<image:image>");
  });

  it("(6) as imagens de uma url saem todas, na ordem recebida, dentro do mesmo <url>", () => {
    const xml = renderUrlset([
      {
        ...URL_BASE,
        images: [
          { loc: "https://image.tmdb.org/t/p/w500/poster.jpg" },
          { loc: "https://image.tmdb.org/t/p/w1280/fundo.jpg" },
        ],
      },
    ]);
    const url = xml.slice(xml.indexOf("<url>"), xml.indexOf("</url>"));
    expect(Array.from(url.matchAll(/<image:loc>([^<]*)<\/image:loc>/g), (m) => m[1])).toEqual([
      "https://image.tmdb.org/t/p/w500/poster.jpg",
      "https://image.tmdb.org/t/p/w1280/fundo.jpg",
    ]);
  });
});

/**
 * Os limites do protocolo por arquivo (sitemaps.org): 50.000 URLs e 52.428.800
 * bytes descomprimidos. A CONTAGEM ja e o teto do shard (`SITEMAP_URL_LIMIT`); o
 * que a imagem acrescenta e BYTE — e e isso que se mede aqui.
 */
const PROTOCOL_MAX_BYTES = 52_428_800;

/**
 * O orcamento da CINERIE por arquivo, bem abaixo do protocolo. Medido em
 * 21/09/2026: o arquivo de filmes com 50.000 URLs tinha 20,4 MB crus e levava
 * 7,9 s para sair, montado a cada pedido. O arquivo leve e o motivo de
 * `SITEMAP_URL_LIMIT` ser 10.000.
 */
const CINERIE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Uma URL de ficha como o shard de filmes a emite: `lastmod`, `changefreq`
 * monthly, `priority` 0.5, poster w500 e backdrop w1280 com caminhos do TMDB no
 * formato real (barra, 27 caracteres, extensao).
 */
function fichaComArte(slugLength: number, i: number): SitemapXmlUrl {
  const sufixo = `-${String(i).padStart(5, "0")}`;
  const caminho = `/${"x".repeat(27)}.jpg`;
  return {
    loc: `https://cinerie.com/pt/filmes/${"a".repeat(slugLength - sufixo.length)}${sufixo}/`,
    lastmod: "2026-09-15T12:00:00.000Z",
    changefreq: "monthly",
    priority: 0.5,
    images: [
      { loc: `https://image.tmdb.org/t/p/w500${caminho}` },
      { loc: `https://image.tmdb.org/t/p/w1280${caminho}` },
    ],
  };
}

describe("sitemap — orcamento de bytes com imagem", () => {
  const xmlDe = (quantas: number): string =>
    renderUrlset(Array.from({ length: quantas }, (_, i) => fichaComArte(250, i)));
  const porUrl = xmlDe(2).length - xmlDe(1).length;
  const cabecalho = xmlDe(1).length - porUrl;

  it("(7) um arquivo no limite do PROTOCOLO (50.000 URLs), com duas imagens e slug de 250 caracteres, cabe em 50 MB", () => {
    // Tudo ASCII: o comprimento da string E o numero de bytes.
    expect(xmlDe(3)).toMatch(/^[\x20-\x7e\n]*$/);
    // CONTROLE: o tamanho e linear no numero de URLs, entao a projecao vale.
    expect(xmlDe(1_000).length).toBe(cabecalho + 1_000 * porUrl);

    // Vale para o limite do protocolo, nao so para o nosso: se o teto por arquivo
    // voltar a subir, o renderer continua cabendo.
    expect(cabecalho + SITEMAP_PROTOCOL_URL_LIMIT * porUrl).toBeLessThan(PROTOCOL_MAX_BYTES);

    // A folga: cada caractere de slug e um byte na <loc>. Ate este slug medio, um
    // arquivo cheio de fichas com duas imagens continua dentro do limite.
    const slugMaximo =
      250 + Math.floor((PROTOCOL_MAX_BYTES - cabecalho) / SITEMAP_PROTOCOL_URL_LIMIT) - porUrl;
    expect(slugMaximo).toBeGreaterThanOrEqual(500);
  });

  it("(8) o arquivo da Cinerie fica abaixo do protocolo em URLs e dentro de 10 MB no pior slug", () => {
    expect(SITEMAP_URL_LIMIT).toBeLessThanOrEqual(SITEMAP_PROTOCOL_URL_LIMIT);
    // Slug de 250 caracteres e o pior caso real; a ficha media tem slug curto.
    expect(cabecalho + SITEMAP_URL_LIMIT * porUrl).toBeLessThan(CINERIE_MAX_BYTES);
  });

  it("(9) CONTROLE: com o teto antigo (50.000), o mesmo arquivo passaria do orcamento da Cinerie", () => {
    // Prova que o (8) mede alguma coisa: o teto de 50.000 que vigorou ate
    // 21/09/2026 estoura os 10 MB no pior slug.
    expect(cabecalho + SITEMAP_PROTOCOL_URL_LIMIT * porUrl).toBeGreaterThan(CINERIE_MAX_BYTES);
  });
});
