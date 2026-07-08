import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HOME_PAGE_REL = "apps/web/app/pt/page.tsx";
const COMPONENTS_REL = "apps/web/app/_components";
const PUBLIC_DEMO_SEED_REL = "apps/admin/scripts/public-demo-seed.ts";

function readSource(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function withoutComments(source: string): string {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      for (let i = 0; i < line.length - 1; i += 1) {
        if (line[i] === "/" && line[i + 1] === "/") {
          if (i > 0 && line[i - 1] === ":") continue;
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");
}

function stripAllowedHomePlaceholderGates(source: string): string {
  return source.replace(
    /\{\s*allowPlaceholders\s*\?\s*<EpisodesTicker\s*\/>\s*:\s*null\s*\}/g,
    "",
  );
}

function componentFiles(): string[] {
  const absDir = path.join(ROOT, COMPONENTS_REL);
  return readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => `${COMPONENTS_REL}/${entry.name}`);
}

const FAKE_STREAMING_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bHOME_VISUAL_PLATFORMS\b/, "HOME_VISUAL_PLATFORMS"],
  [/\bhomeVisualPlatform\b/, "homeVisualPlatform"],
  [/\bhome-v4-series-platform\b/, "home-v4-series-platform"],
  [/\b(?:NETFLIX|Netflix|Prime Video|Disney\+|Star\+|Apple TV\+|Max)\b/, "platform literal"],
  [/Onde assistir/i, "Onde assistir"],
];

const FAKE_RANKING_OR_ACTION_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bhome-v4-rank-badge\b/, "home-v4-rank-badge"],
  [/\bhome-v4-compact-rank\b/, "home-v4-compact-rank"],
  [/#\{rank\}/, "#{rank}"],
  [/Avaliar/i, "Avaliar"],
  [/Marcar como assistido/i, "Marcar como assistido"],
  [/\bhome-v4-muted-action\b/, "home-v4-muted-action"],
  [/\bhome-v4-watch-action\b/, "home-v4-watch-action"],
];

function findViolations(
  source: string,
  patterns: ReadonlyArray<[RegExp, string]>,
): string[] {
  return patterns
    .filter(([pattern]) => pattern.test(source))
    .map(([, label]) => label);
}

describe("governanca: UI publica nao finge streaming/ranking/nota", () => {
  it("EpisodesTicker so entra na home pelo gate allowHomeVisualPlaceholders", () => {
    const code = withoutComments(readSource(HOME_PAGE_REL));

    expect(code).toContain("allowHomeVisualPlaceholders()");
    expect(code).toMatch(
      /\{\s*allowPlaceholders\s*\?\s*<EpisodesTicker\s*\/>\s*:\s*null\s*\}/,
    );

    const withoutAllowedGate = stripAllowedHomePlaceholderGates(code);
    expect(withoutAllowedGate).not.toMatch(/<EpisodesTicker\s*\/>/);
  });

  it("home /pt nao contem streaming/plataforma fake fora do gate", () => {
    const code = stripAllowedHomePlaceholderGates(
      withoutComments(readSource(HOME_PAGE_REL)),
    );
    const violations = findViolations(code, FAKE_STREAMING_PATTERNS);

    expect(violations).toEqual([]);
  });

  it("home /pt nao contem pseudo-ranking nem affordance morta de usuario", () => {
    const code = withoutComments(readSource(HOME_PAGE_REL));
    const violations = findViolations(code, FAKE_RANKING_OR_ACTION_PATTERNS);

    expect(violations).toEqual([]);
  });

  it("componentes compartilhados nao prometem streaming sem contrato real de watch", () => {
    const violations: string[] = [];
    for (const file of componentFiles()) {
      if (file.endsWith("/episodes-ticker.tsx")) continue;

      const code = withoutComments(readSource(file));
      const hasRealWatchContract = /\bWatchView\b|watch-presenter|watch_availability/.test(
        code,
      );
      const matches = findViolations(code, FAKE_STREAMING_PATTERNS);

      if (matches.length > 0 && !hasRealWatchContract) {
        violations.push(`${file}: ${matches.join(", ")}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("seed demo publico nao grava screen_score exibivel", () => {
    const code = withoutComments(readSource(PUBLIC_DEMO_SEED_REL));

    expect(code).not.toMatch(/screenScore:\s*\w+\.screenScore/);
    expect(code).not.toMatch(/screenScoreDisplay:\s*true/);
  });
});
