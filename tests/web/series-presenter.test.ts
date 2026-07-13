/**
 * Testes puros do presenter da pagina publica de serie.
 *
 * Garantem que a view nao inventa dados, aplica o gate anti-thin e so aceita
 * imagens locais seguras.
 */

import { describe, expect, it } from "vitest";

import {
  buildSeriesPageView,
  evaluateSeriesIndexability,
  formatSeriesPeriod,
  normalizeSeriesLocalImagePath,
  selectRenderableSeriesBlocks,
  selectSeriesMedia,
  type SeriesContentBlockInput,
  type SeriesTranslationInput,
} from "../../apps/web/src/lib/series-presenter";

const baseRecord = {
  nameOriginal: "Original Series",
  firstAirYear: 2011,
  lastAirYear: 2019,
  numberOfSeasons: 8,
  numberOfEpisodes: 73,
  posterPath: null,
  backdropPath: null,
};

function translation(
  overrides: Partial<SeriesTranslationInput> = {},
): SeriesTranslationInput {
  return {
    title: null,
    metaTitle: null,
    metaDescription: null,
    summary: null,
    ...overrides,
  };
}

describe("formatSeriesPeriod", () => {
  it("retorna null quando nao ha anos validos", () => {
    expect(formatSeriesPeriod(null, null)).toBeNull();
    expect(formatSeriesPeriod(0, -1)).toBeNull();
  });

  it("formata ano unico ou periodo", () => {
    expect(formatSeriesPeriod(2011, 2019)).toBe("2011-2019");
    expect(formatSeriesPeriod(2011, 2011)).toBe("2011");
    expect(formatSeriesPeriod(2011, null)).toBe("2011");
  });
});

describe("selectRenderableSeriesBlocks", () => {
  it("mantem so blocos publicaveis, nao vazios, em ordem canonica", () => {
    const blocks: SeriesContentBlockInput[] = [
      { blockType: "faq", content: "f", reviewStatus: "published" },
      { blockType: "editorial_intro", content: "e", reviewStatus: "human_reviewed" },
      { blockType: "cast_intro", content: "c", reviewStatus: "ai_generated" },
      { blockType: "season_guide", content: "   ", reviewStatus: "published" },
    ];
    const renderable = selectRenderableSeriesBlocks(blocks);
    expect(renderable.map((block) => block.blockType)).toEqual([
      "editorial_intro",
      "faq",
    ]);
  });

  it("ignora duplicatas do mesmo block_type", () => {
    const blocks: SeriesContentBlockInput[] = [
      { blockType: "editorial_intro", content: "a", reviewStatus: "published" },
      { blockType: "editorial_intro", content: "b", reviewStatus: "published" },
    ];
    expect(selectRenderableSeriesBlocks(blocks)).toHaveLength(1);
  });
});

describe("evaluateSeriesIndexability (indexacao total)", () => {
  it("indexa mesmo com menos de dois blocos (a ficha da serie basta)", () => {
    expect(evaluateSeriesIndexability({ renderableBlockCount: 0 }).decision).toBe(
      "index",
    );
    expect(evaluateSeriesIndexability({ renderableBlockCount: 1 }).decision).toBe(
      "index",
    );
  });

  it("indexa com dois ou mais blocos (pagina rica)", () => {
    const rich = evaluateSeriesIndexability({ renderableBlockCount: 2 });
    expect(rich.decision).toBe("index");
    expect(rich.hasUniqueValue).toBe(true);
  });
});

describe("series media presenter", () => {
  it("normaliza somente paths locais seguros", () => {
    expect(normalizeSeriesLocalImagePath(null)).toBeNull();
    expect(normalizeSeriesLocalImagePath("")).toBeNull();
    expect(normalizeSeriesLocalImagePath(" /media/series/poster.jpg ")).toBe(
      "/media/series/poster.jpg",
    );
    expect(normalizeSeriesLocalImagePath("/uploads/series/backdrop.webp")).toBe(
      "/uploads/series/backdrop.webp",
    );
    expect(normalizeSeriesLocalImagePath("/brand/logo.png")).toBe("/brand/logo.png");
  });

  it("recusa URLs externas e paths TMDB crus", () => {
    expect(normalizeSeriesLocalImagePath("https://image.tmdb.org/t/p/w342/a.jpg")).toBeNull();
    expect(normalizeSeriesLocalImagePath("https://example.com/poster.jpg")).toBeNull();
    expect(normalizeSeriesLocalImagePath("http://example.com/poster.jpg")).toBeNull();
    expect(normalizeSeriesLocalImagePath("//example.com/poster.jpg")).toBeNull();
    expect(normalizeSeriesLocalImagePath("/abc.jpg")).toBeNull();
    expect(normalizeSeriesLocalImagePath("/poster.jpg?size=w342")).toBeNull();
    expect(normalizeSeriesLocalImagePath("/media/../secret.jpg")).toBeNull();
  });

  it("seleciona poster/backdrop locais seguros", () => {
    const media = selectSeriesMedia({
      posterPath: "/media/series/poster.webp",
      backdropPath: "/uploads/series/backdrop.jpg",
    });
    expect(media.hasRealImage).toBe(true);
    expect(media.poster?.src).toBe("/media/series/poster.webp");
    expect(media.backdrop?.src).toBe("/uploads/series/backdrop.jpg");
  });

  it("monta URL remota do TMDB para file_path cru (poster w500 / backdrop w1280)", () => {
    const media = selectSeriesMedia({
      posterPath: "/poster.jpg",
      backdropPath: "/backdrop.jpg",
    });
    expect(media.hasRealImage).toBe(true);
    expect(media.poster?.src).toBe("https://image.tmdb.org/t/p/w500/poster.jpg");
    expect(media.backdrop?.src).toBe("https://image.tmdb.org/t/p/w1280/backdrop.jpg");
  });

  it("mantem fallback visual quando o path e externo/invalido", () => {
    const media = selectSeriesMedia({
      posterPath: "https://x.com/p.jpg",
      backdropPath: "/media/../secret.jpg",
    });
    expect(media).toEqual({ poster: null, backdrop: null, hasRealImage: false });
  });
});

describe("buildSeriesPageView", () => {
  it("usa dados minimos sem inventar descricao, temporadas ou episodios", () => {
    const view = buildSeriesPageView({
      record: {
        nameOriginal: "Sem Dados",
        firstAirYear: null,
        lastAirYear: null,
        numberOfSeasons: null,
        numberOfEpisodes: null,
        posterPath: null,
        backdropPath: null,
      },
      translation: null,
      blocks: [],
      seasons: [],
    });

    expect(view.title).toBe("Sem Dados");
    expect(view.periodLabel).toBeNull();
    expect(view.seasonsCountLabel).toBeNull();
    expect(view.episodesCountLabel).toBeNull();
    expect(view.metaDescription).toBeNull();
    expect(view.blocks).toEqual([]);
    expect(view.renderableBlockCount).toBe(0);
    expect(view.media.hasRealImage).toBe(false);
    expect(view.seasons).toEqual([]);
  });

  it("trata campos vazios como ausentes", () => {
    const view = buildSeriesPageView({
      record: {
        ...baseRecord,
        firstAirYear: 0,
        lastAirYear: null,
        numberOfSeasons: 0,
        numberOfEpisodes: -1,
      },
      translation: translation({
        title: "   ",
        metaTitle: "",
        metaDescription: " ",
        summary: "",
      }),
      blocks: [],
      seasons: [
        {
          seasonNumber: 1,
          name: " ",
          overview: "",
          airYear: 0,
          episodeCount: 0,
          posterPath: "/season.jpg",
          episodes: [],
        },
      ],
    });

    expect(view.title).toBe("Original Series");
    expect(view.periodLabel).toBeNull();
    expect(view.seasonsCountLabel).toBeNull();
    expect(view.episodesCountLabel).toBeNull();
    expect(view.metaTitle).toBeNull();
    expect(view.metaDescription).toBeNull();
    expect(view.seasons[0]?.title).toBe("Temporada 1");
    expect(view.seasons[0]?.overview).toBeNull();
    expect(view.seasons[0]?.episodeCountLabel).toBeNull();
    // Season poster com file_path cru do TMDB -> URL remota (w500).
    expect(view.seasons[0]?.poster?.src).toBe("https://image.tmdb.org/t/p/w500/season.jpg");
  });

  it("monta view com campos reais, blocos publicos e episodios existentes", () => {
    const view = buildSeriesPageView({
      record: {
        ...baseRecord,
        posterPath: "/media/series/show.webp",
        backdropPath: "/uploads/series/show-backdrop.jpg",
      },
      translation: translation({
        title: "Serie PT",
        metaDescription: "Descricao editorial existente.",
      }),
      blocks: [
        { blockType: "editorial_intro", content: "Intro", reviewStatus: "published" },
        { blockType: "season_guide", content: "Guia", reviewStatus: "human_reviewed" },
        { blockType: "faq", content: "Rascunho", reviewStatus: "needs_review" },
      ],
      seasons: [
        {
          seasonNumber: 1,
          name: "Temporada Um",
          overview: "Visao geral real.",
          airYear: 2011,
          episodeCount: 2,
          posterPath: "/media/series/season-1.webp",
          episodes: [
            {
              episodeNumber: 2,
              name: "Segundo",
              overview: null,
              airYear: 2011,
              runtimeMinutes: 56,
              stillPath: "/still.jpg",
            },
            {
              episodeNumber: 1,
              name: "Piloto",
              overview: "Resumo real.",
              airYear: 2011,
              runtimeMinutes: 58,
              stillPath: "/uploads/series/e1.webp",
            },
          ],
        },
      ],
    });

    expect(view.title).toBe("Serie PT");
    expect(view.periodLabel).toBe("2011-2019");
    expect(view.seasonsCountLabel).toBe("8 temporadas");
    expect(view.episodesCountLabel).toBe("73 episodios");
    expect(view.renderableBlockCount).toBe(2);
    expect(view.metaDescription).toBe("Descricao editorial existente.");
    expect(view.media.poster?.src).toBe("/media/series/show.webp");
    expect(view.seasons[0]?.episodeCountLabel).toBe("2 episodios");
    expect(view.seasons[0]?.poster?.src).toBe("/media/series/season-1.webp");
    expect(view.seasons[0]?.episodes.map((episode) => episode.episodeNumber)).toEqual([
      1,
      2,
    ]);
    expect(view.seasons[0]?.episodes[0]?.still?.src).toBe("/uploads/series/e1.webp");
    // Episode still com file_path cru do TMDB -> URL remota (original).
    expect(view.seasons[0]?.episodes[1]?.still?.src).toBe(
      "https://image.tmdb.org/t/p/original/still.jpg",
    );
  });

  it("mapeia situacao/idioma reais para a ficha tecnica (pt-BR, feminino)", () => {
    const view = buildSeriesPageView({
      record: { ...baseRecord, status: "Returning Series", originalLanguage: "en" },
      translation: null,
      blocks: [],
      seasons: [],
    });
    expect(view.statusLabel).toBe("Em exibição");
    expect(view.originalLanguageLabel).toBe("Inglês");
    // A contagem crua (numero) tambem vira ficha na rota; o label longo continua.
    expect(view.seasonsCount).toBe(8);
    expect(view.episodesCount).toBe(73);
  });

  it("omite situacao/idioma quando ausentes ou desconhecidos (nunca cru)", () => {
    const view = buildSeriesPageView({
      record: { ...baseRecord, status: "Whatever", originalLanguage: "zz" },
      translation: null,
      blocks: [],
      seasons: [],
    });
    expect(view.statusLabel).toBeNull();
    expect(view.originalLanguageLabel).toBeNull();
  });
});
