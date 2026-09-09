/**
 * series-page-row-budget.test.ts — QUANTOS EPISODIOS a ficha de SERIE le para
 * desenhar a lista de UMA temporada.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE ARQUIVO TRAVA
 * ============================================================================
 * Ate 2026-09-09, `getSeriesPageData` trazia `season.findMany` com um `select`
 * aninhado de `episodes` SEM `take` — para CADA temporada da serie, com
 * `overview` (o campo mais longo da linha). A tela desenha os episodios de UMA
 * temporada so: a rota escolhe uma e descarta o resto.
 *
 * MEDIDO em producao (2026-09-09): `/pt/series/today/` tem 67 temporadas
 * distintas, e a temporada 1 sozinha tem 506 episodios. A pagina lia os
 * episodios das 67, montava a view de todos, e renderizava os de uma. Resposta
 * de 429,3 KB em 2,3 s.
 *
 * E esta ficha, diferente da de temporada, e INDEXADA e `force-dynamic`: nao ha
 * cache nenhum entre o acesso e o PostgreSQL. Cada visita pagava a conta
 * inteira.
 *
 * ============================================================================
 * COMO ESTE ARQUIVO MEDE
 * ============================================================================
 * Um Prisma FALSO com 67 temporadas de 100 episodios (6.700 no total). Ele e
 * generoso: consulta sem escopo de temporada recebe TUDO. O teste (1) prova
 * essa generosidade — sem ele, "poucas linhas" seria indistinguivel de "o fake
 * nao devolve nada", e o arquivo passaria vazio.
 *
 * O teste (3) e o par indispensavel do (2): cortar a leitura e facil, cortar
 * DEMAIS tambem. Se a temporada desenhada vier sem episodio, o corte quebrou a
 * pagina em vez de otimiza-la.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** 67 temporadas: o numero real medido em `/pt/series/today/`. */
const SEASON_COUNT = 67;
/** Episodios por temporada no fake. */
const EPISODES_PER_SEASON = 100;
const TOTAL_EPISODES = SEASON_COUNT * EPISODES_PER_SEASON;

/**
 * Teto de EPISODIOS lidos por render.
 *
 * A tela desenha uma temporada. Ler mais que uma temporada inteira (com folga)
 * so pode significar que o `select` aninhado voltou.
 */
const EPISODE_ROW_BUDGET = EPISODES_PER_SEASON + 50;

let episodeRowsRead = 0;
let queries: string[] = [];

function reset(): void {
  episodeRowsRead = 0;
  queries = [];
}

const SERIES_ID = 42n;

/** `id` da temporada N — determinista, para o fake casar `seasonId`. */
const seasonId = (n: number): bigint => BigInt(1_000 + n);

function episodeRow(seasonNumber: number, n: number): Record<string, unknown> {
  return {
    id: BigInt(seasonNumber * 10_000 + n),
    tmdbId: null,
    episodeNumber: n,
    name: `T${seasonNumber}E${n}`,
    overview: `Sinopse do episodio ${n} da temporada ${seasonNumber}. `.repeat(20),
    airDate: new Date(Date.UTC(2024, 0, 1)),
    runtimeMinutes: 45,
    stillPath: `/still-${seasonNumber}-${n}.jpg`,
  };
}

function episodesOfSeason(seasonNumber: number): Record<string, unknown>[] {
  return Array.from({ length: EPISODES_PER_SEASON }, (_u, i) =>
    episodeRow(seasonNumber, i + 1),
  );
}

/** Temporadas 1..SEASON_COUNT (sem "Especiais" — o default nao a escolheria). */
const SEASONS = Array.from({ length: SEASON_COUNT }, (_u, i) => {
  const seasonNumber = i + 1;
  return {
    id: seasonId(seasonNumber),
    seasonNumber,
    name: `Temporada ${seasonNumber}`,
    overview: `Sinopse da temporada ${seasonNumber}.`,
    airDate: new Date(Date.UTC(2000 + i, 0, 1)),
    episodeCount: EPISODES_PER_SEASON,
    posterPath: `/poster-${seasonNumber}.jpg`,
  };
});

function rowsFor(model: string, method: string, args: Record<string, unknown>): unknown {
  const where = (args.where ?? {}) as Record<string, unknown>;
  queries.push(`${model}.${method}`);

  if (model === "episode" && method === "findMany") {
    const scoped = where.seasonId;
    if (typeof scoped === "bigint") {
      const seasonNumber = Number(scoped - 1_000n);
      const rows = episodesOfSeason(seasonNumber);
      episodeRowsRead += rows.length;
      return rows;
    }
    // SEM ESCOPO: entrega TUDO. E assim que o defeito antigo reaparece.
    const all = SEASONS.flatMap((s) => episodesOfSeason(s.seasonNumber));
    episodeRowsRead += all.length;
    return all;
  }

  if (model === "season" && method === "findMany") {
    const select = args.select as { episodes?: unknown } | undefined;
    return SEASONS.map((s) => {
      if (select?.episodes === undefined) return s;
      // Quem pedir a lista aninhada PAGA por ela — e o teto reprova.
      const rows = episodesOfSeason(s.seasonNumber);
      episodeRowsRead += rows.length;
      return { ...s, episodes: rows };
    });
  }

  if (model === "slug" && method === "findFirst") {
    return where.slug !== undefined
      ? { entityId: SERIES_ID, slug: "serie-longa" }
      : { slug: "serie-longa", entityId: SERIES_ID };
  }

  if (model === "tvShow" && (method === "findUnique" || method === "findFirst")) {
    return {
      id: SERIES_ID,
      nameOriginal: "Serie Longa",
      firstAirDate: new Date(Date.UTC(2000, 0, 1)),
      lastAirDate: null,
      numberOfSeasons: SEASON_COUNT,
      numberOfEpisodes: TOTAL_EPISODES,
      posterPath: "/p.jpg",
      backdropPath: "/b.jpg",
      status: "Returning Series",
      originalLanguage: "en",
      certification: null,
      voteCountTmdb: 100,
      screenScore: null,
      screenScoreScale: null,
      screenScoreDisplay: false,
    };
  }

  if (model === "entityTranslation" && method === "findMany") {
    return [{ languageCode: "pt-BR", title: "Serie Longa", summary: null, overview: null }];
  }

  // Apoio (blocos, noticias, elenco, streaming, premios, notas, ids externos,
  // midia, licenca, decisao de indexabilidade): vazio.
  if (method === "findMany") return [];
  if (method === "count") return 0;
  if (method === "aggregate") return {};
  if (method === "groupBy") return [];
  return null;
}

const fakePrisma = new Proxy(
  {},
  {
    get(_t, model: string | symbol) {
      if (typeof model === "symbol") return undefined;
      if (model.startsWith("$")) return () => Promise.resolve([]);
      return new Proxy(
        {},
        {
          get(_i, method: string | symbol) {
            if (typeof method === "symbol") return undefined;
            return (args: Record<string, unknown> = {}) =>
              Promise.resolve(rowsFor(model, method, args));
          },
        },
      );
    },
  },
);

vi.mock("@screena/db/server", () => ({
  getPrismaClient: () => fakePrisma,
  disconnectPrisma: () => Promise.resolve(),
}));

const { getSeriesPageData } = await import("../series-page");

beforeEach(() => {
  reset();
});

describe(`ficha de serie (${SEASON_COUNT} temporadas x ${EPISODES_PER_SEASON} episodios)`, () => {
  it("(1) CONTROLE: o fake DA todos os episodios quando ninguem escopa", async () => {
    reset();
    await (
      fakePrisma as { episode: { findMany: (a: unknown) => Promise<unknown> } }
    ).episode.findMany({});
    expect(episodeRowsRead).toBe(TOTAL_EPISODES);
  });

  it("(2) le os episodios de UMA temporada, nao das 67", async () => {
    const data = await getSeriesPageData("serie-longa");
    expect(data, "a ficha precisa carregar para a medicao valer").not.toBeNull();
    expect(episodeRowsRead).toBeGreaterThan(0);
    expect(
      episodeRowsRead,
      `consultas: ${[...new Set(queries)].join(" ")}`,
    ).toBeLessThanOrEqual(EPISODE_ROW_BUDGET);
  });

  it("(3) a temporada DESENHADA tem episodios — o corte nao cortou demais", async () => {
    // O par indispensavel do (2). Ler pouco e facil; ler pouco E DEMAIS tambem.
    const data = await getSeriesPageData("serie-longa");
    expect(data?.activeSeasonNumber).toBe(1);
    const desenhada = data?.view.seasons.find(
      (s) => s.seasonNumber === data.activeSeasonNumber,
    );
    expect(desenhada?.episodes.length).toBe(EPISODES_PER_SEASON);
  });

  it("(4) `?temporada=N` carrega os episodios DAQUELA temporada", async () => {
    const data = await getSeriesPageData("serie-longa", 40);
    expect(data?.activeSeasonNumber).toBe(40);
    const desenhada = data?.view.seasons.find((s) => s.seasonNumber === 40);
    expect(desenhada?.episodes.length).toBe(EPISODES_PER_SEASON);
    expect(desenhada?.episodes[0]?.title).toBe("T40E1");
    expect(episodeRowsRead).toBeLessThanOrEqual(EPISODE_ROW_BUDGET);
  });

  it("(5) as OUTRAS temporadas continuam na tela, sem episodios", async () => {
    // A tira de temporadas nao pode sumir: ela e a navegacao da ficha. O que
    // sai e a lista de episodios das que nao estao sendo desenhadas.
    const data = await getSeriesPageData("serie-longa");
    expect(data?.view.seasons.length).toBe(SEASON_COUNT);
    const outra = data?.view.seasons.find((s) => s.seasonNumber === 2);
    expect(outra, "a temporada 2 tem de continuar listada").toBeDefined();
    expect(outra?.episodes).toEqual([]);
  });

  it("(6) o custo NAO cresce com o numero de temporadas", async () => {
    const data = await getSeriesPageData("serie-longa");
    expect(data).not.toBeNull();
    // Uma temporada, nao 67. Com o defeito de volta seriam 6.700.
    expect(episodeRowsRead).toBeLessThan(TOTAL_EPISODES / 10);
  });
});
