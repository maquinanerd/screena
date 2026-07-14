import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  type Dirent,
} from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WEB_ROOT = path.join(ROOT, "apps", "web");
const APP_ROOT = path.join(WEB_ROOT, "app");
const BRAND_ROOT = path.join(WEB_ROOT, "public", "brand", "cinerie");
const FONT_ROOT = path.join(WEB_ROOT, "public", "fonts");

const EXPECTED_SVGS = [
  "favicon-movie.svg",
  "favicon-series.svg",
  "logo-cinema.svg",
  "logo-noticias.svg",
  "logo-pessoas.svg",
  "logo-serie.svg",
  "logo.svg",
  "variantes/5a-logo-preta-sublinhado-preto.svg",
  "variantes/5b-logo-preta-sublinhado-cinema.svg",
  "variantes/5c-logo-preta-sublinhado-serie.svg",
  "variantes/5d-logo-preta-sublinhado-pessoas.svg",
  "variantes/5e-logo-preta-sublinhado-noticias.svg",
  "variantes/5f-logo-branca-sublinhado-branco.svg",
  "variantes/5g-logo-branca-sublinhado-cinema.svg",
  "variantes/5h-logo-branca-sublinhado-serie.svg",
  "variantes/5i-logo-branca-sublinhado-pessoas.svg",
  "variantes/5j-logo-branca-sublinhado-noticias.svg",
] as const;

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: Dirent) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(absolute) : [absolute];
    })
    .sort();
}

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

describe("marca publica cinerie", () => {
  it("instala exatamente os SVGs oficiais esperados", () => {
    const actual = listFiles(BRAND_ROOT)
      .filter((file) => file.endsWith(".svg"))
      .map((file) => path.relative(BRAND_ROOT, file).replaceAll("\\", "/"));

    expect(actual).toEqual([...EXPECTED_SVGS].sort());
  });

  it("mantem todos os logos em outline/path, sem texto ou dependencia de fonte", () => {
    for (const relative of EXPECTED_SVGS) {
      const source = readFileSync(path.join(BRAND_ROOT, relative), "utf8");
      const elementNames = [...source.matchAll(/<\/?([a-z][a-z0-9-]*)\b/gi)].map(
        (match) => match[1]?.toLowerCase(),
      );

      expect(source, relative).toContain("<path");
      expect(source, relative).not.toMatch(/<text\b/i);
      expect(source, relative).not.toMatch(/font-family|@font-face/i);
      expect(source, relative).not.toMatch(/\b(?:href|src)=/i);
      expect(new Set(elementNames), relative).toEqual(new Set(["svg", "path"]));
    }
  });

  it("usa cinerie na metadata, no logo e nas fontes publicas", () => {
    const layout = read("apps/web/app/layout.tsx");
    const logo = read("apps/web/app/_components/cinerie-logo.tsx");
    const publicRuntime = listFiles(APP_ROOT)
      .filter((file) => /\.(?:css|ts|tsx)$/.test(file))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(layout).toContain('default: "cinerie"');
    expect(layout).toContain('siteName: "cinerie"');
    expect(logo).toContain('alt="cinerie"');
    expect(publicRuntime).not.toMatch(/\b(?:The\s+)?Screen\b/);
    expect(publicRuntime).not.toContain("/brand/screen-logo");
  });

  it("preserva Montserrat self-hosted e nao adiciona Gilroy como webfont", () => {
    const css = read("apps/web/app/globals.css");
    const fontFaces = css.match(/@font-face\s*\{[^}]*\}/gis) ?? [];
    const montserratWoff2 = path.join(FONT_ROOT, "montserrat-latin-variable.woff2");
    const ofl = path.join(FONT_ROOT, "OFL.txt");

    expect(fontFaces.some((block) => /font-family:\s*["']Montserrat["']/i.test(block))).toBe(true);
    expect(fontFaces.every((block) => !/Gilroy/i.test(block))).toBe(true);
    expect(css).toMatch(/--font-sans:[\s\S]*["']Montserrat["']/);
    expect(css).toMatch(/body\s*\{[\s\S]*?font-family:\s*var\(--font-sans\)/);
    expect(css).not.toMatch(/@import|fonts\.googleapis|fonts\.gstatic/i);
    expect(existsSync(montserratWoff2)).toBe(true);
    expect(existsSync(ofl)).toBe(true);
    expect(statSync(montserratWoff2).size).toBeGreaterThan(0);
    expect(statSync(ofl).size).toBeGreaterThan(0);
  });

  it("remove os seis logos publicos da marca anterior", () => {
    for (const filename of [
      "screen-logo-black.svg",
      "screen-logo-white.svg",
      "screen-logo-cinema.svg",
      "screen-logo-cinema-white.svg",
      "screen-logo-series.svg",
      "screen-logo-series-white.svg",
    ]) {
      expect(existsSync(path.join(WEB_ROOT, "public", "brand", filename))).toBe(false);
    }
  });
});
