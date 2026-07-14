import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:css|tsx?|jsx?|mjs)$/.test(entry.name) ? [absolute] : [];
  });
}

describe("fundação cinematográfica canônica", () => {
  it("preserva a geometria exata do wordmark raiz", () => {
    const logo = read("apps/web/app/_components/screen-logo.tsx");

    expect(logo).toContain('viewBox="0 0 406 78"');
    expect(logo).toContain('x="0" y="62"');
    expect(logo).toContain('x="79" y="62"');
    expect(logo).toContain('x="158" y="62"');
    expect(logo).toContain('x="363" y="62"');
    expect(logo).toContain('height="42"');
    expect(logo).toContain('width="81"');
    expect(logo).toContain('x="239"');
    expect(logo).toContain('y="20"');
    expect(logo).toContain('rx="4"');
  });

  it("auto-hospeda Montserrat e mantém os tokens desktop do HTML validado", () => {
    const css = read("apps/web/app/globals.css");

    expect(css).toContain("url('/fonts/montserrat-latin-variable.woff2')");
    expect(css).toContain("font-weight: 100 900");
    expect(css).toContain("--bg-page: #fdfdfd");
    expect(css).toContain("--accent-movie: #f0443e");
    expect(css).toContain("--accent-series: #7fa56f");
    expect(css).toContain("--accent-yellow: #f5c518");
    expect(css).toContain("--container-max: 1280px");
    expect(css).toContain("--container-pad: 80px");
    expect(css).toContain("--nav-h: 72px");
  });

  it("não reintroduz import remoto de fonte no app público", () => {
    const files = [
      ...sourceFiles(path.join(ROOT, "apps", "web", "app")),
      ...sourceFiles(path.join(ROOT, "apps", "web", "src")),
    ];
    const sources = files.map((file) => readFileSync(file, "utf8")).join("\n");

    expect(sources).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/i);
    expect(sources).not.toMatch(/from\s+["']next\/font\/google["']/i);
    expect(sources).not.toMatch(/@import\s+url\([^)]*font/i);
  });

  it("modela somente as quatro dimensões de anúncio inventariadas", () => {
    const adSlot = read("apps/web/app/_components/ad-slot.tsx");

    expect(adSlot).toContain("leaderboard: { width: 728, height: 90 }");
    expect(adSlot).toContain("billboard: { width: 970, height: 250 }");
    expect(adSlot).toContain("skyscraper: { width: 300, height: 600 }");
    expect(adSlot).toContain("rectangle: { width: 300, height: 250 }");
  });
});
