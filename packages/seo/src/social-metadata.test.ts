/**
 * Cartao social das paginas que nao sao materia.
 *
 * O que se trava: a imagem segue a ordem da D4 e nunca e inventada; `og:url` e a
 * canonical; o locale sai no formato do Open Graph; e o cartao grande do X so
 * existe com arte horizontal.
 */

import { describe, expect, it } from "vitest";

import {
  buildSocialOpenGraph,
  buildSocialTwitter,
  pickSocialImage,
  toOpenGraphLocale,
  type SocialImage,
  type SocialPageFacts,
} from "./social-metadata.js";

const BACKDROP: SocialImage = {
  url: "https://image.tmdb.org/t/p/w1280/bd.jpg",
  alt: "",
  shape: "landscape",
};
const POSTER: SocialImage = {
  url: "https://image.tmdb.org/t/p/w500/ps.jpg",
  alt: "A Origem",
  shape: "portrait",
};
const MARCA: SocialImage = {
  url: "https://cinerie.com/brand/cinerie-social-card.png",
  alt: "Cinerie",
  shape: "landscape",
  width: 1200,
  height: 630,
};

const FILME: SocialPageFacts<"video.movie"> = {
  type: "video.movie",
  title: "A Origem (2010) — Filme",
  description: "Um ladrão que invade sonhos.",
  canonicalUrl: "https://cinerie.com/pt/filmes/a-origem/",
  siteName: "Cinerie",
  language: "pt-BR",
  images: [BACKDROP, POSTER, MARCA],
};

describe("og:locale", () => {
  it("(1) pt-BR vira pt_BR — o Open Graph usa sublinhado", () => {
    expect(toOpenGraphLocale("pt-BR")).toBe("pt_BR");
    expect(toOpenGraphLocale(" en-US ")).toBe("en_US");
    expect(toOpenGraphLocale("pt")).toBe("pt");
  });
});

describe("a imagem segue a ordem da D4", () => {
  it("(2) a primeira candidata que existe vence", () => {
    expect(pickSocialImage([BACKDROP, POSTER, MARCA])).toBe(BACKDROP);
    expect(pickSocialImage([null, POSTER, MARCA])).toBe(POSTER);
  });

  it("(3) sem arte da pagina, a marca assume — e nada alem dela e inventado", () => {
    expect(pickSocialImage([null, null, MARCA])).toBe(MARCA);
    expect(pickSocialImage([null, null])).toBeNull();
    expect(pickSocialImage([])).toBeNull();
  });

  it("(4) caminho relativo nao e candidata: o robo da rede social nao o resolve", () => {
    expect(pickSocialImage([{ ...POSTER, url: "/media/tmdb/ps.jpg" }, MARCA])).toBe(MARCA);
  });
});

describe("Open Graph", () => {
  it("(5) og:url e a canonical; tipo, site e locale saem sempre", () => {
    const og = buildSocialOpenGraph(FILME);
    expect(og).toMatchObject({
      type: "video.movie",
      title: FILME.title,
      description: FILME.description,
      url: FILME.canonicalUrl,
      siteName: "Cinerie",
      locale: "pt_BR",
    });
  });

  it("(6) alt vazio cai no titulo; dimensoes so quando conhecidas", () => {
    expect(buildSocialOpenGraph(FILME).images).toEqual([{ url: BACKDROP.url, alt: FILME.title }]);
    expect(buildSocialOpenGraph({ ...FILME, images: [null, MARCA] }).images).toEqual([
      { url: MARCA.url, alt: "Cinerie", width: 1200, height: 630 },
    ]);
  });

  it("(7) sem imagem nenhuma, nao declara images", () => {
    expect(buildSocialOpenGraph({ ...FILME, images: [null] })).not.toHaveProperty("images");
  });

  it("(8) sem canonical nao ha og:url; descricao vazia e omitida", () => {
    const og = buildSocialOpenGraph({ ...FILME, canonicalUrl: null, description: "   " });
    expect(og).not.toHaveProperty("url");
    expect(og).not.toHaveProperty("description");
    expect(og.locale).toBe("pt_BR");
  });
});

describe("cartao do X", () => {
  it("(9) arte horizontal => summary_large_image com a imagem", () => {
    const tw = buildSocialTwitter(FILME);
    expect(tw.card).toBe("summary_large_image");
    expect(tw.images).toEqual([BACKDROP.url]);
  });

  it("(10) poster ou retrato => summary: o recorte 2:1 cortaria a arte", () => {
    const tw = buildSocialTwitter({ ...FILME, images: [null, POSTER, MARCA] });
    expect(tw.card).toBe("summary");
    expect(tw.images).toEqual([POSTER.url]);
  });

  it("(11) so a marca => summary_large_image, porque o cartao da marca e 1200x630", () => {
    expect(buildSocialTwitter({ ...FILME, images: [MARCA] }).card).toBe("summary_large_image");
  });

  it("(12) sem imagem => summary, sem images", () => {
    const tw = buildSocialTwitter({ ...FILME, images: [] });
    expect(tw.card).toBe("summary");
    expect(tw).not.toHaveProperty("images");
  });
});
