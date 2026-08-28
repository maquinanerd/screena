/**
 * public-surface-row-budget.test.ts — QUANTAS LINHAS uma superficie publica
 * pede ao banco para desenhar uma tela.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE ARQUIVO TRAVA
 * ============================================================================
 * Ate 2026-08-28, `/pt/filmes/`, `/pt/series/`, `/pt/pessoas/` e a home liam o
 * CATALOGO INTEIRO por requisicao para exibir 24 cards: todos os slugs
 * canonicos, todas as entidades daqueles ids, todas as traducoes daqueles ids.
 * Com 129 titulos isso era desperdicio invisivel. Medido em producao em
 * 2026-08-28, com o catalogo grande: TTFB de 3.016 ms em `/pt/filmes/`,
 * 4.496 ms em `/pt/series/`, 3.706 ms na home — contra 336 ms de
 * `/api/health/` pela MESMA rota de rede.
 *
 * A PR #240 tinha consertado o ESTOURO do protocolo (o `IN (...)` acima de
 * 32.767 parametros), nao o VOLUME. `findManyInChunks` continua necessario e
 * continua no lugar; o que mudou e a lista nao chegar mais nesse tamanho.
 *
 * ============================================================================
 * COMO ESTE ARQUIVO MEDE
 * ============================================================================
 * Um Prisma FALSO com um catalogo de 40.000 filmes e 40.000 series. Ele e
 * generoso de proposito: se o codigo pedir tudo, ele DA tudo. E por isso que o
 * numero denuncia — com o defeito de volta, a contagem sobe para dezenas de
 * milhares e a asercao fica vermelha.
 *
 * O teto nao e meta de performance: e limite ESTRUTURAL. Uma listagem exibe 24
 * cards; passar de 2.000 linhas so pode significar que alguem voltou a varrer a
 * tabela.
 *
 * A mesma propriedade e medida contra PostgreSQL REAL, com Next REAL e
 * `pg_stat_statements`, em
 * `apps/web/scripts/validate-route-cache-real-postgres.ts`. Os dois existem
 * porque medem coisas diferentes: aqui e barato e roda em `pnpm test`; la e a
 * prova de que o SQL que escrevemos faz no banco de verdade o que este fake
 * simula.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tamanho do catalogo falso. Grande o bastante para o defeito ter sombra. */
const CATALOG = 40_000;

/** Teto de linhas por superficie. Ver o cabecalho: e limite, nao meta. */
const ROW_BUDGET = 2_000;

/** Linhas devolvidas por TODAS as consultas desde o ultimo `reset()`. */
let rowsReturned = 0;
/** Registro para o diagnostico quando o teto estoura. */
let heaviest: Array<{ what: string; rows: number }> = [];

function count(what: string, rows: unknown[]): unknown[] {
  rowsReturned += rows.length;
  heaviest.push({ what, rows: rows.length });
  return rows;
}

function reset(): void {
  rowsReturned = 0;
  heaviest = [];
}

function topOffenders(): string {
  return [...heaviest]
    .sort((a, b) => b.rows - a.rows)
    .slice(0, 4)
    .map((entry) => `${entry.what}=${entry.rows}`)
    .join(" ");
}

const ids = (n: number, offset = 0): bigint[] =>
  Array.from({ length: n }, (_unused, i) => BigInt(i + 1 + offset));

/** O ultimo parametro numerico de um `$queryRawUnsafe` e sempre o `LIMIT`. */
function limitOf(params: unknown[], fallback: number): number {
  for (let i = params.length - 1; i >= 0; i -= 1) {
    const value = params[i];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  }
  return fallback;
}

/**
 * `where.id.in` / `where.entityId.in` quando existe — o fake respeita o escopo
 * que o chamador pediu. Sem escopo, devolve o CATALOGO INTEIRO: e assim que o
 * defeito antigo volta a aparecer se alguem o reintroduzir.
 */
function scopeOf(where: Record<string, unknown> | undefined): bigint[] | null {
  if (where === undefined) return null;
  for (const key of ["id", "entityId"]) {
    const field = where[key] as { in?: bigint[] } | undefined;
    if (field !== undefined && Array.isArray(field.in)) return field.in;
  }
  return null;
}

function rowsFor(model: string, method: string, args: Record<string, unknown>): unknown {
  const where = args.where as Record<string, unknown> | undefined;
  const take = typeof args.take === "number" ? args.take : undefined;
  const scope = scopeOf(where);
  const universe = scope ?? ids(CATALOG);
  const limited = take === undefined ? universe : universe.slice(0, take);

  if (method === "count") return universe.length;
  if (method === "findFirst") return null;
  if (method !== "findMany") return null;

  switch (model) {
    case "slug":
      return count(
        "slug.findMany",
        limited.map((id) => ({ entityType: "movie", entityId: id, slug: `s-${id}` })),
      );
    case "entityTranslation":
      return count(
        "entityTranslation.findMany",
        limited.map((id) => ({
          entityType: "movie",
          entityId: id,
          title: `T${id}`,
          summary: `S${id}`,
        })),
      );
    case "movie":
      return count(
        "movie.findMany",
        limited.map((id) => ({
          id,
          tmdbId: Number(id),
          titleOriginal: `M${id}`,
          releaseDate: new Date(Date.UTC(2024, 0, 1)),
          voteCountTmdb: 5_000,
          status: "Released",
          certification: null,
          screenScore: null,
          screenScoreScale: null,
          screenScoreDisplay: false,
          backdropPath: `/b-${id}.jpg`,
          posterPath: `/p-${id}.jpg`,
        })),
      );
    case "tvShow":
      return count(
        "tvShow.findMany",
        limited.map((id) => ({
          id,
          tmdbId: Number(id),
          nameOriginal: `S${id}`,
          firstAirDate: new Date(Date.UTC(2024, 0, 1)),
          lastAirDate: null,
          voteCountTmdb: 5_000,
          status: "Returning Series",
          numberOfSeasons: 1,
          numberOfEpisodes: 8,
          certification: null,
          screenScore: null,
          screenScoreScale: null,
          screenScoreDisplay: false,
          backdropPath: `/b-${id}.jpg`,
          posterPath: `/p-${id}.jpg`,
        })),
      );
    case "person":
      return count(
        "person.findMany",
        limited.map((id) => ({
          id,
          name: `P${id}`,
          knownForDepartment: "Acting",
          profilePath: `/pf-${id}.jpg`,
        })),
      );
    default:
      // Tabelas de apoio (curadoria, snapshot, calculo de nota, trailer...):
      // vazias. O que este arquivo mede e o volume do CATALOGO.
      return count(`${model}.${method}`, []);
  }
}

const fakePrisma = new Proxy(
  {},
  {
    get(_target, model: string | symbol) {
      if (typeof model === "symbol") return undefined;
      if (model === "$queryRawUnsafe") {
        return (sql: string, ...params: unknown[]) => {
          if (/count\(\*\)/.test(sql)) {
            return Promise.resolve(count("count(*)", [{ total: BigInt(CATALOG) }]));
          }
          const limit = limitOf(params, CATALOG);
          const rows = ids(Math.min(limit, CATALOG)).map((id) => ({
            id,
            tmdb_id: Number(id),
            title_original: `M${id}`,
            name_original: `S${id}`,
            name: `P${id}`,
            release_date: new Date(Date.UTC(2024, 0, 1)),
            first_air_date: new Date(Date.UTC(2024, 0, 1)),
            last_air_date: null,
            known_for_department: "Acting",
            poster_path: `/p-${id}.jpg`,
            backdrop_path: `/b-${id}.jpg`,
            profile_path: `/pf-${id}.jpg`,
            screen_score: null,
            screen_score_scale: null,
            screen_score_display: false,
            slug: `s-${id}`,
            translation_title: `T${id}`,
          }));
          return Promise.resolve(count("$queryRawUnsafe", rows));
        };
      }
      if (model.startsWith("$")) return () => Promise.resolve([]);
      return new Proxy(
        {},
        {
          get(_inner, method: string | symbol) {
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

const { getMovieIndexData, getPersonIndexData, getSeriesIndexData } = await import(
  "../entity-indexes"
);
const { loadHeroSlides } = await import("../home-hero");
const { getHomeUpcomingMovies, getHomeUpcomingSeries } = await import("../home-upcoming");

beforeEach(() => {
  reset();
});

describe(`orcamento de linhas por superficie publica (catalogo falso de ${CATALOG})`, () => {
  it("(1) CONTROLE: o fake DA o catalogo inteiro quando ninguem limita", async () => {
    // Sem este controle, "poucas linhas" seria indistinguivel de "o fake nunca
    // devolve nada" — e todas as asercoes abaixo passariam vazias.
    reset();
    await (fakePrisma as { slug: { findMany: (a: unknown) => Promise<unknown> } }).slug.findMany(
      {},
    );
    expect(rowsReturned).toBe(CATALOG);
  });

  it("(2) /pt/filmes: le a pagina, nao o catalogo", async () => {
    await getMovieIndexData();
    expect(rowsReturned, `maiores: ${topOffenders()}`).toBeGreaterThan(0);
    expect(rowsReturned, `maiores: ${topOffenders()}`).toBeLessThanOrEqual(ROW_BUDGET);
  });

  it("(3) /pt/series: le a pagina, nao o catalogo", async () => {
    await getSeriesIndexData();
    expect(rowsReturned, `maiores: ${topOffenders()}`).toBeGreaterThan(0);
    expect(rowsReturned, `maiores: ${topOffenders()}`).toBeLessThanOrEqual(ROW_BUDGET);
  });

  it("(4) /pt/pessoas: le a pagina, nao o catalogo", async () => {
    await getPersonIndexData();
    expect(rowsReturned, `maiores: ${topOffenders()}`).toBeGreaterThan(0);
    expect(rowsReturned, `maiores: ${topOffenders()}`).toBeLessThanOrEqual(ROW_BUDGET);
  });

  it("(5) hero da home: le candidatos, nao o catalogo", async () => {
    await loadHeroSlides(
      fakePrisma as unknown as Parameters<typeof loadHeroSlides>[0],
      "home",
      new Date(Date.UTC(2026, 7, 28)),
    );
    expect(rowsReturned, `maiores: ${topOffenders()}`).toBeLessThanOrEqual(ROW_BUDGET);
  });

  it('(6) trilho "Em breve": le candidatos, nao o catalogo', async () => {
    await getHomeUpcomingMovies();
    await getHomeUpcomingSeries();
    expect(rowsReturned, `maiores: ${topOffenders()}`).toBeLessThanOrEqual(ROW_BUDGET);
  });

  it("(7) `totalCount` da listagem vem do COUNT, nao do tamanho da pagina", async () => {
    // Sem isto, encolher a consulta faria `hasMore` dizer `false` numa listagem
    // com 40 mil filmes — a paginacao sumiria em silencio junto com o defeito.
    const { view } = await getMovieIndexData();
    expect(view.totalCount).toBe(CATALOG);
    expect(view.hasMore).toBe(true);
    expect(view.cards.length).toBeLessThanOrEqual(24);
  });
});
