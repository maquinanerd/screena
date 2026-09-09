/**
 * series-page-row-budget.test.ts — QUAIS temporadas a ficha de SERIE consulta
 * para desenhar a lista de episodios de UMA.
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
 * O QUE ESTE ARQUIVO AFIRMA — E O QUE ELE NAO AFIRMA
 * ============================================================================
 * NAO existe teto absoluto de linhas aqui, e a primeira versao deste arquivo
 * errava justamente nisso: ela exigia "<= 150 linhas", numero que so fazia
 * sentido porque o fake usava temporadas de 100 episodios. Numa serie diaria a
 * temporada selecionada TEM milhares de episodios, e le-los todos e o
 * comportamento CORRETO — a ficha mostra a temporada inteira.
 *
 * A afirmacao certa nao e sobre quantidade, e sobre ESCOPO: consulta-se a
 * temporada selecionada, e SOMENTE ela. Por isso o fake registra quais
 * `seasonId` foram perguntados, e as asercoes comparam com a temporada
 * desenhada — o que vale igual para uma temporada de 12 e para uma de 5.000.
 *
 * O fake e generoso: consulta sem escopo recebe TUDO. O teste (1) prova essa
 * generosidade — sem ele, "poucas linhas" seria indistinguivel de "o fake nao
 * devolve nada", e o arquivo passaria vazio.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** 67 temporadas: o numero real medido em `/pt/series/today/`. */
const SEASON_COUNT = 67;
/**
 * A temporada 1 e a de PROGRAMA DIARIO: 5.000 episodios. As demais tem 100.
 *
 * A assimetria e o ponto do arquivo: a temporada cara e justamente a default,
 * entao um teste que so olhasse "poucas linhas" reprovaria o comportamento
 * correto.
 */
const BIG_SEASON_EPISODES = 5_000;
const SMALL_SEASON_EPISODES = 100;
const TOTAL_EPISODES = BIG_SEASON_EPISODES + (SEASON_COUNT - 1) * SMALL_SEASON_EPISODES;

let episodeRowsRead = 0;
/** Quais temporadas tiveram os episodios consultados nesta renderizacao. */
let queriedSeasonNumbers: number[] = [];

function reset(): void {
  episodeRowsRead = 0;
  queriedSeasonNumbers = [];
}

const SERIES_ID = 42n;

/** `id` da temporada N — determinista, para o fake casar `seasonId`. */
const seasonId = (n: number): bigint => BigInt(1_000 + n);
const seasonNumberOf = (id: bigint): number => Number(id - 1_000n);

const episodesOf = (seasonNumber: number): number =>
  seasonNumber === 1 ? BIG_SEASON_EPISODES : SMALL_SEASON_EPISODES;

function episodeRow(seasonNumber: number, n: number): Record<string, unknown> {
  return {
    id: BigInt(seasonNumber * 100_000 + n),
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
  return Array.from({ length: episodesOf(seasonNumber) }, (_u, i) =>
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
    episodeCount: episodesOf(seasonNumber),
    posterPath: `/poster-${seasonNumber}.jpg`,
  };
});

function rowsFor(model: string, method: string, args: Record<string, unknown>): unknown {
  const where = (args.where ?? {}) as Record<string, unknown>;

  if (model === "episode" && method === "findMany") {
    const scoped = where.seasonId;
    if (typeof scoped === "bigint") {
      const seasonNumber = seasonNumberOf(scoped);
      queriedSeasonNumbers.push(seasonNumber);
      const rows = episodesOfSeason(seasonNumber);
      episodeRowsRead += rows.length;
      return rows;
    }
    // SEM ESCOPO: entrega TUDO. E assim que o defeito antigo reaparece.
    queriedSeasonNumbers.push(...SEASONS.map((s) => s.seasonNumber));
    const all = SEASONS.flatMap((s) => episodesOfSeason(s.seasonNumber));
    episodeRowsRead += all.length;
    return all;
  }

  if (model === "season" && method === "findMany") {
    const select = args.select as { episodes?: unknown } | undefined;
    return SEASONS.map((s) => {
      if (select?.episodes === undefined) return s;
      // Quem pedir a lista aninhada PAGA por ela, e para TODAS as temporadas —
      // que era exatamente o defeito.
      queriedSeasonNumbers.push(s.seasonNumber);
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

describe(`ficha de serie (${SEASON_COUNT} temporadas; a 1a tem ${BIG_SEASON_EPISODES} episodios)`, () => {
  it("(1) CONTROLE: o fake DA todos os episodios quando ninguem escopa", async () => {
    reset();
    await (
      fakePrisma as { episode: { findMany: (a: unknown) => Promise<unknown> } }
    ).episode.findMany({});
    expect(episodeRowsRead).toBe(TOTAL_EPISODES);
    expect(queriedSeasonNumbers).toHaveLength(SEASON_COUNT);
  });

  it("(2) consulta UMA temporada, e e a que sera desenhada", async () => {
    // A afirmacao e sobre ESCOPO, nao sobre quantidade: nao importa se a
    // temporada tem 12 ou 5.000 episodios, o que nao pode acontecer e perguntar
    // pelas outras 66.
    const data = await getSeriesPageData("serie-longa");
    expect(data, "a ficha precisa carregar para a medicao valer").not.toBeNull();
    expect(queriedSeasonNumbers).toEqual([data?.activeSeasonNumber]);
  });

  it("(3) a temporada selecionada aparece INTEIRA, com seus 5.000 episodios", async () => {
    // O par indispensavel do (2). Cortar a leitura e facil; cortar DEMAIS
    // tambem. A ficha mostra a temporada inteira, e um `take` aqui seria
    // regressao de produto — nao otimizacao.
    const data = await getSeriesPageData("serie-longa");
    expect(data?.activeSeasonNumber).toBe(1);
    const desenhada = data?.view.seasons.find((s) => s.seasonNumber === 1);
    expect(desenhada?.episodes.length).toBe(BIG_SEASON_EPISODES);
    expect(desenhada?.episodes.at(-1)?.episodeNumber).toBe(BIG_SEASON_EPISODES);
    // E le exatamente o tamanho da temporada — nem mais (as outras 66), nem
    // menos (um teto artificial).
    expect(episodeRowsRead).toBe(BIG_SEASON_EPISODES);
  });

  it("(4) `?temporada=N` consulta e desenha SO aquela", async () => {
    const data = await getSeriesPageData("serie-longa", 40);
    expect(data?.activeSeasonNumber).toBe(40);
    expect(queriedSeasonNumbers).toEqual([40]);
    const desenhada = data?.view.seasons.find((s) => s.seasonNumber === 40);
    expect(desenhada?.episodes.length).toBe(SMALL_SEASON_EPISODES);
    expect(desenhada?.episodes[0]?.title).toBe("T40E1");
    expect(episodeRowsRead).toBe(SMALL_SEASON_EPISODES);
  });

  it("(5) as temporadas NAO selecionadas nao sao consultadas", async () => {
    const data = await getSeriesPageData("serie-longa", 40);
    const naoSelecionadas = SEASONS.map((s) => s.seasonNumber).filter((n) => n !== 40);
    for (const n of naoSelecionadas) {
      expect(queriedSeasonNumbers, `a temporada ${n} nao devia ter sido consultada`).not.toContain(n);
    }
    expect(data?.view.seasons.find((s) => s.seasonNumber === 1)?.episodes).toEqual([]);
  });

  it("(6) as outras temporadas CONTINUAM na tela — a tira de navegacao nao sumiu", async () => {
    // O que sai e a lista de episodios das nao desenhadas, nao as temporadas.
    const data = await getSeriesPageData("serie-longa");
    expect(data?.view.seasons.length).toBe(SEASON_COUNT);
    expect(data?.view.seasons.find((s) => s.seasonNumber === 2)).toBeDefined();
  });

  it("(7) o custo escala com a temporada DESENHADA, nao com o catalogo", async () => {
    // Uma temporada grande custa mais que uma pequena — e isso esta certo. O
    // que nao pode e custar o total da serie.
    reset();
    await getSeriesPageData("serie-longa");
    const grande = episodeRowsRead;

    reset();
    await getSeriesPageData("serie-longa", 40);
    const pequena = episodeRowsRead;

    expect(grande).toBe(BIG_SEASON_EPISODES);
    expect(pequena).toBe(SMALL_SEASON_EPISODES);
    expect(grande).toBeLessThan(TOTAL_EPISODES);
  });
});
