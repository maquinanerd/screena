/**
 * sitemap-plan.test.ts — Arquitetura escalavel de sitemap (Prompt 3 §5):
 * shards por (idioma, tipo), paginacao por `maxPerShard`, `lastmod` = maior data
 * confiavel, e sitemap-index apontando para cada shard.
 */

import { describe, expect, it } from "vitest";

import {
  buildSitemapIndex,
  planSitemapShards,
  type SitemapUrl,
} from "./sitemap-plan.js";

function url(loc: string, type: string, lastmod: string | null = null): SitemapUrl {
  return { loc, language: "pt-BR", type, lastmod };
}

describe("planSitemapShards", () => {
  it("lista vazia -> nenhum shard", () => {
    expect(planSitemapShards([])).toEqual([]);
  });

  it("separa por tipo mantendo ordem de primeira aparicao", () => {
    const shards = planSitemapShards([
      url("/pt/filmes/a/", "movies"),
      url("/pt/series/b/", "series"),
      url("/pt/filmes/c/", "movies"),
    ]);
    expect(shards.map((s) => s.type)).toEqual(["movies", "series"]);
    expect(shards[0]?.urls.map((u) => u.loc)).toEqual([
      "/pt/filmes/a/",
      "/pt/filmes/c/",
    ]);
  });

  it("pagina cada grupo por maxPerShard", () => {
    const urls = Array.from({ length: 5 }, (_, i) => url(`/pt/filmes/${i}/`, "movies"));
    const shards = planSitemapShards(urls, { maxPerShard: 2 });
    expect(shards.map((s) => s.page)).toEqual([0, 1, 2]);
    expect(shards.map((s) => s.urls.length)).toEqual([2, 2, 1]);
    expect(shards.map((s) => s.id)).toEqual([
      "sitemap-pt-BR-movies-0",
      "sitemap-pt-BR-movies-1",
      "sitemap-pt-BR-movies-2",
    ]);
  });

  it("lastmod do shard = maior data confiavel; null se nenhuma", () => {
    const withDates = planSitemapShards([
      url("/pt/filmes/a/", "movies", "2026-07-01T00:00:00.000Z"),
      url("/pt/filmes/b/", "movies", "2026-07-10T00:00:00.000Z"),
    ]);
    expect(withDates[0]?.lastmod).toBe("2026-07-10T00:00:00.000Z");

    const noDates = planSitemapShards([url("/pt/filmes/a/", "movies", null)]);
    expect(noDates[0]?.lastmod).toBeNull();
  });

  it("separa por idioma quando ha mais de um publicado", () => {
    const shards = planSitemapShards([
      { loc: "/pt/filmes/a/", language: "pt-BR", type: "movies", lastmod: null },
      { loc: "/en/movies/a/", language: "en", type: "movies", lastmod: null },
    ]);
    expect(shards.map((s) => s.language)).toEqual(["pt-BR", "en"]);
  });
});

describe("buildSitemapIndex", () => {
  it("mapeia cada shard para uma entrada do index com sua loc e lastmod", () => {
    const shards = planSitemapShards(
      [url("/pt/filmes/a/", "movies", "2026-07-10T00:00:00.000Z")],
      { maxPerShard: 50 },
    );
    const index = buildSitemapIndex(
      shards,
      (shard) => `https://cinerie.com/sitemaps/${shard.id}.xml`,
    );
    expect(index).toEqual([
      {
        loc: "https://cinerie.com/sitemaps/sitemap-pt-BR-movies-0.xml",
        lastmod: "2026-07-10T00:00:00.000Z",
      },
    ]);
  });
});
