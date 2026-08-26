/**
 * home-hero-scope.test.ts — O hero de `/pt/series` existir NÃO pode depender de
 * quantos filmes há no catálogo.
 *
 * ============ O DEFEITO QUE ESTE ARQUIVO TRAVA ============
 *
 * `getHomeHeroSlides()` montava `[...movies, ...series].slice(0, 5)` e a página
 * de séries filtrava a saída por `slide.vertical === 'series'`. Como filmes
 * entram primeiro, bastavam CINCO filmes com slug canônico pt-BR para nenhuma
 * série sobreviver ao corte — e a página filtrava uma lista onde já não havia
 * série alguma. Em produção há 129 filmes: o hero de `/pt/series` simplesmente
 * não existia, e nada no código dizia por quê.
 *
 * A fixture abaixo reproduz exatamente essa condição: MAIS filmes que o limite
 * de slides, e séries perfeitamente publicáveis atrás deles.
 *
 * ============ POR QUE A FIXTURE GANHOU ARTE, VOTOS E SINOPSE ============
 *
 * Ela nasceu com `backdropPath: null`, `posterPath: null`, sem votos e sem
 * sinopse — e passava, porque naquele momento o hero não tinha portão nenhum.
 * Desde 25/08/2026 tem (`lib/home-hero-eligibility.ts`), e um título assim é
 * exatamente o que ele existe para barrar. Encher a fixture não afrouxa este
 * arquivo: ele mede ESCOPO, e para medir escopo os candidatos precisam ser
 * publicáveis. Quem mede o portão é `home-hero-selection.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { HOME_HERO_SLIDE_LIMIT, loadHeroSlides } from "../home-hero";

/** Mais filmes que o teto de slides — a condição exata do defeito. */
const MOVIE_COUNT = HOME_HERO_SLIDE_LIMIT + 3;
const SERIES_COUNT = 4;

const movieIds = Array.from({ length: MOVIE_COUNT }, (_unused, index) => BigInt(index + 1));
const seriesIds = Array.from({ length: SERIES_COUNT }, (_unused, index) => BigInt(index + 100));

function fakePrisma(): Parameters<typeof loadHeroSlides>[0] {
  const slugRows = (entityType: "movie" | "tv") =>
    (entityType === "movie" ? movieIds : seriesIds).map((id) => ({
      entityId: id,
      slug: `${entityType}-${id}`,
    }));

  return {
    slug: {
      findMany: ({ where }: { where: { entityType: "movie" | "tv" } }) =>
        Promise.resolve(slugRows(where.entityType)),
    },
    movie: {
      findMany: () =>
        Promise.resolve(
          movieIds.map((id) => ({
            id,
            titleOriginal: `Filme ${id}`,
            releaseDate: new Date(Date.UTC(2020, 0, 1)),
            voteCountTmdb: 5_000,
            status: "Released",
            certification: null,
            screenScore: null,
            screenScoreScale: null,
            screenScoreDisplay: false,
            backdropPath: `/backdrop-${id}.jpg`,
            posterPath: `/poster-${id}.jpg`,
          })),
        ),
    },
    tvShow: {
      findMany: () =>
        Promise.resolve(
          seriesIds.map((id) => ({
            id,
            nameOriginal: `Série ${id}`,
            firstAirDate: new Date(Date.UTC(2019, 0, 1)),
            voteCountTmdb: 5_000,
            status: "Returning Series",
            numberOfSeasons: 2,
            numberOfEpisodes: 19,
            certification: "TV-MA",
            screenScore: null,
            screenScoreScale: null,
            screenScoreDisplay: false,
            backdropPath: `/backdrop-${id}.jpg`,
            posterPath: `/poster-${id}.jpg`,
          })),
        ),
    },
    // O portão exige sinopse pt-BR; sem tradução nenhum candidato passaria e
    // este arquivo mediria a ausência de tradução em vez do escopo.
    entityTranslation: {
      findMany: ({ where }: { where: { entityId: { in: bigint[] } } }) =>
        Promise.resolve(
          where.entityId.in.map((id) => ({
            entityId: id,
            title: null,
            summary: `Sinopse pt-BR do título ${id}.`,
          })),
        ),
    },
    crewMember: { findFirst: () => Promise.resolve(null) },
    castMember: { findMany: () => Promise.resolve([]) },
    cinerieScoreCalculation: { findMany: () => Promise.resolve([]) },
    // Sem trending capturado e sem curadoria: a ordem cai para vote_count desc,
    // que é o caminho (b) da decisão. Aqui todos têm o mesmo volume, então a
    // ordem estável por título mantém a composição canônica.
    discoverySnapshot: { findFirst: () => Promise.resolve(null) },
    heroCurationDecision: { findMany: () => Promise.resolve([]) },
  } as unknown as Parameters<typeof loadHeroSlides>[0];
}

describe("escopo do hero", () => {
  it("(1) /pt/series recebe hero de SÉRIE mesmo com o catálogo cheio de filmes", async () => {
    const slides = await loadHeroSlides(fakePrisma(), "series");

    expect(slides.length).toBeGreaterThan(0);
    expect(slides.every((slide) => slide.vertical === "series")).toBe(true);
  });

  it("(2) /pt/filmes recebe hero de FILME e nenhuma série", async () => {
    const slides = await loadHeroSlides(fakePrisma(), "movies");

    expect(slides.length).toBeGreaterThan(0);
    expect(slides.every((slide) => slide.vertical === "movie")).toBe(true);
  });

  /**
   * CONTROLE POSITIVO da composição canônica: a home continua sendo a UNIÃO, com
   * filmes primeiro. Sem esta asserção, "escopar tudo" passaria nos dois testes
   * acima e quebraria a home em silêncio.
   */
  it("(3) a home continua a união, com a composição canônica (filmes primeiro)", async () => {
    const slides = await loadHeroSlides(fakePrisma(), "home");

    expect(slides).toHaveLength(HOME_HERO_SLIDE_LIMIT);
    expect(slides[0]?.vertical).toBe("movie");
  });

  it("(4) o corte por escopo respeita o teto de slides", async () => {
    const movies = await loadHeroSlides(fakePrisma(), "movies");
    expect(movies.length).toBeLessThanOrEqual(HOME_HERO_SLIDE_LIMIT);
  });

  /**
   * O metadado do slide muda por vertical: filme mostra ano; série, temporadas e
   * episódios. O presenter já resolvia isso — o que faltava era a série CHEGAR
   * até ele.
   */
  it("(5) o slide de série carrega temporadas/episódios, não o metadado de filme", async () => {
    const [series] = await loadHeroSlides(fakePrisma(), "series");
    const [movie] = await loadHeroSlides(fakePrisma(), "movies");

    expect(series?.primaryMeta.join(" · ")).toBe("2 temporadas · 19 episódios");
    // O de filme é o ano — os dois metadados não se confundem.
    expect(movie?.primaryMeta).toEqual(["2020"]);
    expect(series?.certification).toBe("TV-MA");
  });
});
