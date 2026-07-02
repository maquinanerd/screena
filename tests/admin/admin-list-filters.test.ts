/**
 * Testes dos FILTROS de listagem (Fase 7A): parte textual (as paginas de lista
 * aceitam search params, tem link "Revisar", nao fazem fetch externo nem SQL cru)
 * e parte PURA (parse de filtros normaliza so enums reais e ignora o arbitrario).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  firstValue,
  hasArticleFilters,
  hasContentBlockFilters,
  parseArticleFilters,
  parseBlockTypeFilter,
  parseContentBlockFilters,
  parseEntityTypeFilter,
  parseIndexStatusFilter,
  parseLanguageFilter,
  parseReviewBucket,
  reviewBucketLabel,
  reviewStatusesForBucket,
} from "../../apps/admin/src/lib/editorial-filters";

const ARTICLES_PAGE = resolve(process.cwd(), "apps", "admin", "app", "articles", "page.tsx");
const BLOCKS_PAGE = resolve(process.cwd(), "apps", "admin", "app", "content-blocks", "page.tsx");

/* ------------------------------------------------------------------ */
/* Parte textual: estrutura das paginas de lista                       */
/* ------------------------------------------------------------------ */

describe("paginas de lista aceitam search params e linkam para o detalhe", () => {
  it("articles: usa searchParams + parseArticleFilters e link Revisar para /articles/{id}", async () => {
    const code = await readFile(ARTICLES_PAGE, "utf-8");
    expect(code).toContain("searchParams");
    expect(code).toContain("parseArticleFilters");
    expect(code).toContain("/articles/$");
    expect(code).toContain("Revisar");
  });

  it("content-blocks: usa searchParams + parseContentBlockFilters e link Revisar para /content-blocks/{id}", async () => {
    const code = await readFile(BLOCKS_PAGE, "utf-8");
    expect(code).toContain("searchParams");
    expect(code).toContain("parseContentBlockFilters");
    expect(code).toContain("/content-blocks/$");
    expect(code).toContain("Revisar");
  });

  it("os filtros nao fazem fetch externo nem SQL cru", async () => {
    for (const file of [ARTICLES_PAGE, BLOCKS_PAGE]) {
      const code = await readFile(file, "utf-8");
      expect(/\bfetch\s*\(/.test(code), `${file} chama fetch`).toBe(false);
      for (const needle of ["$queryRaw", "$executeRaw", "Unsafe", "image.tmdb.org"]) {
        expect(code.includes(needle), `${file} contem ${needle}`).toBe(false);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* Parte pura: parse de filtros                                        */
/* ------------------------------------------------------------------ */

describe("firstValue", () => {
  it("extrai o primeiro valor de string/array/undefined", () => {
    expect(firstValue("x")).toBe("x");
    expect(firstValue(["a", "b"])).toBe("a");
    expect(firstValue([])).toBeUndefined();
    expect(firstValue(undefined)).toBeUndefined();
  });
});

describe("parse de dimensoes de filtro (so enums reais)", () => {
  it("parseReviewBucket", () => {
    expect(parseReviewBucket("pending")).toBe("pending");
    expect(parseReviewBucket("approved")).toBe("approved");
    expect(parseReviewBucket("blocked")).toBe("blocked");
    expect(parseReviewBucket("nope")).toBeNull();
    expect(parseReviewBucket(undefined)).toBeNull();
  });

  it("reviewStatusesForBucket mapeia para os conjuntos reais", () => {
    expect([...reviewStatusesForBucket("pending")]).toEqual([
      "draft",
      "ai_generated",
      "needs_review",
      "needs_update",
    ]);
    expect([...reviewStatusesForBucket("approved")]).toEqual(["human_reviewed", "published"]);
    expect([...reviewStatusesForBucket("blocked")]).toEqual(["blocked", "archived"]);
  });

  it("parseLanguageFilter (allowlist fechado)", () => {
    expect(parseLanguageFilter("pt-BR")).toBe("pt-BR");
    expect(parseLanguageFilter("en")).toBe("en");
    expect(parseLanguageFilter("es")).toBe("es");
    expect(parseLanguageFilter("fr")).toBeNull();
    expect(parseLanguageFilter("'; DROP TABLE")).toBeNull();
  });

  it("parseIndexStatusFilter", () => {
    expect(parseIndexStatusFilter("index")).toBe("index");
    expect(parseIndexStatusFilter("stale")).toBe("stale");
    expect(parseIndexStatusFilter("indexed")).toBeNull();
  });

  it("parseEntityTypeFilter", () => {
    expect(parseEntityTypeFilter("movie")).toBe("movie");
    expect(parseEntityTypeFilter("tv")).toBe("tv");
    expect(parseEntityTypeFilter("article")).toBeNull();
  });

  it("parseBlockTypeFilter", () => {
    expect(parseBlockTypeFilter("editorial_intro")).toBe("editorial_intro");
    expect(parseBlockTypeFilter("faq")).toBe("faq");
    expect(parseBlockTypeFilter("nope")).toBeNull();
  });
});

describe("parseArticleFilters / parseContentBlockFilters", () => {
  it("normaliza valores validos", () => {
    expect(parseArticleFilters({ status: "pending", language: "pt-BR", indexStatus: "noindex" })).toEqual(
      { statusBucket: "pending", language: "pt-BR", indexStatus: "noindex" },
    );
    expect(
      parseContentBlockFilters({ status: "approved", language: "en", entityType: "movie", blockType: "faq" }),
    ).toEqual({ statusBucket: "approved", language: "en", entityType: "movie", blockType: "faq" });
  });

  it("ignora chaves arbitrarias e valores invalidos (nao vira where arbitrario)", () => {
    expect(
      parseArticleFilters({ status: "boom", language: "xx", indexStatus: "1;DROP", evil: "x" }),
    ).toEqual({ statusBucket: null, language: null, indexStatus: null });
    expect(parseContentBlockFilters({ entityType: "hack", blockType: "sql" })).toEqual({
      statusBucket: null,
      language: null,
      entityType: null,
      blockType: null,
    });
  });

  it("params vazio/ausente => sem filtro", () => {
    expect(parseArticleFilters(undefined)).toEqual({ statusBucket: null, language: null, indexStatus: null });
    expect(hasArticleFilters(parseArticleFilters({}))).toBe(false);
    expect(hasContentBlockFilters(parseContentBlockFilters({}))).toBe(false);
  });

  it("hasFilters detecta filtro ativo", () => {
    expect(hasArticleFilters(parseArticleFilters({ status: "pending" }))).toBe(true);
    expect(hasContentBlockFilters(parseContentBlockFilters({ entityType: "tv" }))).toBe(true);
  });

  it("array de valores usa o primeiro (comportamento do App Router)", () => {
    expect(parseArticleFilters({ status: ["approved", "pending"] }).statusBucket).toBe("approved");
  });
});

describe("reviewBucketLabel", () => {
  it("rotula os baldes (e Todos para null)", () => {
    expect(reviewBucketLabel("pending")).toContain("Pendentes");
    expect(reviewBucketLabel("approved")).toBe("Aprovados");
    expect(reviewBucketLabel("blocked")).toBe("Bloqueados");
    expect(reviewBucketLabel(null)).toBe("Todos");
  });
});
