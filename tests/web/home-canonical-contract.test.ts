import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("home cinematográfica canônica", () => {
  const home = read("apps/web/app/pt/page.tsx");
  const hero = read("apps/web/app/_components/hero-carousel.tsx");
  const upcoming = read("apps/web/app/_components/coming-soon-rail.tsx");

  it("não contém conteúdo de protótipo, repetição artificial ou reativação por flag", () => {
    expect(home).not.toMatch(/fillSlots|HOME_COMING_SOON_ITEMS|HOME_FEATURED_NEWS/);
    expect(home).not.toMatch(/HOME_GRID_NEWS|EpisodesTicker|allowHomeVisualPlaceholders/);
    expect(home).not.toMatch(/HOME_VISUAL_PLATFORMS/);
  });

  it("instala exatamente os três leaderboards nas margens canônicas", () => {
    expect(home.match(/<Leaderboard margin=/g)).toHaveLength(3);
    expect(home.match(/margin="56px 0 56px"/g)).toHaveLength(1);
    expect(home.match(/margin="56px 0 0"/g)).toHaveLength(2);
  });

  it("preserva a ordem estrutural mesmo com seções condicionais", () => {
    const markers = [
      "<HeroCarousel",
      '<Leaderboard margin="56px 0 56px"',
      'title="Filmes em alta"',
      'title="Séries da semana"',
      "<ComingSoonRail",
      'title="Notícias"',
    ];
    const positions = markers.map((marker) => home.indexOf(marker));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("separa notícias sem repetir o destaque na grade", () => {
    expect(home).toContain("const firstNews = newsCards[0]");
    expect(home).toContain("newsCards.slice(1, 5)");
  });

  it("Em breve não promete trailer nem aceita duração mock", () => {
    expect(upcoming).not.toMatch(/duration\??:/);
    expect(upcoming).not.toMatch(/Trailer anterior|Próximo trailer/);
    expect(home).not.toMatch(/Trailers de próximos lançamentos/);
  });

  it("usa a escala compacta canônica quando um título real é longo", () => {
    expect(hero).toContain("slide.title.length > 24");
    expect(hero).toContain('"sc-hero__title sc-hero__title--sm"');
    expect(hero).toContain("className={titleClassName}");
  });
});
