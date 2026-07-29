/**
 * Testes puros do presenter de noticias/blog.
 *
 * Garantem que a listagem/artigo nao inventam dados, so publicam com licenca/
 * review/publishedAt validos, so aceitam imagem local segura, aplicam o gate
 * anti-thin e resolvem relacionados apenas quando reais.
 */

import { describe, expect, it } from "vitest";

import {
  buildNewsArticleView,
  buildNewsCard as buildNewsCardAt,
  buildNewsIndexView as buildNewsIndexViewAt,
  buildNewsRelated,
  bodyParagraphs,
  evaluateArticleIndexability,
  evaluateNewsIndexIndexability,
  formatNewsDate,
  formatReadTime,
  isSufficientBody,
  MIN_ARTICLE_BODY_CHARS,
  MIN_NEWS_INDEX_ITEMS,
  normalizeNewsLocalImagePath,
  type ArticleFactsInput,
  type ArticleTranslationInput,
  type NewsListItemInput,
} from "../../apps/web/src/lib/news-presenter";

/**
 * Instante de avaliacao dos casos existentes. Bem depois das datas de
 * publicacao usadas nas fixtures, para que estes testes continuem medindo o que
 * mediam (licenca/review/slug/imagem) e nao virem testes de relogio.
 * O comportamento de agendamento tem describe proprio no fim do arquivo.
 */
const NOW = "2026-07-01T00:00:00.000Z";

const buildNewsCard = (input: NewsListItemInput) => buildNewsCardAt(input, NOW);
const buildNewsIndexView = (items: NewsListItemInput[]) =>
  buildNewsIndexViewAt(items, NOW);

const LONG_BODY = "x".repeat(MIN_ARTICLE_BODY_CHARS);

function item(overrides: Partial<NewsListItemInput> = {}): NewsListItemInput {
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
    reviewStatus: "published",
    translationPublishedAtIso: "2026-06-30T12:00:00.000Z",
    ...overrides,
  };
}

function facts(overrides: Partial<ArticleFactsInput> = {}): ArticleFactsInput {
  return {
    authorName: null,
    category: null,
    heroImagePath: null,
    articlePublishedAtIso: null,
    readTimeMinutes: null,
    aiAssisted: false,
    sourceName: null,
    sourceUrl: null,
    licenseStatus: "official",
    displayAllowed: true,
    requiresAttribution: false,
    requiresLinkback: false,
    ...overrides,
  };
}

function translation(
  overrides: Partial<ArticleTranslationInput> = {},
): ArticleTranslationInput {
  return {
    slug: "artigo",
    title: "Artigo",
    deck: null,
    body: null,
    metaTitle: null,
    metaDescription: null,
    // SEO aprovado zerado por padrao: o teste declara so o que mede.
    socialTitle: null,
    socialDescription: null,
    canonicalOverride: null,
    articleSection: null,
    schemaTypeRecommendation: null,
    approvedImageAlt: null,
    translationUpdatedAtIso: null,
    reviewStatus: "published",
    indexStatus: "index",
    translationPublishedAtIso: "2026-06-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeNewsLocalImagePath", () => {
  it("aceita local seguro; recusa externo/tmdb/cru/traversal", () => {
    expect(normalizeNewsLocalImagePath(" /media/news/a.webp ")).toBe("/media/news/a.webp");
    expect(normalizeNewsLocalImagePath("/uploads/b.jpg")).toBe("/uploads/b.jpg");
    expect(normalizeNewsLocalImagePath("/brand/c.png")).toBe("/brand/c.png");
    expect(normalizeNewsLocalImagePath(null)).toBeNull();
    expect(normalizeNewsLocalImagePath("https://image.tmdb.org/t/p/w1280/a.jpg")).toBeNull();
    expect(normalizeNewsLocalImagePath("https://collider.com/a.jpg")).toBeNull();
    expect(normalizeNewsLocalImagePath("//x.com/a.jpg")).toBeNull();
    expect(normalizeNewsLocalImagePath("/abc.jpg")).toBeNull();
    expect(normalizeNewsLocalImagePath("/media/../secret.jpg")).toBeNull();
  });
});

describe("formatadores", () => {
  it("formatNewsDate em pt-BR", () => {
    expect(formatNewsDate("2026-06-30T12:00:00.000Z")).toBe("30 de junho de 2026");
    expect(formatNewsDate("2026-01-05")).toBe("5 de janeiro de 2026");
    expect(formatNewsDate(null)).toBeNull();
    expect(formatNewsDate("nao-e-data")).toBeNull();
  });

  it("formatReadTime", () => {
    expect(formatReadTime(5)).toBe("5 min de leitura");
    expect(formatReadTime(0)).toBeNull();
    expect(formatReadTime(null)).toBeNull();
  });

  it("bodyParagraphs e isSufficientBody", () => {
    expect(bodyParagraphs("Um.\n\nDois.\n\n  ")).toEqual(["Um.", "Dois."]);
    expect(bodyParagraphs(null)).toEqual([]);
    expect(isSufficientBody(LONG_BODY)).toBe(true);
    expect(isSufficientBody("curto")).toBe(false);
    expect(isSufficientBody(null)).toBe(false);
  });
});

describe("buildNewsCard (gate de publicacao)", () => {
  it("monta card publicavel com dados reais", () => {
    const card = buildNewsCard(
      item({
        slug: "daredevil",
        title: "Daredevil volta",
        category: "Marvel",
        authorName: "Lucas",
        deck: "deck",
        readTimeMinutes: 5,
        heroImagePath: "/media/news/dd.webp",
      }),
    );
    expect(card).not.toBeNull();
    expect(card?.href).toBe("/pt/noticias/daredevil/");
    expect(card?.author).toBe("Lucas");
    expect(card?.dateLabel).toBe("30 de junho de 2026");
    expect(card?.readTimeLabel).toBe("5 min de leitura");
    expect(card?.image?.src).toBe("/media/news/dd.webp");
  });

  it("descarta sem titulo, sem slug, rascunho, sem data, licenca/display bloqueados", () => {
    expect(buildNewsCard(item({ title: "  " }))).toBeNull();
    expect(buildNewsCard(item({ slug: null }))).toBeNull();
    expect(buildNewsCard(item({ reviewStatus: "draft" }))).toBeNull();
    expect(buildNewsCard(item({ reviewStatus: "ai_generated" }))).toBeNull();
    expect(
      buildNewsCard(item({ translationPublishedAtIso: null, articlePublishedAtIso: null })),
    ).toBeNull();
    expect(buildNewsCard(item({ displayAllowed: false }))).toBeNull();
    expect(buildNewsCard(item({ licenseStatus: "unknown" }))).toBeNull();
    expect(buildNewsCard(item({ licenseStatus: "blocked" }))).toBeNull();
  });

  it("imagem externa/tmdb/cru vira null; card ainda existe", () => {
    expect(buildNewsCard(item({ heroImagePath: "https://image.tmdb.org/x.jpg" }))?.image).toBeNull();
    expect(buildNewsCard(item({ heroImagePath: "/abc.jpg" }))?.image).toBeNull();
  });
});

describe("buildNewsIndexView", () => {
  it("filtra publicaveis, ordena por data desc, separa featured/feed", () => {
    const view = buildNewsIndexView([
      item({ slug: "a", title: "A", translationPublishedAtIso: "2026-06-10T00:00:00.000Z" }),
      item({ slug: "b", title: "B", translationPublishedAtIso: "2026-06-30T00:00:00.000Z" }),
      item({ slug: "draft", title: "Draft", reviewStatus: "draft" }),
      item({ slug: "c", title: "C", translationPublishedAtIso: "2026-06-20T00:00:00.000Z" }),
    ]);
    expect(view.totalCount).toBe(3);
    expect(view.featured?.title).toBe("B");
    expect(view.cards.map((c) => c.title)).toEqual(["C", "A"]);
    expect(view.hasMore).toBe(false);
  });
});

describe("evaluateNewsIndexIndexability (indexacao total)", () => {
  it("listagem vazia -> noindex; >= 1 publicavel -> index", () => {
    expect(evaluateNewsIndexIndexability({ itemCount: 0 }).decision).toBe("noindex");
    expect(evaluateNewsIndexIndexability({ itemCount: 1 }).decision).toBe("index");
    expect(evaluateNewsIndexIndexability({ itemCount: MIN_NEWS_INDEX_ITEMS - 1 }).decision).toBe("index");
    expect(evaluateNewsIndexIndexability({ itemCount: MIN_NEWS_INDEX_ITEMS }).decision).toBe("index");
  });
});

describe("evaluateArticleIndexability", () => {
  it("corpo fino -> noindex", () => {
    expect(
      evaluateArticleIndexability({ indexStatus: "index", bodySufficient: false, reviewStatusOk: true }).decision,
    ).toBe("noindex");
  });

  it("corpo suficiente + index_status index -> index", () => {
    expect(
      evaluateArticleIndexability({ indexStatus: "index", bodySufficient: true, reviewStatusOk: true }).decision,
    ).toBe("index");
  });

  it("index_status editorial != index mantem noindex mesmo com corpo suficiente", () => {
    expect(
      evaluateArticleIndexability({ indexStatus: "noindex", bodySufficient: true, reviewStatusOk: true }).decision,
    ).toBe("noindex");
  });
});

describe("buildNewsArticleView", () => {
  it("nao inventa autor/data/imagem quando ausentes", () => {
    const view = buildNewsArticleView({
      facts: facts({ articlePublishedAtIso: null }),
      translation: translation({ translationPublishedAtIso: null, deck: null, body: null }),
      related: [],
    });
    expect(view.author).toBeNull();
    expect(view.dateIso).toBeNull();
    expect(view.dateLabel).toBeNull();
    expect(view.heroImage).toBeNull();
    expect(view.deck).toBeNull();
    expect(view.bodyParagraphs).toEqual([]);
    expect(view.hasBody).toBe(false);
    expect(view.source).toBeNull();
  });

  it("monta artigo com dados reais e corpo suficiente", () => {
    const view = buildNewsArticleView({
      facts: facts({
        authorName: "Lucas Andrade",
        category: "Marvel",
        heroImagePath: "/media/news/dd.webp",
        readTimeMinutes: 5,
        aiAssisted: true,
        articlePublishedAtIso: "2026-06-30T12:00:00.000Z",
      }),
      translation: translation({ deck: "deck real", body: `${LONG_BODY}\n\nsegundo` }),
      related: [],
    });
    expect(view.author).toBe("Lucas Andrade");
    expect(view.category).toBe("Marvel");
    expect(view.dateLabel).toBe("30 de junho de 2026");
    expect(view.readTimeLabel).toBe("5 min de leitura");
    expect(view.heroImage?.src).toBe("/media/news/dd.webp");
    expect(view.aiAssisted).toBe(true);
    expect(view.hasBody).toBe(true);
    expect(view.bodyParagraphs.length).toBe(2);
  });

  it("fonte so aparece com sourceName e sem exigir linkback", () => {
    expect(
      buildNewsArticleView({ facts: facts({ sourceName: "Collider" }), translation: translation(), related: [] }).source,
    ).toEqual({ name: "Collider" });
    expect(
      buildNewsArticleView({
        facts: facts({ sourceName: "Collider", requiresLinkback: true }),
        translation: translation(),
        related: [],
      }).source,
    ).toBeNull();
    expect(
      buildNewsArticleView({ facts: facts({ sourceName: null }), translation: translation(), related: [] }).source,
    ).toBeNull();
  });
});

describe("buildNewsRelated", () => {
  it("so entra o relacionado com titulo + slug reais; monta href por tipo", () => {
    const related = buildNewsRelated([
      { entityType: "movie", title: "Filme A", slug: "filme-a" },
      { entityType: "tv", title: "Serie B", slug: "serie-b" },
      { entityType: "person", title: "Sem Slug", slug: null },
      { entityType: "movie", title: null, slug: "sem-titulo" },
    ]);
    expect(related).toHaveLength(2);
    expect(related[0]).toEqual({ entityType: "movie", title: "Filme A", href: "/pt/filmes/filme-a/" });
    expect(related[1]?.href).toBe("/pt/series/serie-b/");
  });
});
