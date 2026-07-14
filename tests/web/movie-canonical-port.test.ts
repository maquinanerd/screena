import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PAGE_REL = "apps/web/app/pt/filmes/[slug]/page.tsx";
const CSS_REL =
  "apps/web/app/pt/filmes/[slug]/movie-canonical.module.css";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("porta canônica da tela 06 — detalhe de filme", () => {
  const page = read(PAGE_REL);
  const livePage = withoutComments(page);
  const css = read(CSS_REL);

  it("preserva getter, metadata, redirect canônico e grafo JSON-LD", () => {
    expect(page).toContain("getMoviePageData(slug)");
    expect(page).toContain("canonicalRedirectPath(");
    expect(page).toContain("permanentRedirect(redirectPath)");
    expect(page).toContain("alternates: { canonical: canonicalUrl }");
    expect(page).toContain('"@type": "Movie"');
    expect(page).toContain('"@id": canonicalUrl');
    expect(page).toContain("mainEntityOfPage: canonicalUrl");
    expect(page).toContain('buildSameAs(externalIds, "movie")');
    expect(livePage).not.toContain("AggregateRating");
  });

  it("mantém exatamente um h1 e a ordem editorial da tela canônica", () => {
    expect(livePage.match(/<h1[\s>]/g)).toHaveLength(1);

    const markupStart = page.indexOf("    <main");
    const markup = page.slice(markupStart);
    const orderedMarkers = [
      "className={styles.hero}",
      "className={styles.mediaStrip}",
      "className={styles.sectionFrame}",
      "className={styles.critique}",
      "className={styles.castSection}",
      "className={styles.newsSection}",
      "className={styles.factsFrame}",
    ];
    let cursor = -1;
    for (const marker of orderedMarkers) {
      const position = markup.indexOf(marker);
      expect(position, marker).toBeGreaterThan(cursor);
      cursor = position;
    }
  });

  it("condiciona toda seção de produto a dados reais", () => {
    expect(page).toContain("watch !== null ?");
    expect(page).toContain("<WatchAvailabilityPanel view={watch} />");
    expect(page).toContain("workLead !== null ?");
    expect(page).toContain("critiqueBlock !== null ?");
    expect(page).toContain("primaryCast.length > 0 ?");
    expect(page).toContain("editorialNews.length > 0 ?");
    expect(page).toContain("facts.length > 0 ?");
    expect(page).toContain("view.blocks.filter(");
    expect(page).toContain("workBlocks.slice(1)");
  });

  it("não promove os mocks e features mortas do protótipo", () => {
    const markup = livePage.slice(livePage.indexOf("    <main"));
    expect(markup).not.toMatch(
      /O Último Inverno|Screen Score|Minha lista|Avaliar|IMDb|Rotten Tomatoes|2 vitórias|6 indicações/,
    );
    expect(markup).not.toContain("fetch(");
    expect(markup).not.toMatch(/tmdb|gemini|rapidapi/i);
    expect(page).not.toContain("AdSlot");
  });

  it("copia as medidas desktop da tela 06 sem normalizá-las", () => {
    expect(css).toContain("max-width: 1360px;");
    expect(css).toContain("padding-right: 64px;");
    expect(css).toContain("padding-left: 64px;");
    expect(css).toContain("padding-top: 22px;");
    expect(css).toContain("gap: 34px 46px;");
    expect(css).toContain("font-size: 38px;");
    expect(css).toContain("letter-spacing: -0.04em;");
    expect(css).toContain("grid-template-columns: 1fr 3fr 2fr;");
    expect(css).toContain("height: 472px;");
    expect(css).toContain("min-height: 460px;");
    expect(css).toContain("grid-template-columns: repeat(6, 1fr);");
    expect(css).toContain("grid-template-columns: 1.4fr 1fr 1fr;");
  });

  it("aplica apenas a adaptação responsiva conservadora do contrato", () => {
    expect(css).toContain("@media (max-width: 1279px)");
    expect(css).toContain("padding-right: 48px;");
    expect(css).toContain("@media (max-width: 1023px)");
    expect(css).toContain("padding-right: 32px;");
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain("padding-right: 20px;");
    expect(css).toContain("flex: 0 0 120px;");
    expect(css).toContain("@media (max-width: 390px)");
    expect(css).toContain("padding-right: 16px;");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
