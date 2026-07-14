import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const PAGE_PATH = resolve(ROOT, "apps/web/app/pt/pessoas/[slug]/page.tsx");
const CSS_PATH = resolve(
  ROOT,
  "apps/web/app/pt/pessoas/[slug]/person-canonical.module.css",
);

const pageSource = readFileSync(PAGE_PATH, "utf8");
const cssSource = readFileSync(CSS_PATH, "utf8");

describe("contrato canônico da tela 09 · Pessoa", () => {
  it("mantém a ordem canônica dos blocos que possuem dados reais", () => {
    const ad = pageSource.indexOf("<AdSlot");
    const filmography = pageSource.indexOf("Filmografia");
    const details = pageSource.indexOf("Detalhes pessoais");
    const news = pageSource.indexOf("Notícias relacionadas");

    expect(ad).toBeGreaterThan(0);
    expect(filmography).toBeGreaterThan(ad);
    expect(details).toBeGreaterThan(filmography);
    expect(news).toBeGreaterThan(details);
  });

  it("omite seções sem fonte real e não carrega mocks do protótipo", () => {
    expect(pageSource).not.toContain("Cillian Murphy");
    expect(pageSource).not.toContain("Screen Interviews");
    expect(pageSource).not.toContain("AWARDS");
    expect(pageSource).not.toContain("Conhecido por");
    expect(pageSource).not.toContain("142 fotos");
    expect(pageSource).not.toContain("rating");
  });

  it("preserva guards, canonical, metadata e os dois schemas JSON-LD", () => {
    expect(pageSource).toContain("canonicalRedirectPath");
    expect(pageSource).toContain("permanentRedirect");
    expect(pageSource).toContain("indexability.decision");
    expect(pageSource).toContain('"@type": "Person"');
    expect(pageSource).toContain('"@type": "BreadcrumbList"');
    expect(pageSource.match(/application\/ld\+json/g)).toHaveLength(2);
  });

  it("copia as medidas desktop centrais do HTML canônico", () => {
    expect(cssSource).toContain("max-width: 1280px");
    expect(cssSource).toContain("grid-template-columns: 200px minmax(0, 1fr)");
    expect(cssSource).toContain("gap: 102px");
    expect(cssSource).toContain("padding: 48px 80px 0");
    expect(cssSource).toContain("width: 249px");
    expect(cssSource).toContain("height: 228px");
    expect(cssSource).toContain("font-size: 56px");
    expect(cssSource).toContain("padding: 56px 80px 0");
    expect(cssSource).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  });

  it("aplica apenas a adaptação responsiva conservadora do contrato", () => {
    expect(cssSource).toContain("@media (max-width: 1279px)");
    expect(cssSource).toContain("padding-right: 48px");
    expect(cssSource).toContain("@media (max-width: 1023px)");
    expect(cssSource).toContain("width: 200px");
    expect(cssSource).toContain("@media (max-width: 767px)");
    expect(cssSource).toContain("padding-right: 20px");
    expect(cssSource).toContain("@media (max-width: 390px)");
    expect(cssSource).toContain("padding-right: 16px");
  });
});
