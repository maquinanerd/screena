/**
 * sitemap-xml.test.ts — Renderizacao PURA de XML de sitemap (Fase 3, §5/§11).
 * Garante urlset/sitemapindex validos, escape de `&`/`<`/`>` e omissao de
 * campos ausentes.
 */

import { describe, expect, it } from "vitest";

import {
  escapeXml,
  renderSitemapIndex,
  renderUrlset,
  SITEMAP_CONTENT_TYPE,
} from "./sitemap-xml.js";

describe("escapeXml", () => {
  it("escapa & < > \" '", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
});

describe("renderUrlset", () => {
  it("gera urlset valido com loc/lastmod/changefreq/priority", () => {
    const xml = renderUrlset([
      {
        loc: "https://cinerie.com/pt/filmes/x/",
        lastmod: "2026-07-10T00:00:00.000Z",
        changefreq: "monthly",
        priority: 0.5,
      },
    ]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml).toContain("<loc>https://cinerie.com/pt/filmes/x/</loc>");
    expect(xml).toContain("<lastmod>2026-07-10T00:00:00.000Z</lastmod>");
    expect(xml).toContain("<changefreq>monthly</changefreq>");
    expect(xml).toContain("<priority>0.5</priority>");
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("escapa & na loc (nunca XML cru quebrado)", () => {
    const xml = renderUrlset([
      { loc: "https://cinerie.com/pt/filmes/a&b/" },
    ]);
    expect(xml).toContain(
      "<loc>https://cinerie.com/pt/filmes/a&amp;b/</loc>",
    );
    expect(xml).not.toContain("a&b<");
  });

  it("omite lastmod/changefreq/priority quando ausentes", () => {
    const xml = renderUrlset([{ loc: "https://cinerie.com/pt/" }]);
    expect(xml).not.toContain("<lastmod>");
    expect(xml).not.toContain("<changefreq>");
    expect(xml).not.toContain("<priority>");
  });

  it("urlset vazio ainda e XML valido", () => {
    const xml = renderUrlset([]);
    expect(xml).toContain("<urlset");
    expect(xml).toContain("</urlset>");
  });
});

describe("renderSitemapIndex", () => {
  it("gera sitemapindex apontando para shards", () => {
    const xml = renderSitemapIndex([
      {
        loc: "https://cinerie.com/sitemaps/sitemap-pt-BR-movies-0.xml",
        lastmod: "2026-07-10T00:00:00.000Z",
      },
    ]);
    expect(xml).toContain(
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml).toContain(
      "<loc>https://cinerie.com/sitemaps/sitemap-pt-BR-movies-0.xml</loc>",
    );
    expect(xml).toContain("<lastmod>2026-07-10T00:00:00.000Z</lastmod>");
    expect(xml.trimEnd().endsWith("</sitemapindex>")).toBe(true);
  });
});

describe("SITEMAP_CONTENT_TYPE", () => {
  it("e application/xml", () => {
    expect(SITEMAP_CONTENT_TYPE).toContain("application/xml");
  });
});
