/**
 * social-metadata.test.ts — a ponte do cartao social entre as paginas e o pacote.
 *
 * O que se trava aqui e o que e do SITE: a marca como ultima candidata (D4), a
 * URL absoluta e o objeto completo (nome e idioma) que impede a pagina de apagar
 * o `og:locale` do layout. As regras do cartao em si sao testadas no pacote.
 */

import { describe, expect, it } from "vitest";

import { CINERIE_SOCIAL_CARD } from "../brand-logos";
import { absoluteAssetUrl, socialArt, socialMetadata } from "../social-metadata";

const POSTER = "https://image.tmdb.org/t/p/w500/p.jpg";

describe("a ponte do cartao social", () => {
  it("(1) caminho do site vira URL absoluta; URL absoluta passa intacta", () => {
    expect(absoluteAssetUrl("/media/x.jpg", "https://cinerie.com")).toBe("https://cinerie.com/media/x.jpg");
    expect(absoluteAssetUrl("media/x.jpg", "https://cinerie.com/")).toBe("https://cinerie.com/media/x.jpg");
    expect(absoluteAssetUrl(POSTER, "https://cinerie.com")).toBe(POSTER);
  });

  it("(2) pagina sem arte leva a MARCA, com dimensoes e cartao grande", () => {
    const { openGraph, twitter } = socialMetadata({
      type: "website",
      title: "Filmes",
      description: "Explore os filmes.",
      canonicalUrl: "https://cinerie.com/pt/filmes/",
    });
    const [imagem] = openGraph.images ?? [];
    expect(imagem?.url.endsWith(CINERIE_SOCIAL_CARD.src)).toBe(true);
    expect(imagem).toMatchObject({ alt: "Cinerie", width: 1200, height: 630 });
    expect(twitter.card).toBe("summary_large_image");
  });

  it("(3) a arte da pagina vence a marca, e o objeto sai completo", () => {
    const { openGraph, twitter } = socialMetadata({
      type: "video.movie",
      title: "A Origem (2010) — Filme",
      description: null,
      canonicalUrl: "https://cinerie.com/pt/filmes/a-origem/",
      images: [null, socialArt({ src: POSTER }, "A Origem", "portrait")],
    });
    expect(openGraph).toMatchObject({
      type: "video.movie",
      url: "https://cinerie.com/pt/filmes/a-origem/",
      siteName: "Cinerie",
      locale: "pt_BR",
      images: [{ url: POSTER, alt: "A Origem" }],
    });
    expect(openGraph.images).toHaveLength(1);
    // Poster no recorte 2:1 perderia o titulo: cartao pequeno.
    expect(twitter).toMatchObject({ card: "summary", images: [POSTER] });
  });

  it("(4) sem arte, socialArt nao inventa candidata", () => {
    expect(socialArt(null, "A Origem", "landscape")).toBeNull();
  });
});
