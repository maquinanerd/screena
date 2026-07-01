/**
 * Testes puros do presenter da pagina de filme.
 *
 * Garantem que o mapeamento NAO inventa fatos (nunca fabrica descricao) e que ha
 * fallback seguro quando ano/duracao estao ausentes; alem da filtragem de blocos
 * por `review_status` publicavel e da contagem distinta por tipo.
 */

import { describe, expect, it } from "vitest";

import {
  formatRuntime,
  normalizeLocalImagePath,
  presentMovie,
  selectMovieMedia,
  selectMetaDescription,
  selectRenderableBlocks,
  selectTitle,
  type MovieContentBlockInput,
  type MovieTranslationInput,
} from "../../apps/web/src/lib/movie-presenter";

const baseRecord = {
  titleOriginal: "Original Title",
  year: 1999,
  runtimeMinutes: 121,
  posterPath: null,
  backdropPath: null,
};

function translation(
  overrides: Partial<MovieTranslationInput> = {},
): MovieTranslationInput {
  return {
    title: null,
    metaTitle: null,
    metaDescription: null,
    summary: null,
    ...overrides,
  };
}

describe("formatRuntime", () => {
  it("retorna null quando ausente ou invalido", () => {
    expect(formatRuntime(null)).toBeNull();
    expect(formatRuntime(0)).toBeNull();
    expect(formatRuntime(-5)).toBeNull();
  });

  it("formata horas e minutos", () => {
    expect(formatRuntime(121)).toBe("2 h 1 min");
    expect(formatRuntime(120)).toBe("2 h");
    expect(formatRuntime(47)).toBe("47 min");
  });
});

describe("selectMetaDescription (nunca inventa descricao)", () => {
  it("sem traducao -> null", () => {
    expect(selectMetaDescription(null)).toBeNull();
  });

  it("sem meta_description nem summary -> null", () => {
    expect(selectMetaDescription(translation())).toBeNull();
  });

  it("usa meta_description, com fallback para summary", () => {
    expect(selectMetaDescription(translation({ metaDescription: "  desc  ", summary: "s" }))).toBe(
      "desc",
    );
    expect(selectMetaDescription(translation({ metaDescription: "", summary: " resumo " }))).toBe(
      "resumo",
    );
  });
});

describe("selectTitle", () => {
  it("prefere a traducao pt-BR", () => {
    expect(selectTitle(baseRecord, translation({ title: " Titulo PT " }))).toBe(
      "Titulo PT",
    );
  });

  it("cai para o titulo original quando nao ha traducao", () => {
    expect(selectTitle(baseRecord, null)).toBe("Original Title");
  });
});

describe("selectRenderableBlocks", () => {
  it("mantem so blocos publicaveis, em ordem canonica", () => {
    const blocks: MovieContentBlockInput[] = [
      { blockType: "faq", content: "f", reviewStatus: "published" },
      { blockType: "editorial_intro", content: "e", reviewStatus: "human_reviewed" },
      { blockType: "cast_intro", content: "c", reviewStatus: "ai_generated" },
      { blockType: "where_to_watch_text", content: "w", reviewStatus: "needs_review" },
    ];
    const renderable = selectRenderableBlocks(blocks);
    expect(renderable.map((block) => block.blockType)).toEqual([
      "editorial_intro",
      "faq",
    ]);
  });

  it("ignora duplicatas do mesmo block_type", () => {
    const blocks: MovieContentBlockInput[] = [
      { blockType: "editorial_intro", content: "a", reviewStatus: "published" },
      { blockType: "editorial_intro", content: "b", reviewStatus: "published" },
    ];
    expect(selectRenderableBlocks(blocks)).toHaveLength(1);
  });
});

describe("movie media presenter", () => {
  it("normaliza somente paths locais seguros", () => {
    expect(normalizeLocalImagePath(null)).toBeNull();
    expect(normalizeLocalImagePath("")).toBeNull();
    expect(normalizeLocalImagePath("   ")).toBeNull();
    expect(normalizeLocalImagePath(" /media/movies/poster.jpg ")).toBe(
      "/media/movies/poster.jpg",
    );
    expect(normalizeLocalImagePath("/uploads/movies/backdrop.webp")).toBe(
      "/uploads/movies/backdrop.webp",
    );
    expect(normalizeLocalImagePath("/brand/logo.png")).toBe("/brand/logo.png");
  });

  it("recusa URLs externas e paths TMDB crus", () => {
    expect(normalizeLocalImagePath("https://image.tmdb.org/t/p/w342/a.jpg")).toBeNull();
    expect(normalizeLocalImagePath("https://example.com/poster.jpg")).toBeNull();
    expect(normalizeLocalImagePath("http://example.com/poster.jpg")).toBeNull();
    expect(normalizeLocalImagePath("//example.com/poster.jpg")).toBeNull();
    expect(normalizeLocalImagePath("/abc.jpg")).toBeNull();
    expect(normalizeLocalImagePath("/poster.jpg?size=w342")).toBeNull();
    expect(normalizeLocalImagePath("/media/../secret.jpg")).toBeNull();
  });

  it("seleciona poster/backdrop locais seguros", () => {
    const media = selectMovieMedia(
      {
        posterPath: "/media/movies/poster.webp",
        backdropPath: "/uploads/movies/backdrop.jpg",
      },
    );
    expect(media.hasRealImage).toBe(true);
    expect(media.poster?.src).toBe("/media/movies/poster.webp");
    expect(media.backdrop?.src).toBe("/uploads/movies/backdrop.jpg");
  });

  it("mantem placeholders quando nao ha path local permitido", () => {
    const media = selectMovieMedia(
      { posterPath: "/poster.jpg", backdropPath: "/backdrop.jpg" },
    );
    expect(media).toEqual({ poster: null, backdrop: null, hasRealImage: false });
  });
});

describe("presentMovie", () => {
  it("fallback seguro quando ano/duracao ausentes; nao inventa descricao", () => {
    const view = presentMovie({
      record: {
        titleOriginal: "Sem Dados",
        year: null,
        runtimeMinutes: null,
        posterPath: null,
        backdropPath: null,
      },
      translation: null,
      blocks: [],
    });
    expect(view.title).toBe("Sem Dados");
    expect(view.year).toBeNull();
    expect(view.runtimeMinutes).toBeNull();
    expect(view.runtimeLabel).toBeNull();
    expect(view.metaDescription).toBeNull();
    expect(view.blocks).toEqual([]);
    expect(view.renderableBlockCount).toBe(0);
    expect(view.media.hasRealImage).toBe(false);
  });

  it("conta blocos renderizaveis distintos e usa dados existentes", () => {
    const view = presentMovie({
      record: baseRecord,
      translation: translation({ metaDescription: "d" }),
      blocks: [
        { blockType: "editorial_intro", content: "e", reviewStatus: "published" },
        { blockType: "faq", content: "f", reviewStatus: "human_reviewed" },
        { blockType: "cast_intro", content: "c", reviewStatus: "ai_generated" },
      ],
    });
    expect(view.renderableBlockCount).toBe(2);
    expect(view.metaDescription).toBe("d");
    expect(view.runtimeLabel).toBe("2 h 1 min");
    expect(view.year).toBe(1999);
  });
});
