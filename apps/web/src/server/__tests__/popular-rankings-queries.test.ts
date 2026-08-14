/**
 * popular-rankings-queries.test.ts — CADA ABA DISPARA A SUA CONSULTA.
 *
 * ============ POR QUE ESTE ARQUIVO EXISTE ============
 *
 * "As abas trocam a lista" é a afirmação que um teste de renderização NÃO
 * consegue provar: um componente que recebesse a MESMA lista três vezes
 * renderizaria três abas perfeitas e passaria em tudo. O defeito anterior era
 * exatamente desse tipo — as abas existiam, tinham estilo de ativa, e não
 * buscavam nada.
 *
 * Aqui a prova é sobre a CONSULTA. Um cliente Prisma falso registra qual modelo
 * e qual filtro cada aba tocou, e as asserções comparam recorte com recorte —
 * não markup com markup.
 *
 * O cliente falso também é o único jeito honesto de medir isto sem banco: o
 * caminho real é `loadPopularRanking`, o MESMO que `getPopularRanking` chama em
 * produção (a única diferença é a memoização de `cache()`, que fora de um
 * request React atravessaria os casos de teste).
 */

import { describe, expect, it } from "vitest";

import { loadPopularRanking } from "../popular-rankings";
import { POPULAR_RANKING_LIMIT, RANKING_TABS } from "../../lib/popular-rankings";

/** Instante fixo: a janela de "No ar"/"Novas temporadas" não pode variar com o relógio. */
const NOW = new Date("2026-08-13T12:00:00.000Z");

interface RecordedCall {
  model: string;
  method: string;
  args: Record<string, unknown>;
}

/**
 * Catálogo mínimo do banco falso. Dois filmes e duas séries, TODOS com slug
 * canônico pt-BR e tradução — sem isso nenhum candidato vira card, e o teste
 * mediria a ausência de identidade em vez do recorte.
 */
const MOVIE_IDS = [1n, 2n];
const TV_IDS = [10n, 11n];

function fakePrisma(calls: RecordedCall[]) {
  const record = (model: string, method: string) => (args: Record<string, unknown>) => {
    calls.push({ model, method, args });
    switch (`${model}.${method}`) {
      case "movie.findMany":
        return Promise.resolve(MOVIE_IDS.map((id) => ({ id, titleOriginal: `Filme ${id}`, posterPath: null })));
      case "tvShow.findMany":
        return Promise.resolve(TV_IDS.map((id) => ({ id, nameOriginal: `Série ${id}`, posterPath: null })));
      case "episode.findMany":
        return Promise.resolve(TV_IDS.map((id) => ({ tvShowId: id })));
      case "season.findMany":
        return Promise.resolve(TV_IDS.map((id) => ({ tvShowId: id })));
      case "watchAvailability.findMany":
        return Promise.resolve([
          { entityType: "movie", entityId: MOVIE_IDS[0] },
          { entityType: "tv", entityId: TV_IDS[0] },
        ]);
      case "slug.findMany":
        return Promise.resolve([
          ...MOVIE_IDS.map((id) => ({ entityType: "movie", entityId: id, slug: `filme-${id}` })),
          ...TV_IDS.map((id) => ({ entityType: "tv", entityId: id, slug: `serie-${id}` })),
        ]);
      case "entityTranslation.findMany":
        return Promise.resolve([
          ...MOVIE_IDS.map((id) => ({ entityType: "movie", entityId: id, title: `Filme ${id}` })),
          ...TV_IDS.map((id) => ({ entityType: "tv", entityId: id, title: `Série ${id}` })),
        ]);
      default:
        return Promise.resolve([]);
    }
  };
  return {
    movie: { findMany: record("movie", "findMany") },
    tvShow: { findMany: record("tvShow", "findMany") },
    episode: { findMany: record("episode", "findMany") },
    season: { findMany: record("season", "findMany") },
    watchAvailability: { findMany: record("watchAvailability", "findMany") },
    slug: { findMany: record("slug", "findMany") },
    entityTranslation: { findMany: record("entityTranslation", "findMany") },
  } as unknown as Parameters<typeof loadPopularRanking>[0];
}

/** Só as consultas de DESCOBERTA do recorte (a resolução de identidade é comum). */
const IDENTITY_MODELS = new Set(["slug", "entityTranslation", "movie", "tvShow"]);

async function discoveryFor(vertical: "home" | "movies" | "series", slug: string) {
  const calls: RecordedCall[] = [];
  const result = await loadPopularRanking(
    fakePrisma(calls),
    vertical,
    slug as Parameters<typeof loadPopularRanking>[2],
    NOW,
  );
  // A resolução de identidade roda DEPOIS da descoberta; as chamadas anteriores
  // à primeira de `slug.findMany` são o recorte propriamente dito.
  const cut = calls.findIndex((call) => call.model === "slug");
  const discovery = (cut === -1 ? calls : calls.slice(0, cut)).filter(
    (call) => !IDENTITY_MODELS.has(call.model) || call.model === "movie" || call.model === "tvShow",
  );
  return { result, discovery, calls };
}

describe("cada aba tem a SUA consulta (não um slice da mesma lista)", () => {
  it("(1) /pt/filmes: as três abas tocam recortes DISTINTOS", async () => {
    const cartaz = await discoveryFor("movies", "em-cartaz");
    const streaming = await discoveryFor("movies", "streaming");
    const classicos = await discoveryFor("movies", "classicos");

    // "Em cartaz" não consulta nada: o fato (sessão numa sala) não existe no
    // modelo de dados. A aba fica visível e declara o vazio — nunca deriva
    // "em cartaz" de `release_date`, que afirma estreia, não sessão.
    expect(cartaz.discovery).toHaveLength(0);
    expect(cartaz.result.items).toHaveLength(0);
    expect(cartaz.result.absence?.reason).toBe("no_theatrical_session_data");

    expect(streaming.discovery.map((call) => call.model)).toEqual(["watchAvailability"]);
    expect(classicos.discovery.map((call) => call.model)).toEqual(["movie"]);

    // E os recortes não são a mesma consulta com outro nome.
    expect(JSON.stringify(streaming.discovery)).not.toBe(JSON.stringify(classicos.discovery));
  });

  it("(2) /pt/series: as três abas tocam recortes DISTINTOS", async () => {
    const noAr = await discoveryFor("series", "no-ar");
    const streaming = await discoveryFor("series", "streaming");
    const temporadas = await discoveryFor("series", "novas-temporadas");

    expect(noAr.discovery.map((call) => call.model)).toEqual(["episode"]);
    expect(streaming.discovery.map((call) => call.model)).toEqual(["watchAvailability"]);
    expect(temporadas.discovery.map((call) => call.model)).toEqual(["season"]);
  });

  it("(3) 'Clássicos' corta por estreia até 1999 E por volume mínimo de votos", async () => {
    const { discovery } = await discoveryFor("movies", "classicos");
    const where = discovery[0]?.args.where as Record<string, Record<string, unknown>>;
    expect((where.releaseDate?.lte as Date).getUTCFullYear()).toBe(1999);
    expect(where.voteCountTmdb?.gte).toBeGreaterThan(0);
  });

  it("(4) 'No ar' e 'Novas temporadas' usam janelas de tempo diferentes", async () => {
    const noAr = await discoveryFor("series", "no-ar");
    const temporadas = await discoveryFor("series", "novas-temporadas");
    const windowOf = (call: RecordedCall | undefined): { gte: Date; lte: Date } => {
      const airDate = (call?.args.where as { airDate?: { gte?: Date; lte?: Date } } | undefined)
        ?.airDate;
      expect(airDate?.gte, "recorte sem início de janela").toBeInstanceOf(Date);
      expect(airDate?.lte, "recorte sem fim de janela").toBeInstanceOf(Date);
      return { gte: airDate?.gte as Date, lte: airDate?.lte as Date };
    };

    // "No ar" olha só para trás (episódio já exibido); "Novas temporadas" olha
    // para os dois lados da data de hoje.
    expect(windowOf(noAr.discovery[0]).lte).toEqual(NOW);
    expect(windowOf(temporadas.discovery[0]).gte.getTime()).toBeLessThan(NOW.getTime());
    expect(windowOf(temporadas.discovery[0]).lte.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe("a aba de streaming respeita a vertical da página", () => {
  it("(5) /pt/filmes pede só oferta de FILME; /pt/series, só de SÉRIE", async () => {
    const movies = await discoveryFor("movies", "streaming");
    const series = await discoveryFor("series", "streaming");
    const home = await discoveryFor("home", "streaming");

    const typesOf = (call: RecordedCall | undefined): string[] => {
      const and = (call?.args.where as { AND?: Array<{ OR?: Array<{ entityType: string }> }> })?.AND;
      return (and?.[0]?.OR ?? []).map((clause) => clause.entityType);
    };

    expect(typesOf(movies.discovery[0])).toEqual(["movie"]);
    expect(typesOf(series.discovery[0])).toEqual(["tv"]);
    // A home é a UNIÃO: ela é a única que pede os dois.
    expect(typesOf(home.discovery[0])).toEqual(["movie", "tv"]);
  });

  /**
   * O que o leitor VÊ: `/pt/filmes` não pode devolver nenhuma série, e
   * `/pt/series` nenhum filme — mesmo com o banco contendo os dois tipos com
   * oferta exibível. É o teste com fixture dos DOIS tipos que o enunciado pede.
   *
   * O banco falso é ADVERSARIAL de propósito: ele devolve filme E série na
   * consulta de streaming, ignorando o `where`. Isso mede a segunda barreira
   * (`scopedToVertical`) e não só a primeira — um `where` afrouxado por engano
   * continua não conseguindo colocar série na página de filmes. Quando este
   * teste foi escrito, a barreira não existia e ele reprovou.
   */
  it("(6) NEGATIVO: nenhum título da outra vertical atravessa para a página", async () => {
    const movies = await discoveryFor("movies", "streaming");
    const series = await discoveryFor("series", "streaming");

    expect(movies.result.items.map((item) => item.href).join(" ")).not.toContain("/pt/series/");
    expect(movies.result.items.every((item) => item.href.startsWith("/pt/filmes/"))).toBe(true);

    expect(series.result.items.map((item) => item.href).join(" ")).not.toContain("/pt/filmes/");
    expect(series.result.items.every((item) => item.href.startsWith("/pt/series/"))).toBe(true);

    // CONTROLE POSITIVO: as duas páginas de fato devolveram alguma coisa — sem
    // isto, um filtro que zerasse tudo passaria nas asserções acima.
    expect(movies.result.items.length).toBeGreaterThan(0);
    expect(series.result.items.length).toBeGreaterThan(0);
  });
});

describe("aba curta nunca falha em silêncio", () => {
  it("(7) toda aba com menos itens que o teto registra o motivo", async () => {
    for (const vertical of ["home", "movies", "series"] as const) {
      for (const tab of RANKING_TABS[vertical]) {
        const { result } = await discoveryFor(vertical, tab.slug);
        if (result.items.length >= POPULAR_RANKING_LIMIT) continue;
        expect(result.absence, `${vertical}/${tab.slug} sumiu sem motivo`).not.toBeNull();
        expect(result.absence?.returned).toBe(result.items.length);
        expect(result.absence?.tab).toBe(tab.slug);
      }
    }
  });

  it("(8) o motivo separa 'falta operação' de 'fato sobre o catálogo'", async () => {
    const cartaz = await discoveryFor("movies", "em-cartaz");
    const classicos = await discoveryFor("movies", "classicos");

    // Falta ingestão de exibição em salas: alguém precisa agir.
    expect(cartaz.result.absence?.actionable).toBe(true);
    // Não há clássico qualificado no catálogo: é um fato, não um passo pendente.
    expect(classicos.result.absence?.actionable).toBe(false);
  });
});
