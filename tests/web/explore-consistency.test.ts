/**
 * explore-consistency.test.ts — Prova que a PAGINA `/pt/explorar/` e o SITEMAP
 * decidem a indexabilidade do explorar de forma IDENTICA (Prompt 3 §3).
 *
 * Antes desta fase a pagina decidia so pelos lancamentos da semana e o sitemap
 * pelo catalogo amplo — divergencia. Agora ambos derivam da MESMA funcao
 * (`evaluateExploreIndexability`) com as MESMAS contagens
 * (`countExploreSectionFacts`). Este teste trava esse contrato: para qualquer
 * snapshot, "explorar no sitemap" <=> "pagina decide index".
 */

import { describe, expect, it } from "vitest";

import {
  buildSitemapEntries,
  countExploreSectionFacts,
  type SitemapDataInput,
  type SitemapEntityCandidate,
  type SitemapNewsCandidate,
} from "../../apps/web/src/lib/sitemap-presenter";
import { evaluateExploreIndexability } from "../../apps/web/src/lib/explore-presenter";

const ORIGIN = "https://thescreen.media";
const EXPLORE_URL = `${ORIGIN}/pt/explorar/`;

function entity(
  overrides: Partial<SitemapEntityCandidate> = {},
): SitemapEntityCandidate {
  return {
    slug: "slug-valido",
    title: "Titulo Valido",
    renderableBlockCount: 2,
    updatedAtIso: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

function news(overrides: Partial<SitemapNewsCandidate> = {}): SitemapNewsCandidate {
  return {
    slug: "noticia-valida",
    title: "Noticia Valida",
    reviewStatus: "published",
    licenseStatus: "official",
    displayAllowed: true,
    indexStatus: "index",
    body: "x".repeat(300),
    translationPublishedAtIso: "2026-07-01T10:00:00.000Z",
    articlePublishedAtIso: null,
    updatedAtIso: "2026-07-01T11:00:00.000Z",
    ...overrides,
  };
}

/** Inclui /pt/explorar/ no sitemap? (lado sitemap) */
function exploreInSitemap(input: SitemapDataInput): boolean {
  return buildSitemapEntries(input)
    .map((entry) => entry.url)
    .includes(EXPLORE_URL);
}

/** A pagina decidiria index? (lado pagina — mesma funcao/contagens) */
function explorePageIndexes(input: SitemapDataInput): boolean {
  return (
    evaluateExploreIndexability(countExploreSectionFacts(input)).decision ===
    "index"
  );
}

describe("explorar: pagina e sitemap concordam", () => {
  const scenarios: Array<{ name: string; input: SitemapDataInput }> = [
    { name: "tudo vazio", input: { movies: [], series: [], people: [], news: [] } },
    {
      name: "so pessoas",
      input: {
        movies: [],
        series: [],
        people: [entity({ slug: "p1" })],
        news: [],
      },
    },
    {
      name: "so noticias publicaveis",
      input: { movies: [], series: [], people: [], news: [news({ slug: "n1" })] },
    },
    {
      name: "catalogo rico",
      input: {
        movies: [entity({ slug: "m1" })],
        series: [entity({ slug: "s1" })],
        people: [entity({ slug: "p1" })],
        news: [news({ slug: "n1" })],
      },
    },
    {
      name: "item invalido (sem slug) nao conta",
      input: {
        movies: [entity({ slug: null })],
        series: [],
        people: [],
        news: [],
      },
    },
  ];

  for (const scenario of scenarios) {
    it(`[${scenario.name}] sitemap-inclui <=> pagina-indexa`, () => {
      expect(exploreInSitemap(scenario.input)).toBe(
        explorePageIndexes(scenario.input),
      );
    });
  }

  it("catalogo vazio: explorar fica FORA do sitemap e a pagina NAO indexa", () => {
    const empty: SitemapDataInput = { movies: [], series: [], people: [], news: [] };
    expect(exploreInSitemap(empty)).toBe(false);
    expect(explorePageIndexes(empty)).toBe(false);
  });
});
