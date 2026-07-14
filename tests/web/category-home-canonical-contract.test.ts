import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("category homes cinematográficas canônicas", () => {
  const component = read("apps/web/app/_components/category-home.tsx");
  const css = read("apps/web/app/_components/category-home.module.css");
  const movies = read("apps/web/app/pt/filmes/page.tsx");
  const series = read("apps/web/app/pt/series/page.tsx");

  it("usa o primeiro card exclusivamente no hero e os quatro seguintes no catálogo", () => {
    expect(component).toContain("const hero = view.cards[0] ?? null");
    expect(component).toContain("const catalogCards = view.cards.slice(1, 5)");
    expect(component.match(/<h1/g)).toHaveLength(1);
    expect(component).toContain("Catálogo de ${pageTitle.toLowerCase()}");
  });

  it("preserva a ordem e os três anúncios da tela 04", () => {
    expect(component.match(/<AdShell margin=/g)).toHaveLength(3);
    expect(component.match(/variant="leaderboard"/g)).toHaveLength(2);
    expect(component.match(/variant="billboard"/g)).toHaveLength(1);

    const markers = [
      "catalogCards.length",
      '<AdShell margin="56px 0 0" variant="leaderboard"',
      '<AdShell margin="72px 0 0" variant="billboard"',
      "comingCards.length",
      "{/* 3. Leaderboard",
      "featuredNews !== null",
    ];
    const positions = markers.map((marker) => component.indexOf(marker));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("não cria ranking, streaming, nota, trailer, plataforma ou watchlist", () => {
    expect(component).not.toMatch(/Top 10|mais assistid|box office|screenScore/);
    expect(component).not.toMatch(/Assistir trailer|dura[cç][aã]o|watchlist/i);
    expect(component).not.toMatch(/Netflix|Prime Video|Apple TV|plataformas/i);
  });

  it("usa lançamentos e notícias reais sem repetição", () => {
    expect(movies).toContain("getHomeUpcomingMovies({ limit: 4 })");
    expect(movies).toContain("getNewsIndexData()");
    expect(series).toContain("getNewsIndexData()");
    expect(component).toContain("if (seen.has(card.href)) continue");
    expect(component).toContain("const secondaryNews = newsCards.slice(1, 5)");
    expect(component).toContain("upcoming.slice(0, 4)");
  });

  it("mantém metadata governada e usa o componente comum nas duas rotas", () => {
    for (const page of [movies, series]) {
      expect(page).toContain('indexability.decision === "index"');
      expect(page).toContain("alternates: { canonical: canonicalUrl }");
      expect(page).toContain("<CategoryHome");
      expect(page).not.toContain("<EntityIndex");
    }
  });

  it("declara todos os breakpoints exigidos", () => {
    for (const width of [1279, 1023, 767, 390]) {
      expect(css).toContain(`@media (max-width: ${width}px)`);
    }
    expect(css).toContain("padding-right: 20px");
    expect(css).toContain("padding-left: 20px");
  });
});
