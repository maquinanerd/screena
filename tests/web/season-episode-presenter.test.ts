/**
 * season-episode-presenter.test.ts — Rotas e presenters PUROS de temporada e
 * episodio (Fase 4). Sem DB/IO.
 */

import { describe, expect, it } from "vitest";

import {
  episodePath,
  parseRouteNumber,
  seasonPath,
  seriesPath,
} from "../../apps/web/src/lib/routes";
import {
  buildEpisodePageView,
  buildSeasonPageView,
  formatAirDate,
  type EpisodePresenterInput,
  type SeasonPresenterInput,
} from "../../apps/web/src/lib/season-episode-presenter";

describe("rotas de temporada/episodio", () => {
  it("seriesPath/seasonPath/episodePath geram caminhos canonicos com barra final", () => {
    expect(seriesPath("breaking-bad")).toBe("/pt/series/breaking-bad/");
    expect(seasonPath("breaking-bad", 1)).toBe("/pt/series/breaking-bad/temporadas/1/");
    expect(episodePath("breaking-bad", 1, 3)).toBe(
      "/pt/series/breaking-bad/temporadas/1/episodios/3/",
    );
  });

  it("rejeitam slug/numero invalidos", () => {
    expect(seasonPath("bad/slug", 1)).toBeNull();
    expect(seasonPath("breaking-bad", 0)).toBeNull();
    expect(episodePath("breaking-bad", 1, -1)).toBeNull();
    expect(seasonPath("..", 1)).toBeNull();
  });

  it("parseRouteNumber aceita so a forma canonica (sem zero a esquerda)", () => {
    expect(parseRouteNumber("1")).toBe(1);
    expect(parseRouteNumber("10")).toBe(10);
    expect(parseRouteNumber("01")).toBeNull();
    expect(parseRouteNumber("003")).toBeNull();
    expect(parseRouteNumber("0")).toBeNull();
    expect(parseRouteNumber("-1")).toBeNull();
    expect(parseRouteNumber("1a")).toBeNull();
    expect(parseRouteNumber("abc")).toBeNull();
  });
});

function seasonInput(overrides: Partial<SeasonPresenterInput> = {}): SeasonPresenterInput {
  return {
    seriesTitle: "Breaking Bad",
    seriesSlug: "breaking-bad",
    seasonNumber: 2,
    name: null,
    overview: "Overview da temporada.",
    airDateIso: "2009-03-08",
    episodeCount: 13,
    seasonPosterPath: null,
    seriesPosterPath: "/media/series/bb-poster.webp",
    seriesBackdropPath: null,
    episodes: [
      { episodeNumber: 2, name: "Grilled", overview: "b".repeat(300), airDateIso: "2009-03-15", runtimeMinutes: 48, stillPath: "/media/still-2.jpg" },
      { episodeNumber: 1, name: "Seven Thirty-Seven", overview: null, airDateIso: "2009-03-08", runtimeMinutes: 47, stillPath: null },
    ],
    prevSeasonNumber: 1,
    nextSeasonNumber: 3,
    ...overrides,
  };
}

describe("buildSeasonPageView", () => {
  it("monta a view com titulo fallback, episodios ordenados e navegacao", () => {
    const view = buildSeasonPageView(seasonInput());
    expect(view.seasonTitle).toBe("Temporada 2");
    expect(view.dateLabel).toBe("8 de março de 2009");
    expect(view.airYear).toBe(2009);
    expect(view.episodeCountLabel).toBe("13 episódios");
    // Ordenados por numero, com href para cada episodio.
    expect(view.episodes.map((e) => e.episodeNumber)).toEqual([1, 2]);
    expect(view.episodes[1]?.href).toBe(
      "/pt/series/breaking-bad/temporadas/2/episodios/2/",
    );
    // Resumo truncado com reticencias; ausente -> null.
    expect(view.episodes[0]?.summary).toBeNull();
    expect(view.episodes[1]?.summary?.endsWith("…")).toBe(true);
    // Poster cai para o poster da serie quando a temporada nao tem.
    expect(view.poster?.src).toBe("/media/series/bb-poster.webp");
    // Navegacao entre temporadas.
    expect(view.prevSeason?.href).toBe("/pt/series/breaking-bad/temporadas/1/");
    expect(view.nextSeason?.href).toBe("/pt/series/breaking-bad/temporadas/3/");
  });

  it("usa o nome da temporada quando existe e omite navegacao ausente", () => {
    const view = buildSeasonPageView(
      seasonInput({ name: "A Química do Mal", prevSeasonNumber: null, nextSeasonNumber: null, episodeCount: 1 }),
    );
    expect(view.seasonTitle).toBe("A Química do Mal");
    expect(view.prevSeason).toBeNull();
    expect(view.nextSeason).toBeNull();
    expect(view.episodeCountLabel).toBe("1 episódio");
  });
});

function episodeInput(overrides: Partial<EpisodePresenterInput> = {}): EpisodePresenterInput {
  return {
    seriesTitle: "Breaking Bad",
    seriesSlug: "breaking-bad",
    seasonNumber: 1,
    seasonName: null,
    episodeNumber: 3,
    name: null,
    overview: "Sinopse do episodio.",
    airDateIso: "2008-02-10",
    runtimeMinutes: 48,
    stillPath: null,
    prevEpisodeNumber: 2,
    nextEpisodeNumber: 4,
    ...overrides,
  };
}

describe("buildEpisodePageView", () => {
  it("monta a view com titulo fallback, link da temporada e navegacao", () => {
    const view = buildEpisodePageView(episodeInput());
    expect(view.episodeTitle).toBe("Episódio 3");
    expect(view.seasonTitle).toBe("Temporada 1");
    expect(view.seasonHref).toBe("/pt/series/breaking-bad/temporadas/1/");
    expect(view.dateLabel).toBe("10 de fevereiro de 2008");
    expect(view.runtimeLabel).toBe("48 min");
    expect(view.prevEpisode?.href).toBe(
      "/pt/series/breaking-bad/temporadas/1/episodios/2/",
    );
    expect(view.nextEpisode?.href).toBe(
      "/pt/series/breaking-bad/temporadas/1/episodios/4/",
    );
  });

  it("primeiro episodio nao tem anterior; ultimo nao tem proximo", () => {
    const first = buildEpisodePageView(episodeInput({ prevEpisodeNumber: null }));
    expect(first.prevEpisode).toBeNull();
    const last = buildEpisodePageView(episodeInput({ nextEpisodeNumber: null, name: "Título Real" }));
    expect(last.nextEpisode).toBeNull();
    expect(last.episodeTitle).toBe("Título Real");
  });
});

describe("formatAirDate", () => {
  it("formata datas validas e rejeita invalidas", () => {
    expect(formatAirDate("2020-12-25")).toBe("25 de dezembro de 2020");
    expect(formatAirDate(null)).toBeNull();
    expect(formatAirDate("data-ruim")).toBeNull();
    expect(formatAirDate("2020-13-40")).toBeNull();
  });
});
