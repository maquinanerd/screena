import { describe, expect, it } from "vitest";

import { buildMediaBand, type MediaBandInput } from "../media-band-presenter";

const BASE: MediaBandInput = {
  imagesPath: "/pt/filmes/x/imagens/",
  videosPath: "/pt/filmes/x/videos/",
  newsAnchor: "#movie-news-title",
  newsCount: 2,
  imageCount: 40,
  videoCount: 6,
  backdropUrl: "https://image.tmdb.org/t/p/w1280/backdrop.jpg",
  hasTrailer: true,
};

const art = (cards: ReturnType<typeof buildMediaBand>["cards"]) => cards.map((card) => card.backgroundUrl);

describe("banda de mídia: um quadro diferente em cada cartão", () => {
  it("com cenas e capa de notícia, os três cartões têm imagens diferentes", () => {
    const band = buildMediaBand({
      ...BASE,
      sceneUrls: ["https://cdn/cena-1.jpg", "https://cdn/cena-2.jpg", "https://cdn/cena-3.jpg"],
      newsImageUrl: "/media/noticia.webp",
    });
    expect(art(band.cards)).toEqual(["https://cdn/cena-1.jpg", "/media/noticia.webp", "https://cdn/cena-2.jpg"]);
    expect(new Set(art(band.cards)).size).toBe(3);
  });

  it("sem capa de notícia, o cartão de notícias pega a próxima cena", () => {
    const band = buildMediaBand({ ...BASE, sceneUrls: ["a.jpg", "b.jpg", "c.jpg"], newsImageUrl: null });
    expect(art(band.cards)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("com arte de menos, completa com o backdrop e só repete quando não há outra", () => {
    const band = buildMediaBand({ ...BASE, sceneUrls: ["a.jpg"] });
    expect(art(band.cards)).toEqual(["a.jpg", BASE.backdropUrl, BASE.backdropUrl]);
  });

  it("sem cena nenhuma, continua como antes (backdrop) — nunca imagem inventada", () => {
    const band = buildMediaBand(BASE);
    expect(art(band.cards)).toEqual([BASE.backdropUrl, BASE.backdropUrl, BASE.backdropUrl]);
    const semArte = buildMediaBand({ ...BASE, backdropUrl: null });
    expect(art(semArte.cards)).toEqual([null, null, null]);
  });

  it("cartão sem destino continua não existindo, e não consome cena", () => {
    const band = buildMediaBand({ ...BASE, newsCount: 0, sceneUrls: ["a.jpg", "b.jpg"] });
    expect(band.cards.map((card) => card.key)).toEqual(["imagens", "videos"]);
    expect(art(band.cards)).toEqual(["a.jpg", "b.jpg"]);
  });
});
