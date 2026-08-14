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
}

/**
 * Cliente falso que registra a descoberta. Devolve listas vazias: o que
 * interessa aqui é QUAIS fontes cada escopo consulta — a montagem dos itens já
 * é coberta por `home-ticker-presenter.test.ts`.
 */
function fakePrisma(calls: Recorded[]) {
  const record =
    (model: string) =>
    (args: Record<string, unknown>) => {
      calls.push({ model, args });
      return Promise.resolve([]);
    };
  return {
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
async function discoveryFor(scope: "home" | "movies" | "series"): Promise<string[]> {
  const calls: Recorded[] = [];
  const scoped = globalThis as { __screenaPrismaClient?: unknown };
  const previous = scoped.__screenaPrismaClient;
  scoped.__screenaPrismaClient = fakePrisma(calls);
  try {
    await getHomeTickerItems(scope);
  } finally {
    scoped.__screenaPrismaClient = previous;
  }
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
