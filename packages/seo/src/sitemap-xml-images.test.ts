/**
 * A extensao de imagem do sitemap — a compensacao da decisao do dono D1.
 *
 * A galeria saiu do indice como pagina propria; a imagem continua descobrivel
 * pela entidade dona. O que se trava aqui: o XML sem imagem NAO muda nem um byte,
 * e o XML com imagem declara o namespace e escapa a URL.
 */

import { describe, expect, it } from "vitest";

import { SITEMAP_URL_LIMIT } from "./sitemap-plan.js";
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
  it("(7) shard cheio (50.000 URLs), duas imagens por URL e slug de 250 caracteres cabe em 50 MB", () => {
    const xmlDe = (quantas: number): string =>
      renderUrlset(Array.from({ length: quantas }, (_, i) => fichaComArte(250, i)));
    // Tudo ASCII: o comprimento da string E o numero de bytes.
    expect(xmlDe(3)).toMatch(/^[\x20-\x7e\n]*$/);

    const porUrl = xmlDe(2).length - xmlDe(1).length;
    const cabecalho = xmlDe(1).length - porUrl;
    // CONTROLE: o tamanho e linear no numero de URLs, entao a projecao vale.
    expect(xmlDe(1_000).length).toBe(cabecalho + 1_000 * porUrl);

    expect(cabecalho + SITEMAP_URL_LIMIT * porUrl).toBeLessThan(PROTOCOL_MAX_BYTES);

    // A folga: cada caractere de slug e um byte na <loc>. Ate este slug medio, um
    // shard cheio de fichas com duas imagens continua dentro do limite.
    const slugMaximo = 250 + Math.floor((PROTOCOL_MAX_BYTES - cabecalho) / SITEMAP_URL_LIMIT) - porUrl;
    expect(slugMaximo).toBeGreaterThanOrEqual(500);
  });
});
