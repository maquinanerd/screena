/**
 * Testes puros do presenter do hero-carousel da home.
 *
 * Garantem que os slides nao inventam dados, que a NOTA editorial propria do
 * Screen so aparece quando liberada e valida (nunca fake/AggregateRating), que a
 * info principal e montada por itens validos (filme=ano; serie=temporadas/
 * episodios) e que a fronteira de serializacao produz objeto plano.
 */

import { describe, expect, it } from "vitest";

import {
  buildHeroCast,
  buildHeroSlide,
  buildHeroSlides,
  buildPrimaryMeta,
  formatCountLabel,
  resolveHeroImage,
  resolveHeroRating,
  trimSynopsis,
  SCREEN_SCORE_EDITORIAL_SOURCE,
  SCREEN_SCORE_SCALE,
  type HeroSlideInput,
} from "../../apps/web/src/lib/home-hero-presenter";

const movieInput: HeroSlideInput = {
  kind: "movie",
  title: "A Última Fronteira",
  slug: "demo-a-ultima-fronteira",
  year: 2023,
  seasonsCount: null,
  episodesCount: null,
  certification: "14",
  screenScore: 4.5,
  screenScoreScale: 5,
  screenScoreDisplay: true,
  screenScoreSource: SCREEN_SCORE_EDITORIAL_SOURCE,
  director: "Rui Andrade",
  cast: ["Rui Andrade", "Helena Vasconcelos"],
  summary: "Aventura de sobrevivência sobre coragem e limites.",
  backdropPath: "/backdrop-movie.jpg",
  posterPath: "/poster-movie.jpg",
};

const seriesInput: HeroSlideInput = {
  kind: "series",
  title: "Correntes Profundas",
  slug: "demo-correntes-profundas",
  year: 2020,
  seasonsCount: 3,
  episodesCount: 24,
  certification: "16",
  screenScore: 4.5,
  screenScoreScale: 5,
  screenScoreDisplay: true,
  screenScoreSource: SCREEN_SCORE_EDITORIAL_SOURCE,
  director: null,
  cast: ["Helena Vasconcelos", "Marina Duarte"],
  summary: "Drama coral em três temporadas sobre comunidade, culpa e mares.",
  backdropPath: "/backdrop-series.jpg",
  posterPath: "/poster-series.jpg",
};

describe("buildHeroSlide — filme", () => {
  it("monta href, eyebrow e info principal com o ano", () => {
    const slide = buildHeroSlide(movieInput);
    expect(slide).not.toBeNull();
    expect(slide?.vertical).toBe("movie");
    expect(slide?.eyebrow).toBe("Filme em destaque");
    expect(slide?.href).toBe("/pt/filmes/demo-a-ultima-fronteira/");
    expect(slide?.primaryMeta).toEqual(["2023"]);
    expect(slide?.certification).toBe("14");
    expect(slide?.director).toBe("Rui Andrade");
    expect(slide?.rating).toEqual({ value: 4.5, scale: 5 });
    // Arte principal = backdrop remoto w1280 (nunca path local/CDN embutido).
    expect(slide?.imageUrl).toBe(
      "https://image.tmdb.org/t/p/w1280/backdrop-movie.jpg",
    );
  });

  it("produz objeto PLANO/serializavel (sem Decimal/BigInt)", () => {
    const slide = buildHeroSlide(movieInput);
    // Round-trip JSON nao pode lancar nem perder dados.
    expect(() => JSON.stringify(slide)).not.toThrow();
    const roundTripped = JSON.parse(JSON.stringify(slide));
    expect(roundTripped.rating.value).toBe(4.5);
  });
});

describe("buildHeroSlide — serie", () => {
  it("info principal = temporadas + episodios", () => {
    const slide = buildHeroSlide(seriesInput);
    expect(slide?.vertical).toBe("series");
    expect(slide?.eyebrow).toBe("Série em destaque");
    expect(slide?.href).toBe("/pt/series/demo-correntes-profundas/");
    expect(slide?.primaryMeta).toEqual(["3 temporadas", "24 episódios"]);
  });
});

describe("buildHeroSlide — descarte de invalidos", () => {
  it("sem titulo -> null", () => {
    expect(buildHeroSlide({ ...movieInput, title: "   " })).toBeNull();
  });
  it("sem slug -> null", () => {
    expect(buildHeroSlide({ ...movieInput, slug: null })).toBeNull();
  });
  it("slug com caractere invalido -> null (nunca link quebrado)", () => {
    expect(buildHeroSlide({ ...movieInput, slug: "com/barra" })).toBeNull();
  });
});

describe("resolveHeroRating — nota editorial propria (gate seguro)", () => {
  it("exibe quando origem editorial, display=true, escala 5 e valor valido", () => {
    expect(resolveHeroRating(movieInput)).toEqual({ value: 4.5, scale: 5 });
    expect(SCREEN_SCORE_SCALE).toBe(5);
  });
  it("oculta quando falta origem editorial, mesmo com display=true (seed/demo)", () => {
    expect(resolveHeroRating({ ...movieInput, screenScoreSource: null })).toBeNull();
    expect(resolveHeroRating({ ...movieInput, screenScoreSource: undefined })).toBeNull();
  });
  it("oculta quando display=false", () => {
    expect(resolveHeroRating({ ...movieInput, screenScoreDisplay: false })).toBeNull();
  });
  it("oculta quando escala != 5 (fallback seguro)", () => {
    expect(resolveHeroRating({ ...movieInput, screenScoreScale: 10 })).toBeNull();
    expect(resolveHeroRating({ ...movieInput, screenScoreScale: null })).toBeNull();
  });
  it("oculta quando valor <= 0 ou > escala", () => {
    expect(resolveHeroRating({ ...movieInput, screenScore: 0 })).toBeNull();
    expect(resolveHeroRating({ ...movieInput, screenScore: -1 })).toBeNull();
    expect(resolveHeroRating({ ...movieInput, screenScore: 6 })).toBeNull();
  });
  it("oculta quando valor nulo/NaN", () => {
    expect(resolveHeroRating({ ...movieInput, screenScore: null })).toBeNull();
    expect(resolveHeroRating({ ...movieInput, screenScore: Number.NaN })).toBeNull();
  });
});

describe("resolveHeroImage — arte remota do TMDB (backdrop > poster > null)", () => {
  it("prefere o backdrop em w1280", () => {
    expect(resolveHeroImage("/bd.jpg", "/ps.jpg")).toBe(
      "https://image.tmdb.org/t/p/w1280/bd.jpg",
    );
  });
  it("cai no poster em w780 quando nao ha backdrop", () => {
    expect(resolveHeroImage(null, "/ps.jpg")).toBe(
      "https://image.tmdb.org/t/p/w780/ps.jpg",
    );
  });
  it("sem file_path valido -> null (slide cai no wash de fallback)", () => {
    expect(resolveHeroImage(null, null)).toBeNull();
    // path local antigo (/media/...) e rejeitado pelo helper governado.
    expect(resolveHeroImage("/media/tmdb/x.jpg", null)).toBeNull();
  });
  it("build de slide sem imagem -> imageUrl null", () => {
    const slide = buildHeroSlide({
      ...movieInput,
      backdropPath: null,
      posterPath: null,
    });
    expect(slide?.imageUrl).toBeNull();
  });
});

describe("buildPrimaryMeta — itens validos (sem separador sobrando)", () => {
  it("filme sem ano -> vazio", () => {
    expect(buildPrimaryMeta({ ...movieInput, year: null })).toEqual([]);
    expect(buildPrimaryMeta({ ...movieInput, year: 0 })).toEqual([]);
  });
  it("serie com 1 temporada usa singular", () => {
    expect(
      buildPrimaryMeta({ ...seriesInput, seasonsCount: 1, episodesCount: 8 }),
    ).toEqual(["1 temporada", "8 episódios"]);
  });
  it("serie sem contagens -> vazio", () => {
    expect(
      buildPrimaryMeta({ ...seriesInput, seasonsCount: null, episodesCount: null }),
    ).toEqual([]);
  });
  it("serie so com temporadas omite episodios", () => {
    expect(
      buildPrimaryMeta({ ...seriesInput, seasonsCount: 2, episodesCount: null }),
    ).toEqual(["2 temporadas"]);
  });
});

describe("formatCountLabel", () => {
  it("singular/plural e null para invalido", () => {
    expect(formatCountLabel(1, "temporada", "temporadas")).toBe("1 temporada");
    expect(formatCountLabel(3, "temporada", "temporadas")).toBe("3 temporadas");
    expect(formatCountLabel(0, "temporada", "temporadas")).toBeNull();
    expect(formatCountLabel(null, "temporada", "temporadas")).toBeNull();
    expect(formatCountLabel(2.5, "temporada", "temporadas")).toBeNull();
  });
});

describe("trimSynopsis", () => {
  it("mantem texto curto", () => {
    expect(trimSynopsis("Curto.")).toBe("Curto.");
  });
  it("apara texto longo em limite de palavra com reticencias", () => {
    const long = "palavra ".repeat(40).trim();
    const out = trimSynopsis(long, 40);
    expect(out).not.toBeNull();
    expect(out?.length).toBeLessThanOrEqual(41);
    expect(out?.endsWith("…")).toBe(true);
  });
  it("vazio/whitespace -> null", () => {
    expect(trimSynopsis("   ")).toBeNull();
    expect(trimSynopsis(null)).toBeNull();
  });
});

describe("buildHeroCast", () => {
  it("apara, deduplica e aplica o teto", () => {
    expect(buildHeroCast(["A", "A", " B ", "", "C", "D"], 3)).toEqual(["A", "B", "C"]);
  });
});

describe("buildHeroSlides", () => {
  it("descarta entradas invalidas e mantem a ordem", () => {
    const slides = buildHeroSlides([
      movieInput,
      { ...movieInput, title: null },
      seriesInput,
    ]);
    expect(slides).toHaveLength(2);
    expect(slides[0]?.title).toBe("A Última Fronteira");
    expect(slides[1]?.title).toBe("Correntes Profundas");
  });
});
