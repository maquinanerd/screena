/**
 * showcase-relevance.test.ts — o portao de relevancia das VITRINES da home.
 *
 * Decisao do dono, 13/10/2026: a home so destaca titulo que esta no indice. O
 * predicado e o MESMO do sitemap (`DECISOES-DO-DONO-2026-09-24.md`): pais EUA ou
 * Brasil, 500+ votos no TMDB ou oferta de streaming no Brasil.
 *
 * Este arquivo mede o modulo; quem mede cada vitrine e o teste dela
 * (`home-ticker-scope`, `popular-rankings-queries`, `home-hero-selection`).
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  RELEVANCE_GATE_ANCHOR_COUNTRIES,
  RELEVANCE_GATE_MIN_TMDB_VOTES,
  RELEVANCE_GATE_OFFER_COUNTRY,
} from "@screena/config";

import { keepRelevant, relevanceSql, relevantTitleIds } from "../showcase-relevance";

type Prisma = Parameters<typeof relevantTitleIds>[0];

interface RawCall {
  sql: string;
  params: unknown[];
}

/** Banco falso: responde ao SQL do portao com os ids de `approved`. */
function fakePrisma(approved: ReadonlySet<string>, calls: RawCall[]): Prisma {
  return {
    $queryRawUnsafe: (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params });
      const type = sql.includes("FROM tv_shows") ? "tv" : "movie";
      const ids = (params[0] as string[]).filter((id) => approved.has(`${type}:${id}`));
      return Promise.resolve(ids.map((id) => ({ id: BigInt(id) })));
    },
  } as unknown as Prisma;
}

const previousGate = process.env.CINERIE_RELEVANCE_GATE;
afterEach(() => {
  if (previousGate === undefined) delete process.env.CINERIE_RELEVANCE_GATE;
  else process.env.CINERIE_RELEVANCE_GATE = previousGate;
});

describe("relevanceSql — o predicado como SQL posicional", () => {
  it("(1) numera a partir do que ja esta em `params` e usa os numeros de @screena/config", () => {
    const params: unknown[] = ["pt-BR", "2026-10-13"];
    const sql = relevanceSql("movie", "m", params);

    expect(params).toEqual([
      "pt-BR",
      "2026-10-13",
      RELEVANCE_GATE_MIN_TMDB_VOTES,
      [...RELEVANCE_GATE_ANCHOR_COUNTRIES],
      RELEVANCE_GATE_OFFER_COUNTRY,
    ]);
    expect(sql).toContain("COALESCE(m.vote_count_tmdb, 0) >= $3");
    expect(sql).toContain("rc.movie_id = m.id AND rc.country_code = ANY($4)");
    expect(sql).toContain("rw.entity_id = m.id");
    expect(sql).toContain("rw.country_code = $5");
    // Nenhum numero de regra escrito no texto: vem tudo por parametro.
    expect(sql).not.toContain("500");
    expect(sql).not.toContain("'US'");
  });

  it("(2) serie le a tabela de pais de ORIGEM, com o tipo da oferta certo", () => {
    const sql = relevanceSql("tv", "t", []);
    expect(sql).toContain("tv_show_origin_countries rc");
    expect(sql).toContain("rc.tv_show_id = t.id");
    expect(sql).toContain(`rw.entity_type = 'tv'::"EntityType"`);
    expect(sql).not.toContain("movie_production_countries");
  });

  it("(3) a chave de EMERGENCIA devolve TRUE e nao gasta parametro", () => {
    process.env.CINERIE_RELEVANCE_GATE = "off";
    const params: unknown[] = ["x"];
    expect(relevanceSql("movie", "m", params)).toBe("TRUE");
    expect(params).toEqual(["x"]);
  });
});

describe("relevantTitleIds / keepRelevant — filtro de lista curta", () => {
  it("(4) devolve so os aprovados, com o teto igual ao tamanho da lista", async () => {
    const calls: RawCall[] = [];
    const prisma = fakePrisma(new Set(["movie:1", "movie:3"]), calls);

    const ids = await relevantTitleIds(prisma, "movie", [1n, 2n, 3n, 2n]);

    expect([...ids].sort()).toEqual(["1", "3"]);
    expect(calls).toHaveLength(1);
    // Duplicata nao vira parametro duas vezes, e o LIMIT e o ultimo parametro.
    expect(calls[0]?.params[0]).toEqual(["1", "2", "3"]);
    expect(calls[0]?.params.at(-1)).toBe(3);
    // ids ($1), votos ($2), paises ($3), pais da oferta ($4) e o teto ($5).
    expect(calls[0]?.params).toHaveLength(5);
    expect(calls[0]?.sql).toMatch(/LIMIT \$5\b/);
    expect(calls[0]?.sql).toContain("e.id = ANY($1::bigint[])");
  });

  it("(5) lista vazia nao consulta o banco", async () => {
    const calls: RawCall[] = [];
    expect(await relevantTitleIds(fakePrisma(new Set(), calls), "tv", [])).toEqual(new Set());
    expect(calls).toEqual([]);
  });

  it("(6) com a chave de emergencia, todos passam e o banco nao e consultado", async () => {
    process.env.CINERIE_RELEVANCE_GATE = "off";
    const calls: RawCall[] = [];
    const ids = await relevantTitleIds(fakePrisma(new Set(), calls), "movie", [7n, 8n]);
    expect([...ids].sort()).toEqual(["7", "8"]);
    expect(calls).toEqual([]);
  });

  it("(7) keepRelevant preserva a ORDEM recebida e separa filme de serie pelo tipo", async () => {
    const calls: RawCall[] = [];
    // Mesmo id numerico nos dois tipos: as sequencias sao independentes.
    const prisma = fakePrisma(new Set(["tv:5", "movie:9", "movie:1"]), calls);
    const kept = await keepRelevant(prisma, [
      { entityType: "movie", entityId: 9n },
      { entityType: "movie", entityId: 5n },
      { entityType: "tv", entityId: 5n },
      { entityType: "movie", entityId: 1n },
    ]);
    expect(kept).toEqual([
      { entityType: "movie", entityId: 9n },
      { entityType: "tv", entityId: 5n },
      { entityType: "movie", entityId: 1n },
    ]);
    expect(calls).toHaveLength(2);
  });
});
