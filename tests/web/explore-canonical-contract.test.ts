import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const PAGE_PATH = resolve(ROOT, "apps/web/app/pt/explorar/page.tsx");
const CSS_PATH = resolve(
  ROOT,
  "apps/web/app/pt/explorar/explore-canonical.module.css",
);

const pageSource = readFileSync(PAGE_PATH, "utf8");
const cssSource = readFileSync(CSS_PATH, "utf8");

describe("contrato canônico da tela 11 · Explorar", () => {
  it("mantém a ordem dos blocos canônicos que possuem contrato real", () => {
    const ad = pageSource.indexOf("<AdSlot");
    const head = pageSource.indexOf("<header");
    const releases = pageSource.indexOf("discover-releases-title");

    expect(ad).toBeGreaterThan(0);
    expect(head).toBeGreaterThan(ad);
    expect(releases).toBeGreaterThan(head);
    expect(pageSource.match(/<AdSlot/g)).toHaveLength(1);
  });

  it("usa apenas datas persistidas, sem catálogo ou estados sociais simulados", () => {
    expect(pageSource).toContain("getHomeUpcomingMovies({ limit: UPCOMING_SOURCE_LIMIT })");
    expect(pageSource).toContain("takeUpcomingWeek(");
    expect(pageSource).toContain("{movie.weekday}");
    expect(pageSource).toContain("{movie.dateIso.slice(8, 10)}");
    expect(pageSource).toContain("Agenda da semana");
    expect(pageSource).not.toContain("getMovieIndexData()");
    expect(pageSource).not.toContain("getSeriesIndexData()");
    expect(pageSource).not.toContain("discover-catalog-title");
    expect(pageSource).not.toContain("Maior crescimento nas últimas 24h");
    expect(pageSource).not.toContain("De onde você parou");
    expect(pageSource).not.toContain("Títulos mais salvos pela comunidade");
    expect(pageSource).not.toContain("Adicionar à watchlist");
    expect(pageSource).not.toContain(">Trailer<");
    expect(pageSource).not.toContain("styles.feature");
    expect(pageSource).toContain("Nenhum lançamento publicado");
    expect(pageSource).toContain("<h3>{movie.title}</h3>");
  });

  it("preserva metadata, indexabilidade e os dois schemas da rota", () => {
    expect(pageSource).toContain("indexability.decision");
    expect(pageSource).toContain("canonicalPublicUrl(EXPLORE_PATH)");
    expect(pageSource).toContain('"@type": "CollectionPage"');
    expect(pageSource).toContain('"@type": "BreadcrumbList"');
    expect(pageSource.match(/application\/ld\+json/g)).toHaveLength(2);
  });

  it("copia as medidas desktop centrais do Discover canônico", () => {
    expect(cssSource).toContain("max-width: 1280px");
    expect(cssSource).toContain("padding: 36px 80px 0");
    expect(cssSource).toContain("font-size: 32px");
    expect(cssSource).toContain("margin: 10px 14px");
    expect(cssSource).toContain("width: 66px");
    expect(cssSource).toContain("width: 112px");
  });

  it("aplica apenas os breakpoints conservadores do contrato", () => {
    expect(cssSource).toContain("@media (max-width: 1279px)");
    expect(cssSource).toContain("padding-right: 48px");
    expect(cssSource).toContain("@media (max-width: 1023px)");
    expect(cssSource).toContain("padding-right: 32px");
    expect(cssSource).toContain("@media (max-width: 767px)");
    expect(cssSource).toContain("padding: 28px 20px 0");
    expect(cssSource).toContain("@media (max-width: 390px)");
    expect(cssSource).toContain("padding-right: 16px");
  });
});
