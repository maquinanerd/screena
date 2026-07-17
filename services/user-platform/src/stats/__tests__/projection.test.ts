/**
 * Testes da projecao de estatisticas do usuario (stats-v1).
 *
 * Cobrem: soma de minutos ignorando null; streak atual quebrando quando o
 * ultimo dia e anterior a ontem; longest com buracos; distribution com as
 * 10 chaves; agrupamento por decada; desempate alfabetico estavel no top
 * de generos; determinismo (computedAt = now injetado).
 */

import { describe, expect, it } from "vitest";
import {
  computeUserStats,
  RATING_DISTRIBUTION_KEYS,
  STATS_ALGORITHM_VERSION,
  type StatsInput,
} from "../projection.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");

function baseInput(overrides: Partial<StatsInput> = {}): StatsInput {
  return {
    now: NOW,
    movieRuntimes: [],
    watchedMovieCount: 0,
    watchedEpisodes: [],
    activityDays: [],
    genreCounts: [],
    releaseYears: [],
    ratings: [],
    listCounts: { total: 0, custom: 0 },
    ...overrides,
  };
}

describe("computeUserStats", () => {
  it("(1) soma minutos de filmes e episodios ignorando runtimes null", () => {
    const result = computeUserStats(
      baseInput({
        movieRuntimes: [120, null, 90],
        watchedEpisodes: [
          { runtimeMinutes: 45 },
          { runtimeMinutes: null },
          { runtimeMinutes: 50 },
        ],
      }),
    );

    expect(result.minutesWatched).toBe(305);
    expect(result.episodesWatched).toBe(3);
  });

  it("(2) carrega version, computedAt do now injetado e contadores basicos", () => {
    const result = computeUserStats(
      baseInput({ watchedMovieCount: 7, listCounts: { total: 4, custom: 2 } }),
    );

    expect(result.version).toBe(STATS_ALGORITHM_VERSION);
    expect(result.computedAt).toBe("2026-07-17T12:00:00.000Z");
    expect(result.moviesWatched).toBe(7);
    expect(result.lists).toEqual({ total: 4, custom: 2 });
  });

  it("(3) streak atual conta run que termina hoje", () => {
    const result = computeUserStats(
      baseInput({ activityDays: ["2026-07-15", "2026-07-16", "2026-07-17"] }),
    );

    expect(result.streak).toEqual({ currentDays: 3, longestDays: 3 });
  });

  it("(4) streak atual conta run que termina ontem", () => {
    const result = computeUserStats(baseInput({ activityDays: ["2026-07-15", "2026-07-16"] }));

    expect(result.streak).toEqual({ currentDays: 2, longestDays: 2 });
  });

  it("(5) streak atual quebra quando o ultimo dia e anterior a ontem", () => {
    const result = computeUserStats(baseInput({ activityDays: ["2026-07-13", "2026-07-14"] }));

    expect(result.streak.currentDays).toBe(0);
    expect(result.streak.longestDays).toBe(2);
  });

  it("(6) longest correto com buracos no historico", () => {
    const result = computeUserStats(
      baseInput({
        activityDays: [
          "2026-07-01",
          "2026-07-02",
          "2026-07-03",
          "2026-07-05",
          "2026-07-08",
          "2026-07-09",
          "2026-07-10",
          "2026-07-11",
          "2026-07-12",
        ],
      }),
    );

    expect(result.streak.longestDays).toBe(5);
    expect(result.streak.currentDays).toBe(0);
  });

  it("(7) deduplica dias repetidos e ignora dia ISO invalido sem quebrar", () => {
    const result = computeUserStats(
      baseInput({
        activityDays: ["2026-07-17", "2026-07-17", "2026-07-16", "2026-02-30", "nao-e-dia"],
      }),
    );

    expect(result.streak).toEqual({ currentDays: 2, longestDays: 2 });
  });

  it("(8) distribution cobre as 10 chaves e conta cada nota na chave certa", () => {
    const result = computeUserStats(baseInput({ ratings: [5, 5, 4.5, 0.5, 3] }));

    expect(Object.keys(result.ratings.distribution).sort()).toEqual(
      [...RATING_DISTRIBUTION_KEYS].sort(),
    );
    expect(result.ratings.distribution).toEqual({
      "0.5": 1,
      "1": 0,
      "1.5": 0,
      "2": 0,
      "2.5": 0,
      "3": 1,
      "3.5": 0,
      "4": 0,
      "4.5": 1,
      "5": 2,
    });
    expect(result.ratings.count).toBe(5);
    expect(result.ratings.average).toBe(3.6);
  });

  it("(9) average sai com 1 casa decimal", () => {
    const result = computeUserStats(baseInput({ ratings: [3.5, 3.5, 4] }));

    // 11 / 3 = 3.666... => 3.7 com 1 casa
    expect(result.ratings.average).toBe(3.7);
  });

  it("(10) nota fora da grade 0.5..5.0 passo 0.5 e ignorada, nunca arredondada", () => {
    const result = computeUserStats(baseInput({ ratings: [6, -1, 4.25, 0, 3] }));

    expect(result.ratings.count).toBe(1);
    expect(result.ratings.average).toBe(3);
    expect(result.ratings.distribution["3"]).toBe(1);
    expect(result.ratings.distribution["4.5"]).toBe(0);
  });

  it("(11) decadas agrupam por ano e ordenam por contagem desc com desempate cronologico", () => {
    const result = computeUserStats(
      baseInput({ releaseYears: [1994, 1999, 2001, 2010, 2012, 2015, 1990] }),
    );

    expect(result.decades).toEqual([
      { decade: "1990s", count: 3 },
      { decade: "2010s", count: 3 },
      { decade: "2000s", count: 1 },
    ]);
  });

  it("(12) top generos limita a 5 e desempata alfabeticamente de forma estavel", () => {
    const genreCounts = [
      { genreName: "Romance", count: 3 },
      { genreName: "Comedy", count: 7 },
      { genreName: "Drama", count: 10 },
      { genreName: "Thriller", count: 4 },
      { genreName: "Action", count: 7 },
      { genreName: "Horror", count: 5 },
    ];

    const result = computeUserStats(baseInput({ genreCounts }));
    const reversed = computeUserStats(baseInput({ genreCounts: [...genreCounts].reverse() }));

    expect(result.topGenres).toEqual([
      { genreName: "Drama", count: 10 },
      { genreName: "Action", count: 7 },
      { genreName: "Comedy", count: 7 },
      { genreName: "Horror", count: 5 },
      { genreName: "Thriller", count: 4 },
    ]);
    // Determinismo: a ordem de entrada nao muda o ranking.
    expect(reversed.topGenres).toEqual(result.topGenres);
  });

  it("(13) entrada vazia gera projecao neutra e deterministica", () => {
    const result = computeUserStats(baseInput());

    expect(result.minutesWatched).toBe(0);
    expect(result.moviesWatched).toBe(0);
    expect(result.episodesWatched).toBe(0);
    expect(result.topGenres).toEqual([]);
    expect(result.decades).toEqual([]);
    expect(result.streak).toEqual({ currentDays: 0, longestDays: 0 });
    expect(result.ratings.count).toBe(0);
    expect(result.ratings.average).toBe(0);
  });
});
