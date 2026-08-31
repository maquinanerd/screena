/**
 * Testes puros dos presenters de listagem (portas de entrada de filme/serie/pessoa).
 *
 * Garantem que a listagem nao inventa itens (sem slug/titulo -> fora), so aceita
 * imagem local segura, ordena de forma deterministica, respeita o cap e aplica o
 * gate anti-thin (vazia/fina -> noindex; itens suficientes -> index).
 */

import { describe, expect, it } from "vitest";

import { mapKnownForDepartment as mapKnownForDepartmentCanonico } from "../../apps/web/src/lib/known-for-department";
import { mapKnownForDepartment as mapKnownForDepartmentDoDetalhe } from "../../apps/web/src/lib/person-presenter";
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
  resolveCardScreenScore,
  type MovieListItemInput,
  type PersonListItemInput,
  type SeriesListItemInput,
} from "../../apps/web/src/lib/entity-index-presenter";
import { SCREEN_SCORE_EDITORIAL_SOURCE } from "../../apps/web/src/lib/home-hero-presenter";

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
  /**
   * Ate 20/08/2026 este bloco AFIRMAVA o defeito: esperava "Atuacao"/"Direcao"
   * sem acento, porque `entity-index-presenter` carregava uma segunda copia da
   * tabela que a PR #186 nao acentuou. O teste passava e a producao mostrava
   * grafias diferentes para a mesma pessoa no indice e no detalhe.
   */
  it("traduz ACENTUADO — a mesma grafia do detalhe de pessoa", () => {
    expect(mapKnownForDepartment("Acting")).toBe("Atuação");
    expect(mapKnownForDepartment("Directing")).toBe("Direção");
    expect(mapKnownForDepartment("Nope")).toBeNull();
    expect(mapKnownForDepartment(null)).toBeNull();
  });

  it("indice e detalhe devolvem o MESMO simbolo, nao dois iguais", () => {
    // Comparar os RESULTADOS deixaria passar duas tabelas que por acaso
    // concordam hoje. Comparar a referencia da funcao e o que prova origem
    // unica — e o que reprova quando alguem recriar a copia local.
    expect(mapKnownForDepartment).toBe(mapKnownForDepartmentDoDetalhe);
    expect(mapKnownForDepartment).toBe(mapKnownForDepartmentCanonico);
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
      entityId: null,
      title: "Filme PT",
      href: "/pt/filmes/filme-pt/",
      meta: "2020",
      image: { src: "/media/movies/p.webp", width: 342, height: 513 },
      screenScore: null,
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
      "Atuação",
    );
    expect(buildPersonCard(person({ slug: "p", knownForDepartment: "Xyz" }))?.meta).toBeNull();
    expect(buildPersonCard(person({ slug: "p" }))?.href).toBe("/pt/pessoas/p/");
  });
});

/**
 * ATUALIZADO em 2026-08-28: escala 100, formato INTEIRO.
 *
 * A fixture daqui era 4,5/5 e afirmava um formato de "uma casa decimal". Nenhum
 * dos dois descrevia o produto: o worker do Cinerie Score grava em escala 100, e
 * um calculo em 100 nunca passava num gate que exigia 5 — a nota nao aparecia em
 * card nenhum. `toFixed(1)` em escala 100 tambem escreveria "82.0", um decimal
 * que a fonte nao tem e que a ficha nao mostra.
 */
describe("resolveCardScreenScore", () => {
  const governed = {
    screenScore: 82,
    screenScoreScale: 100,
    screenScoreDisplay: true,
    screenScoreSource: SCREEN_SCORE_EDITORIAL_SOURCE,
  };

  it("formata a nota governada como INTEIRO na escala 100", () => {
    expect(resolveCardScreenScore(governed)).toBe("82");
    expect(resolveCardScreenScore({ ...governed, screenScore: 4 })).toBe("4");
    expect(resolveCardScreenScore({ ...governed, screenScore: 100 })).toBe("100");
    // Fracao vinda do calculo e arredondada, nunca truncada nem exibida.
    expect(resolveCardScreenScore({ ...governed, screenScore: 82.4 })).toBe("82");
    expect(resolveCardScreenScore({ ...governed, screenScore: 82.6 })).toBe("83");
  });

  it("null quando o display/origem nao estao liberados ou o gate esta ausente", () => {
    expect(resolveCardScreenScore({ ...governed, screenScoreSource: null })).toBeNull();
    expect(resolveCardScreenScore({ ...governed, screenScoreSource: undefined })).toBeNull();
    expect(resolveCardScreenScore({ ...governed, screenScoreDisplay: false })).toBeNull();
    expect(resolveCardScreenScore({})).toBeNull();
    expect(resolveCardScreenScore({ screenScore: 82, screenScoreScale: 100 })).toBeNull();
  });

  it("null para escala != 100, valor fora de faixa ou nao finito (mesmo gate do hero)", () => {
    // 5 entra de proposito: e a escala ANTIGA, e uma nota gravada nela nao pode
    // voltar a ser aceita por engano.
    expect(resolveCardScreenScore({ ...governed, screenScoreScale: 5 })).toBeNull();
    expect(resolveCardScreenScore({ ...governed, screenScoreScale: 10 })).toBeNull();
    expect(resolveCardScreenScore({ ...governed, screenScoreScale: null })).toBeNull();
    expect(resolveCardScreenScore({ ...governed, screenScore: 0 })).toBeNull();
    expect(resolveCardScreenScore({ ...governed, screenScore: -1 })).toBeNull();
    expect(resolveCardScreenScore({ ...governed, screenScore: 101 })).toBeNull();
    expect(resolveCardScreenScore({ ...governed, screenScore: null })).toBeNull();
    expect(resolveCardScreenScore({ ...governed, screenScore: Number.NaN })).toBeNull();
  });

  it("filme/serie expoem a nota governada apenas com origem editorial; pessoa nunca tem nota", () => {
    expect(buildMovieCard(movie(governed))?.screenScore).toBe("82");
    expect(buildSeriesCard(series(governed))?.screenScore).toBe("82");
    expect(buildMovieCard(movie({ ...governed, screenScoreSource: null }))?.screenScore).toBeNull();
    expect(buildMovieCard(movie())?.screenScore).toBeNull();
    expect(buildPersonCard(person({ slug: "p" }))?.screenScore).toBeNull();
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

describe("evaluateEntityIndexIndexability (indexacao total)", () => {
  it("listagem vazia -> noindex; >= 1 item valido -> index", () => {
    expect(evaluateEntityIndexIndexability({ itemCount: 0 }).decision).toBe("noindex");
    expect(evaluateEntityIndexIndexability({ itemCount: 1 }).decision).toBe("index");
    expect(evaluateEntityIndexIndexability({ itemCount: MIN_INDEX_ITEMS - 1 }).decision).toBe(
      "index",
    );
  });

  it("index com itens suficientes (pagina rica)", () => {
    expect(evaluateEntityIndexIndexability({ itemCount: MIN_INDEX_ITEMS }).decision).toBe(
      "index",
    );
    expect(evaluateEntityIndexIndexability({ itemCount: 50 }).decision).toBe("index");
  });
});
