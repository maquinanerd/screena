/**
 * Testes puros do presenter de "Noticias relacionadas" das paginas de detalhe.
 *
 * Reusa `buildNewsCard` (gate de publicacao/licenca/imagem ja testado em
 * news-presenter.test.ts); aqui focamos em: descarte de nao-publicaveis,
 * normalizacao de imagem, ordenacao por data desc, limite e omissao vazia.
 */

import { describe, expect, it } from "vitest";

import {
  buildRelatedNewsCards,
  RELATED_NEWS_LIMIT,
  type RelatedNewsItemInput,
} from "../../apps/web/src/lib/related-news-presenter";

function item(overrides: Partial<RelatedNewsItemInput> = {}): RelatedNewsItemInput {
  return {
    authorName: null,
    category: null,
    heroImagePath: null,
    articlePublishedAtIso: null,
    readTimeMinutes: null,
    licenseStatus: "official",
    displayAllowed: true,
    slug: "artigo",
    title: "Artigo",
    deck: null,
    indexStatus: "index",
    reviewStatus: "published",
    translationPublishedAtIso: "2026-06-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildRelatedNewsCards", () => {
  it("mantem publicavel e monta href para /pt/noticias/[slug]/", () => {
    const cards = buildRelatedNewsCards([item({ slug: "daredevil", title: "Daredevil" })]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.href).toBe("/pt/noticias/daredevil/");
  });

  it("descarta nao-publicaveis (draft, sem slug/titulo/data, display/licenca bloqueados)", () => {
    expect(buildRelatedNewsCards([item({ reviewStatus: "draft" })])).toEqual([]);
    expect(buildRelatedNewsCards([item({ slug: null })])).toEqual([]);
    expect(buildRelatedNewsCards([item({ title: "  " })])).toEqual([]);
    expect(
      buildRelatedNewsCards([item({ translationPublishedAtIso: null, articlePublishedAtIso: null })]),
    ).toEqual([]);
    expect(buildRelatedNewsCards([item({ displayAllowed: false })])).toEqual([]);
    expect(buildRelatedNewsCards([item({ licenseStatus: "unknown" })])).toEqual([]);
    expect(buildRelatedNewsCards([item({ licenseStatus: "blocked" })])).toEqual([]);
    expect(buildRelatedNewsCards([item({ indexStatus: "noindex" })])).toEqual([]);
  });

  it("imagem externa/tmdb/cru vira null; path local seguro e aceito", () => {
    expect(
      buildRelatedNewsCards([item({ heroImagePath: "http://example.com/x.jpg" })])[0]?.image,
    ).toBeNull();
    expect(
      buildRelatedNewsCards([item({ heroImagePath: "https://image.tmdb.org/x.jpg" })])[0]?.image,
    ).toBeNull();
    expect(buildRelatedNewsCards([item({ heroImagePath: "/abc.jpg" })])[0]?.image).toBeNull();
    expect(
      buildRelatedNewsCards([item({ heroImagePath: "/media/news/a.webp" })])[0]?.image?.src,
    ).toBe("/media/news/a.webp");
    expect(
      buildRelatedNewsCards([item({ heroImagePath: "/uploads/news/a.jpg" })])[0]?.image?.src,
    ).toBe("/uploads/news/a.jpg");
    expect(
      buildRelatedNewsCards([item({ heroImagePath: "/brand/news-a.png" })])[0]?.image?.src,
    ).toBe("/brand/news-a.png");
  });

  it("ordena por publishedAt desc (depois titulo)", () => {
    const cards = buildRelatedNewsCards([
      item({ slug: "a", title: "A", translationPublishedAtIso: "2026-06-10T00:00:00.000Z" }),
      item({ slug: "b", title: "B", translationPublishedAtIso: "2026-06-30T00:00:00.000Z" }),
      item({ slug: "c", title: "C", translationPublishedAtIso: "2026-06-20T00:00:00.000Z" }),
    ]);
    expect(cards.map((c) => c.title)).toEqual(["B", "C", "A"]);
  });

  it("respeita o limite de cards", () => {
    const many = Array.from({ length: RELATED_NEWS_LIMIT + 3 }, (_unused, i) =>
      item({ slug: `s-${i}`, title: `T${i}`, translationPublishedAtIso: `2026-06-${10 + i}T00:00:00.000Z` }),
    );
    expect(buildRelatedNewsCards(many)).toHaveLength(RELATED_NEWS_LIMIT);
  });

  it("lista vazia -> vazia (secao some)", () => {
    expect(buildRelatedNewsCards([])).toEqual([]);
  });
});
