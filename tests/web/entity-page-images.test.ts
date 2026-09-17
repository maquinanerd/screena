/**
 * entity-page-images.test.ts — a lista de arte que a ficha de filme ou serie
 * EXIBE, a mesma que o JSON-LD declara e que o shard de sitemap anuncia.
 *
 * A licenca e decidida antes (`selectMovieMedia`/`selectSeriesMedia` sob a
 * autorizacao de `source_licenses`); os casos abaixo passam pelos presenters
 * REAIS para provar que licenca negada e caminho malformado nao chegam a lista.
 */

import { authorizeImageDisplay, IMAGE_DISPLAY_DENIED } from "@screena/public-contracts";
import { describe, expect, it } from "vitest";

import { entityPageImageUrls } from "../../apps/web/src/lib/entity-page-images";
import { selectMovieMedia } from "../../apps/web/src/lib/movie-presenter";
import { selectSeriesMedia } from "../../apps/web/src/lib/series-presenter";

const SITE = "https://cinerie.com";
const LICENCIADA = authorizeImageDisplay([
  {
    sourceKey: "tmdb",
    contentType: "image",
    licenseStatus: "official",
    displayAllowed: true,
    isCurrent: true,
  },
]);
const ARTE_TMDB = { posterPath: "/poster.jpg", backdropPath: "/fundo.jpg" };

describe("entityPageImageUrls", () => {
  it("CONTROLE: a autorizacao de teste libera a arte do TMDB", () => {
    expect(LICENCIADA.authorized).toBe(true);
  });

  it("poster primeiro, depois backdrop, nos tamanhos que a ficha exibe", () => {
    expect(entityPageImageUrls(selectMovieMedia(ARTE_TMDB, LICENCIADA), SITE)).toEqual([
      "https://image.tmdb.org/t/p/w500/poster.jpg",
      "https://image.tmdb.org/t/p/w1280/fundo.jpg",
    ]);
    expect(entityPageImageUrls(selectSeriesMedia(ARTE_TMDB, LICENCIADA), SITE)).toEqual([
      "https://image.tmdb.org/t/p/w500/poster.jpg",
      "https://image.tmdb.org/t/p/w1280/fundo.jpg",
    ]);
  });

  it("licenca negada: a ficha nao exibe arte do TMDB, e a lista sai vazia", () => {
    expect(entityPageImageUrls(selectMovieMedia(ARTE_TMDB, IMAGE_DISPLAY_DENIED), SITE)).toEqual([]);
    expect(entityPageImageUrls(selectSeriesMedia(ARTE_TMDB, IMAGE_DISPLAY_DENIED), SITE)).toEqual([]);
  });

  it("caminho local do site sai absoluto na origem; URL externa na coluna nao entra", () => {
    const media = selectSeriesMedia(
      { posterPath: "/media/series/dark.webp", backdropPath: "https://outro.test/x.jpg" },
      LICENCIADA,
    );
    expect(entityPageImageUrls(media, SITE)).toEqual(["https://cinerie.com/media/series/dark.webp"]);
  });

  it("a mesma arte nos dois papeis entra uma vez; sem arte, lista vazia", () => {
    const repetida = { src: "https://image.tmdb.org/t/p/w500/a.jpg" };
    expect(entityPageImageUrls({ poster: repetida, backdrop: repetida }, SITE)).toEqual([
      "https://image.tmdb.org/t/p/w500/a.jpg",
    ]);
    expect(entityPageImageUrls({ poster: null, backdrop: null }, SITE)).toEqual([]);
  });
});
