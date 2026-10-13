/**
 * home-ticker-scope.test.ts — A faixa amarela (agenda) por vertical.
 *
 * ============ O QUE FOI MEDIDO NO SITE, E O QUE ERA PREMISSA ERRADA ============
 *
 * A faixa EXISTE nas três páginas hoje (`/pt`, `/pt/filmes`, `/pt/series`) — as
 * três em estado neutro ("AGENDA · Nenhuma novidade confirmada para hoje"),
 * porque o catálogo não tem nenhum evento na janela. A "seção AGENDA" que
 * aparecia só em `/pt/series` é essa mesma faixa: `AGENDA` é o rótulo do estado
 * neutro, não um segundo componente.
 *
 * Os defeitos reais eram outros dois, e nenhum aparecia com o catálogo vazio:
 *
 *  1. `/pt/filmes` passava `tickerItems={[]}` — a faixa estava MORTA por
 *     construção e continuaria vazia mesmo com estreia de filme confirmada hoje;
 *  2. `/pt/series` recebia a lista sem escopo — uma estreia de FILME apareceria
 *     na agenda da página de séries.
 *
 * ============ O QUE NÃO EXISTE ============
 *
 * Sessão de cinema. O canônico mostra "IMAX · 4 sessões · em cartaz hoje" em
 * `/pt/filmes`, e o sistema não persiste sala, formato nem número de sessões.
 * `movies.release_date` afirma ESTREIA. A faixa de filmes mostra estreia e
 * chegada ao streaming — fatos reais — e nunca inventa uma sessão.
 */

import { describe, expect, it } from "vitest";

import { getHomeTickerItems } from "../home-ticker";

/** Modelos que cada escopo tem direito de consultar. */
const EVENT_MODELS = ["episode", "movie", "season", "watchAvailability"] as const;

interface Recorded {
  model: string;
  args: Record<string, unknown>;
  /** Presente quando a fonte foi consultada por SQL (a home, desde 13/10/2026). */
  sql?: string;
  params?: unknown[];
}

/** A tabela de EVENTO de uma consulta SQL, no nome do modelo Prisma. */
function modelOfSql(sql: string): string {
  if (/FROM episodes\b/.test(sql)) return "episode";
  if (/FROM seasons\b/.test(sql)) return "season";
  if (/FROM movies\b/.test(sql)) return "movie";
  return "$queryRawUnsafe";
}

/**
 * Cliente falso que registra a descoberta. Devolve listas vazias: o que
 * interessa aqui é QUAIS fontes cada escopo consulta — a montagem dos itens já
 * é coberta por `home-ticker-presenter.test.ts`.
 *
 * A home consulta episódio, estreia e temporada por SQL (o portão de relevância
 * tem um ramo numa tabela polimórfica, sem relação Prisma); o fake registra o
 * SQL sob o nome do modelo da tabela, para que "consultou episódio" continue
 * significando a mesma coisa nos dois caminhos.
 */
function fakePrisma(calls: Recorded[]) {
  const record =
    (model: string) =>
    (args: Record<string, unknown>) => {
      calls.push({ model, args });
      return Promise.resolve([]);
    };
  return {
    $queryRawUnsafe: (sql: string, ...params: unknown[]) => {
      calls.push({ model: modelOfSql(sql), args: {}, sql, params });
      return Promise.resolve([]);
    },
    episode: { findMany: record("episode") },
    movie: { findMany: record("movie") },
    season: { findMany: record("season") },
    watchAvailability: { findMany: record("watchAvailability") },
    tvShow: { findMany: record("tvShow") },
    slug: { findMany: record("slug") },
    entityTranslation: { findMany: record("entityTranslation") },
  };
}

/**
 * `getHomeTickerItems` usa `cache()` do React e o cliente do processo. Aqui
 * exercitamos o mesmo módulo com um cliente injetado por `globalThis`, que é
 * onde `@screena/db/server` guarda o singleton — sem isso a chamada tentaria
 * abrir conexão real.
 */
async function recordedFor(scope: "home" | "movies" | "series"): Promise<Recorded[]> {
  const calls: Recorded[] = [];
  const scoped = globalThis as { __screenaPrismaClient?: unknown };
  const previous = scoped.__screenaPrismaClient;
  scoped.__screenaPrismaClient = fakePrisma(calls);
  try {
    await getHomeTickerItems(scope);
  } finally {
    scoped.__screenaPrismaClient = previous;
  }
  return calls;
}

async function discoveryFor(scope: "home" | "movies" | "series"): Promise<string[]> {
  const calls = await recordedFor(scope);
  return calls
    .map((call) => call.model)
    .filter((model): model is (typeof EVENT_MODELS)[number] =>
      (EVENT_MODELS as readonly string[]).includes(model),
    );
}

describe("escopo da faixa de agenda", () => {
  it("(1) /pt/series consulta só eventos de SÉRIE (episódio, temporada, chegada)", async () => {
    const models = await discoveryFor("series");

    expect(models).toContain("episode");
    expect(models).toContain("season");
    expect(models).toContain("watchAvailability");
    // NEGATIVO: estreia de filme não pode entrar na agenda de séries.
    expect(models).not.toContain("movie");
  });

  it("(2) /pt/filmes consulta só eventos de FILME (estreia, chegada) — e não nasce morta", async () => {
    const models = await discoveryFor("movies");

    expect(models).toContain("movie");
    expect(models).toContain("watchAvailability");
    expect(models).not.toContain("episode");
    expect(models).not.toContain("season");
  });

  it("(3) CONTROLE POSITIVO: a home é a união e consulta as QUATRO fontes", async () => {
    const models = await discoveryFor("home");

    for (const model of EVENT_MODELS) {
      expect(models, `home não consultou ${model}`).toContain(model);
    }
  });
});

/**
 * NA HOME, A FAIXA SO ANUNCIA TITULO QUE ESTA NO INDICE (decisao do dono,
 * 13/10/2026). Medido no ar no mesmo dia: o "NOVO" era o episodio 32 da
 * temporada 29 de uma novela polonesa cuja ficha responde `noindex, follow`.
 *
 * A prova e sobre a CONSULTA: o portao tem de estar ANTES do teto de 60 linhas.
 * Um `.filter()` na saida passaria num teste de markup e esvaziaria a faixa num
 * dia de muitas novelas.
 */
describe("portao de relevancia na faixa da home", () => {
  const EVENT_SQL_MODELS = ["episode", "movie", "season"];

  it("(4) episodio, estreia e temporada carregam o predicado do sitemap, antes do LIMIT", async () => {
    const calls = await recordedFor("home");
    const sqlCalls = calls.filter((call) => call.sql !== undefined);

    expect(sqlCalls.map((call) => call.model).sort()).toEqual([...EVENT_SQL_MODELS].sort());
    for (const call of sqlCalls) {
      const sql = call.sql ?? "";
      const params = call.params ?? [];
      expect(sql, call.model).toContain("vote_count_tmdb");
      expect(sql, call.model).toContain("watch_availability");
      expect(sql, call.model).toMatch(/movie_production_countries|tv_show_origin_countries/);
      // Os NUMEROS sao os de @screena/config, como parametro — nunca literal.
      expect(params, call.model).toContain(500);
      expect(params, call.model).toContainEqual(["US", "BR"]);
      expect(params, call.model).toContain("BR");
      // O teto e o ULTIMO parametro, depois do predicado.
      expect(params.at(-1), call.model).toBe(60);
      expect(sql, call.model).toMatch(new RegExp(`LIMIT \\$${params.length}\\b`));
      // A data vai como dia (YYYY-MM-DD): o fuso da sessao nao desloca o dia.
      expect(params[0], call.model).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("(5) NEGATIVO: /pt/filmes e /pt/series continuam nas consultas Prisma, sem portao", async () => {
    for (const scope of ["movies", "series"] as const) {
      const calls = await recordedFor(scope);
      expect(calls.filter((call) => call.sql !== undefined), scope).toEqual([]);
    }
  });

  it("(6) a chave de EMERGENCIA desliga o portao tambem na home", async () => {
    const previous = process.env.CINERIE_RELEVANCE_GATE;
    process.env.CINERIE_RELEVANCE_GATE = "off";
    try {
      const calls = await recordedFor("home");
      const sqlCalls = calls.filter((call) => call.sql !== undefined);
      expect(sqlCalls).toHaveLength(EVENT_SQL_MODELS.length);
      for (const call of sqlCalls) {
        expect(call.sql, call.model).not.toContain("vote_count_tmdb");
        expect(call.params, call.model).toHaveLength(3);
      }
    } finally {
      if (previous === undefined) delete process.env.CINERIE_RELEVANCE_GATE;
      else process.env.CINERIE_RELEVANCE_GATE = previous;
    }
  });
});
