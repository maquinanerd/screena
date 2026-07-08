/**
 * P0-13: a raiz "/" nao tem page.tsx proprio e deve redirecionar com 307 para
 * o locale publicado. Enquanto so pt esta publicado, pt/es/en/vazio caem em /pt/.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PUBLISHED_LOCALES,
  rootRedirectPath,
  resolveLocale,
  resolvePreferredLocale,
  resolveRootRedirectLocale,
} from "../../apps/web/src/lib/root-locale";

describe("root locale redirect", () => {
  it("nao cria page.tsx na raiz", () => {
    expect(
      existsSync(resolve(process.cwd(), "apps", "web", "app", "page.tsx")),
    ).toBe(false);
  });

  it("mantem apenas pt publicado para a raiz enquanto en/es nao tem conteudo", () => {
    expect(PUBLISHED_LOCALES).toEqual(["pt"]);
  });

  it.each([
    ["pt-BR,pt;q=0.9", "pt"],
    ["es-ES,es;q=0.9", "es"],
    ["en-US,en;q=0.9", "en"],
    [null, "en"],
    ["fr-FR,fr;q=0.9", "en"],
  ])("detecta preferencia %s -> %s", (header, expected) => {
    expect(resolvePreferredLocale(header)).toBe(expected);
  });

  it.each([
    ["pt-BR,pt;q=0.9"],
    ["es-ES,es;q=0.9"],
    ["en-US,en;q=0.9"],
    [null],
  ])("resolve GET / para /pt/ com Accept-Language %s", (header) => {
    expect(rootRedirectPath(header)).toBe("/pt/");
  });

  it("helper de redirect aplica fallback para locale nao publicado", () => {
    expect(resolveRootRedirectLocale("pt-BR")).toBe("pt");
    expect(resolveRootRedirectLocale("es-ES")).toBe("pt");
    expect(resolveRootRedirectLocale("en-US")).toBe("pt");
    expect(resolveRootRedirectLocale(null)).toBe("pt");
  });

  it("resolve locale por segmento sem chamar API externa", () => {
    expect(resolveLocale("/pt/series/")).toBe("pt");
    expect(resolveLocale("/en/movies/")).toBe("en");
    expect(resolveLocale("/es/peliculas/")).toBe("es");
    expect(resolveLocale("/filmes/")).toBe("pt");
  });

  it("middleware redireciona somente a raiz com 307 temporario", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps", "web", "middleware.ts"),
      "utf8",
    );
    expect(source).toContain('request.nextUrl.pathname === "/"');
    expect(source).toContain("NextResponse.redirect(url, 307)");
    expect(source).not.toContain("permanentRedirect");
  });

  it("matcher continua excluindo media, _next, api e assets publicos", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps", "web", "middleware.ts"),
      "utf8",
    );
    const matcher = source;
    expect(matcher).toContain("_next/static");
    expect(matcher).toContain("_next/image");
    expect(matcher).toContain("api");
    expect(matcher).toContain("media");
    expect(matcher).toContain("brand");
    expect(matcher).toContain("uploads");
  });

  it("home pt declara hreflang pt-BR e x-default para /pt/", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps", "web", "app", "pt", "page.tsx"),
      "utf8",
    );
    expect(source).toContain('"pt-BR": homeCanonicalUrl');
    expect(source).toContain('"x-default": homeCanonicalUrl');
  });
});
