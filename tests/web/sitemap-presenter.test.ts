/**
 * Testes puros do presenter do sitemap publico.
 *
 * Garantem que o sitemap: usa somente o dominio canonico cinerie.com com
 * barra final; no caminho com banco, inclui as rotas estaticas apenas quando
 * as paginas correspondentes seriam `index` (sitemap e meta robots nao devem
 * discordar);
 * inclui detalhes so quando o evaluator da propria pagina da `index`; exclui
 * item sem slug/titulo, noticia nao publicavel/noindex e URL duplicada; nunca
 * emite /en, /es, /admin, /dev ou /api; e tem fallback estatico seguro para
 * build/outage sem banco.
 */

import { describe, expect, it } from "vitest";

import {
  buildSitemapEntries,
  buildStaticSitemapEntries,
  type SitemapDataInput,
  type SitemapEntityCandidate,
  type SitemapNewsCandidate,
} from "../../apps/web/src/lib/sitemap-presenter";

const ORIGIN = "https://cinerie.com";

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

function news(
  overrides: Partial<SitemapNewsCandidate> = {},
): SitemapNewsCandidate {
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

/** Instante bem depois das datas das fixtures (materia agendada tem teste proprio). */
const NOW = "2026-07-02T00:00:00.000Z";

/** Snapshot rico: listagens e portais indexaveis + detalhes validos. */
function richInput(): SitemapDataInput {
  const movies = ["filme-a", "filme-b", "filme-c"].map((slug) =>
    entity({ slug }),
  );
  const series = ["serie-a", "serie-b", "serie-c"].map((slug) =>
    entity({ slug }),
  );
  const people = ["pessoa-a", "pessoa-b", "pessoa-c"].map((slug) =>
    entity({ slug }),
  );
  const newsItems = ["not-a", "not-b", "not-c"].map((slug) => news({ slug }));
  return { movies, series, people, news: newsItems, nowIso: NOW };
}

function urls(input: SitemapDataInput): string[] {
  return buildSitemapEntries(input).map((entry) => entry.url);
}

describe("buildSitemapEntries — rotas estaticas e dominio", () => {
  it("com dados suficientes inclui home, listagens, noticias e explorar", () => {
    const out = urls(richInput());
    expect(out).toContain(`${ORIGIN}/pt/`);
    expect(out).toContain(`${ORIGIN}/pt/filmes/`);
    expect(out).toContain(`${ORIGIN}/pt/series/`);
    expect(out).toContain(`${ORIGIN}/pt/pessoas/`);
    expect(out).toContain(`${ORIGIN}/pt/noticias/`);
    expect(out).toContain(`${ORIGIN}/pt/explorar/`);
  });

  it("toda URL e do dominio canonico, pt-BR e com barra final", () => {
    for (const url of urls(richInput())) {
      expect(url.startsWith(`${ORIGIN}/pt/`)).toBe(true);
      expect(url.endsWith("/")).toBe(true);
    }
  });

  it("nunca emite /en, /es, /admin, /dev ou /api", () => {
    const out = urls(richInput());
    for (const url of out) {
      expect(url).not.toMatch(/\/(en|es|admin|dev|api)\//);
    }
  });

  it("nao gera URL duplicada", () => {
    const input = richInput();
    // Forca candidatos duplicados do mesmo slug.
    input.movies.push(entity({ slug: "filme-a" }));
    const out = urls(input);
    expect(new Set(out).size).toBe(out.length);
  });
});

describe("buildSitemapEntries — gates de listagem e portal (indexacao total)", () => {
  it("listagem entra com >= 1 item valido; listagem vazia fica fora", () => {
    const input = richInput();
    input.series = [entity({ slug: "serie-a" }), entity({ slug: "serie-b" })];
    const out = urls(input);
    // Indexacao total: 2 itens ja bastam para a listagem entrar.
    expect(out).toContain(`${ORIGIN}/pt/series/`);
    expect(out).toContain(`${ORIGIN}/pt/series/serie-a/`);

    const empty = richInput();
    empty.series = [];
    expect(urls(empty)).not.toContain(`${ORIGIN}/pt/series/`);
  });

  it("home/explorar entram com >= 1 secao real; portal vazio fica fora", () => {
    const empty: SitemapDataInput = {
      movies: [],
      series: [],
      people: [],
      news: [],
      nowIso: NOW,
    };
    const emptyOut = urls(empty);
    expect(emptyOut).not.toContain(`${ORIGIN}/pt/`);
    expect(emptyOut).not.toContain(`${ORIGIN}/pt/explorar/`);

    const onlyMovies: SitemapDataInput = {
      movies: richInput().movies,
      series: [],
      people: [],
      news: [],
      nowIso: NOW,
    };
    const out = urls(onlyMovies);
    expect(out).toContain(`${ORIGIN}/pt/`);
    expect(out).toContain(`${ORIGIN}/pt/explorar/`);
  });

  it("home ignora pessoas; explorar conta pessoas (secoes reais de cada portal)", () => {
    const onlyPeople: SitemapDataInput = {
      movies: [],
      series: [],
      people: [entity({ slug: "pessoa-a" })],
      news: [],
      nowIso: NOW,
    };
    const out = urls(onlyPeople);
    // Home nao renderiza pessoas: 0 secoes -> fora. Explore conta pessoas: entra.
    expect(out).not.toContain(`${ORIGIN}/pt/`);
    expect(out).toContain(`${ORIGIN}/pt/explorar/`);
  });

  it("listagem de noticias entra com >= 1 publicavel; vazia fica fora", () => {
    const input = richInput();
    input.news = [news({ slug: "not-a" }), news({ slug: "not-b" })];
    const out = urls(input);
    expect(out).toContain(`${ORIGIN}/pt/noticias/`);
    expect(out).toContain(`${ORIGIN}/pt/noticias/not-a/`);

    const empty = richInput();
    empty.news = [];
    expect(urls(empty)).not.toContain(`${ORIGIN}/pt/noticias/`);
  });

  it("listagem de noticias conta publicaveis, nao detalhes indexaveis", () => {
    const input = richInput();
    input.news = [
      news({ slug: "not-a", indexStatus: "noindex", body: "curto" }),
      news({ slug: "not-b", indexStatus: "noindex", body: "curto" }),
      news({ slug: "not-c", indexStatus: "noindex", body: "curto" }),
    ];
    const out = urls(input);
    expect(out).toContain(`${ORIGIN}/pt/noticias/`);
    expect(out).not.toContain(`${ORIGIN}/pt/noticias/not-a/`);
    expect(out).not.toContain(`${ORIGIN}/pt/noticias/not-b/`);
    expect(out).not.toContain(`${ORIGIN}/pt/noticias/not-c/`);
  });
});

describe("buildSitemapEntries — detalhes de entidade", () => {
  it("inclui detalhe de entidade mesmo com poucos blocos (indexacao total)", () => {
    const input = richInput();
    input.movies.push(entity({ slug: "filme-fino", renderableBlockCount: 1 }));
    const out = urls(input);
    expect(out).toContain(`${ORIGIN}/pt/filmes/filme-a/`);
    // Antes excluido por anti-thin; agora entra (a ficha crua ja basta).
    expect(out).toContain(`${ORIGIN}/pt/filmes/filme-fino/`);
  });

  it("exclui item sem slug ou sem titulo", () => {
    const input = richInput();
    input.movies.push(entity({ slug: null }));
    input.movies.push(entity({ slug: "sem-titulo", title: null }));
    input.movies.push(entity({ slug: "titulo-vazio", title: "   " }));
    const out = urls(input);
    expect(out).not.toContain(`${ORIGIN}/pt/filmes/sem-titulo/`);
    expect(out).not.toContain(`${ORIGIN}/pt/filmes/titulo-vazio/`);
  });

  it("exclui slug invalido (path traversal / URL)", () => {
    const input = richInput();
    input.movies.push(entity({ slug: "a/b" }));
    input.movies.push(entity({ slug: ".." }));
    const out = urls(input);
    for (const url of out) {
      expect(url).not.toContain("a/b/");
      expect(url).not.toContain("../");
    }
  });

  it("lastModified vem do updatedAt confiavel; sem campo, e omitido (null)", () => {
    const input: SitemapDataInput = {
      movies: [
        entity({ slug: "com-data", updatedAtIso: "2026-06-30T00:00:00.000Z" }),
        entity({ slug: "sem-data", updatedAtIso: null }),
        entity({ slug: "terceiro" }),
      ],
      series: [entity({ slug: "serie-a" })],
      people: [],
      news: [],
      nowIso: NOW,
    };
    const entries = buildSitemapEntries(input);
    const withDate = entries.find((entry) => entry.url.includes("/com-data/"));
    const withoutDate = entries.find((entry) => entry.url.includes("/sem-data/"));
    expect(withDate?.lastModifiedIso).toBe("2026-06-30T00:00:00.000Z");
    expect(withoutDate?.lastModifiedIso).toBeNull();
  });

  it("prioridade de detalhe e menor que a das listagens/home", () => {
    const entries = buildSitemapEntries(richInput());
    const home = entries.find((entry) => entry.url === `${ORIGIN}/pt/`);
    const listing = entries.find(
      (entry) => entry.url === `${ORIGIN}/pt/filmes/`,
    );
    const detail = entries.find(
      (entry) => entry.url === `${ORIGIN}/pt/filmes/filme-a/`,
    );
    expect(home).toBeDefined();
    expect(listing).toBeDefined();
    expect(detail).toBeDefined();
    expect(detail!.priority).toBeLessThan(listing!.priority);
    expect(listing!.priority).toBeLessThanOrEqual(home!.priority);
  });
});

describe("buildSitemapEntries — noticias nao publicaveis ficam fora", () => {
  const cases: Array<[string, Partial<SitemapNewsCandidate>]> = [
    ["display_allowed = false", { displayAllowed: false }],
    ["licenca unknown", { licenseStatus: "unknown" }],
    ["licenca blocked", { licenseStatus: "blocked" }],
    ["review em rascunho", { reviewStatus: "draft" }],
    ["review ai_generated", { reviewStatus: "ai_generated" }],
    ["sem data de publicacao", { translationPublishedAtIso: null, articlePublishedAtIso: null }],
    ["decisao editorial noindex", { indexStatus: "noindex" }],
    ["corpo insuficiente (thin)", { body: "curto" }],
    ["sem slug", { slug: null }],
    ["sem titulo", { title: "  " }],
  ];

  for (const [label, overrides] of cases) {
    it(`exclui noticia com ${label}`, () => {
      const input = richInput();
      input.news.push(news({ slug: "nao-publicavel", ...overrides }));
      const out = urls(input);
      expect(out).not.toContain(`${ORIGIN}/pt/noticias/nao-publicavel/`);
    });
  }

  it("inclui noticia publicavel e indexavel", () => {
    const out = urls(richInput());
    expect(out).toContain(`${ORIGIN}/pt/noticias/not-a/`);
  });
});

describe("buildStaticSitemapEntries — fallback seguro sem banco", () => {
  it("devolve exatamente as rotas estaticas publicas operacionais, no dominio canonico", () => {
    const out = buildStaticSitemapEntries().map((entry) => entry.url);
    expect(out).toEqual([
      `${ORIGIN}/pt/`,
      `${ORIGIN}/pt/filmes/`,
      `${ORIGIN}/pt/series/`,
      `${ORIGIN}/pt/pessoas/`,
      `${ORIGIN}/pt/noticias/`,
      `${ORIGIN}/pt/explorar/`,
    ]);
  });

  it("fallback nao inventa lastModified", () => {
    for (const entry of buildStaticSitemapEntries()) {
      expect(entry.lastModifiedIso).toBeNull();
    }
  });
});
