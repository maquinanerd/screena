/**
 * A extensao de imagem do sitemap — a compensacao da decisao do dono D1.
 *
 * A galeria saiu do indice como pagina propria; a imagem continua descobrivel
 * pela entidade dona. O que se trava aqui: o XML sem imagem NAO muda nem um byte,
 * e o XML com imagem declara o namespace e escapa a URL.
 */

import { describe, expect, it } from "vitest";

import { SITEMAP_IMAGE_NAMESPACE, renderUrlset } from "./sitemap-xml.js";

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
});
