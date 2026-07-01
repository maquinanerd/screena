/**
 * Testes puros dos presenters de listagem (portas de entrada de filme/serie/pessoa).
 *
 * Garantem que a listagem nao inventa itens (sem slug/titulo -> fora), so aceita
 * imagem local segura, ordena de forma deterministica, respeita o cap e aplica o
 * gate anti-thin (vazia/fina -> noindex; itens suficientes -> index).
 */

import { describe, expect, it } from "vitest";

import {
  buildMovieCard,
  buildMovieIndexView,
  buildPersonCard,
  buildPersonIndexView,
  buildSeriesCard,
  buildSeriesIndexView,
  evaluateEntityIndexIndexability,
  formatSeriesIndexPeriod,
  INDEX_ITEM_LIMIT,
  mapKnownForDepartment,
  MIN_INDEX_ITEMS,
  normalizeEntityLocalImagePath,
  type MovieListItemInput,
  type PersonListItemInput,
  type SeriesListItemInput,
} from "../../apps/web/src/lib/entity-index-presenter";

function movie(overrides: Partial<MovieListItemInput> = {}): MovieListItemInput {
  return {
    titleOriginal: "Original Movie",
    translationTitle: null,
    slug: "original-movie",
    year: 2020,
    posterPath: null,
    ...overrides,
  };
}

function series(overrides: Partial<SeriesListItemInput> = {}): SeriesListItemInput {
  return {
    nameOriginal: "Original Series",
    translationTitle: null,
    slug: "original-series",
    firstAirYear: 2011,
    lastAirYear: 2019,
    posterPath: null,
    ...overrides,
  };
}

function person(overrides: Partial<PersonListItemInput> = {}): PersonListItemInput {
  return {
    name: "Original Person",
    translationTitle: null,
    slug: "original-person",
    knownForDepartment: null,
    profilePath: null,
    ...overrides,
  };
}

describe("normalizeEntityLocalImagePath", () => {
  it("aceita apenas paths locais seguros", () => {
    expect(normalizeEntityLocalImagePath(" /media/movies/p.webp ")).toBe(
      "/media/movies/p.webp",
    );
    expect(normalizeEntityLocalImagePath("/uploads/people/y.jpg")).toBe(
      "/uploads/people/y.jpg",
    );
    expect(normalizeEntityLocalImagePath("/brand/z.png")).toBe("/brand/z.png");
  });

  it("recusa nulo, externo, image.tmdb.org, path cru e traversal", () => {
    expect(normalizeEntityLocalImagePath(null)).toBeNull();
    expect(normalizeEntityLocalImagePath("")).toBeNull();
    expect(
      normalizeEntityLocalImagePath("https://image.tmdb.org/t/p/w342/a.jpg"),
    ).toBeNull();
    expect(normalizeEntityLocalImagePath("https://example.com/p.jpg")).toBeNull();
    expect(normalizeEntityLocalImagePath("//example.com/p.jpg")).toBeNull();
    expect(normalizeEntityLocalImagePath("/abc.jpg")).toBeNull();
    expect(normalizeEntityLocalImagePath("/media/p.jpg?x=1")).toBeNull();
    expect(normalizeEntityLocalImagePath("/media/../secret.jpg")).toBeNull();
  });
});

describe("formatSeriesIndexPeriod", () => {
  it("formata ano unico ou periodo, ignorando anos invalidos", () => {
    expect(formatSeriesIndexPeriod(2011, 2019)).toBe("2011-2019");
    expect(formatSeriesIndexPeriod(2011, 2011)).toBe("2011");
    expect(formatSeriesIndexPeriod(2011, null)).toBe("2011");
    expect(formatSeriesIndexPeriod(null, null)).toBeNull();
    expect(formatSeriesIndexPeriod(0, -1)).toBeNull();
  });
});

describe("mapKnownForDepartment", () => {
  it("traduz conhecidos, ignora desconhecidos/ausentes", () => {
    expect(mapKnownForDepartment("Acting")).toBe("Atuacao");
    expect(mapKnownForDepartment("Directing")).toBe("Direcao");
    expect(mapKnownForDepartment("Nope")).toBeNull();
    expect(mapKnownForDepartment(null)).toBeNull();
  });
});

describe("cards individuais", () => {
  it("filme: descarta sem slug ou sem titulo; monta href/meta/imagem", () => {
    expect(buildMovieCard(movie({ slug: null }))).toBeNull();
    expect(buildMovieCard(movie({ titleOriginal: "  ", translationTitle: null }))).toBeNull();
    const card = buildMovieCard(
      movie({
        translationTitle: "Filme PT",
        slug: "filme-pt",
        year: 2020,
        posterPath: "/media/movies/p.webp",
      }),
    );
    expect(card).toEqual({
      kind: "movie",
      title: "Filme PT",
      href: "/pt/filmes/filme-pt/",
      meta: "2020",
      image: { src: "/media/movies/p.webp", width: 342, height: 513 },
    });
  });

  it("filme: imagem externa/tmdb vira null mas o card ainda existe", () => {
    const card = buildMovieCard(
      movie({ posterPath: "https://image.tmdb.org/t/p/w342/a.jpg" }),
    );
    expect(card).not.toBeNull();
    expect(card?.image).toBeNull();
  });

  it("serie: meta e o periodo e href aponta /pt/series/", () => {
    const card = buildSeriesCard(series({ slug: "serie-x", firstAirYear: 2011, lastAirYear: 2019 }));
    expect(card?.href).toBe("/pt/series/serie-x/");
    expect(card?.meta).toBe("2011-2019");
  });

  it("pessoa: meta e a funcao traduzida; sem funcao conhecida meta e null", () => {
    expect(buildPersonCard(person({ slug: "p", knownForDepartment: "Acting" }))?.meta).toBe(
      "Atuacao",
    );
    expect(buildPersonCard(person({ slug: "p", knownForDepartment: "Xyz" }))?.meta).toBeNull();
    expect(buildPersonCard(person({ slug: "p" }))?.href).toBe("/pt/pessoas/p/");
  });
});

describe("buildMovieIndexView", () => {
  it("descarta invalidos e ordena por ano desc, depois titleOriginal asc", () => {
    const view = buildMovieIndexView([
      movie({ titleOriginal: "Beta", slug: "beta", year: 2010 }),
      movie({ titleOriginal: "Alpha", slug: null, year: 2022 }), // sem slug -> fora
      movie({ titleOriginal: "Gamma", slug: "gamma", year: 2020 }),
      movie({ titleOriginal: "Delta", slug: "delta", year: 2020 }),
    ]);
    expect(view.totalCount).toBe(3);
    expect(view.cards.map((c) => c.title)).toEqual(["Delta", "Gamma", "Beta"]);
    expect(view.hasMore).toBe(false);
  });

  it("respeita o cap de exibicao e marca hasMore", () => {
    const items = Array.from({ length: INDEX_ITEM_LIMIT + 6 }, (_unused, i) =>
      movie({ titleOriginal: `M${i}`, slug: `m-${i}`, year: 2000 + i }),
    );
    const view = buildMovieIndexView(items);
    expect(view.totalCount).toBe(INDEX_ITEM_LIMIT + 6);
    expect(view.cards).toHaveLength(INDEX_ITEM_LIMIT);
    expect(view.hasMore).toBe(true);
    // ano desc: o mais novo primeiro.
    expect(view.cards[0]?.title).toBe(`M${INDEX_ITEM_LIMIT + 5}`);
  });
});

describe("buildSeriesIndexView", () => {
  it("ordena por firstAirYear desc, depois nameOriginal asc", () => {
    const view = buildSeriesIndexView([
      series({ nameOriginal: "Bravo", slug: "bravo", firstAirYear: 2015, lastAirYear: null }),
      series({ nameOriginal: "Charlie", slug: "charlie", firstAirYear: 2021, lastAirYear: null }),
      series({ nameOriginal: "Alfa", slug: "alfa", firstAirYear: 2021, lastAirYear: null }),
    ]);
    expect(view.cards.map((c) => c.title)).toEqual(["Alfa", "Charlie", "Bravo"]);
  });
});

describe("buildPersonIndexView", () => {
  it("ordena por nome asc e descarta sem slug", () => {
    const view = buildPersonIndexView([
      person({ name: "Zora", slug: "zora" }),
      person({ name: "Bea", slug: null }), // sem slug -> fora
      person({ name: "Ana", slug: "ana" }),
    ]);
    expect(view.totalCount).toBe(2);
    expect(view.cards.map((c) => c.title)).toEqual(["Ana", "Zora"]);
  });
});

describe("evaluateEntityIndexIndexability", () => {
  it("noindex para listagem vazia ou fina", () => {
    expect(evaluateEntityIndexIndexability({ itemCount: 0 }).decision).toBe("noindex");
    expect(evaluateEntityIndexIndexability({ itemCount: MIN_INDEX_ITEMS - 1 }).decision).toBe(
      "noindex",
    );
  });

  it("index a partir de itens suficientes", () => {
    expect(evaluateEntityIndexIndexability({ itemCount: MIN_INDEX_ITEMS }).decision).toBe(
      "index",
    );
    expect(evaluateEntityIndexIndexability({ itemCount: 50 }).decision).toBe("index");
  });
});
