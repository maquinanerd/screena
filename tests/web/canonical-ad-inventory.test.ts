import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CANONICAL_AD_PLACEMENTS } from "../../apps/web/src/lib/canonical-ad-inventory";

const ROOT = resolve(import.meta.dirname, "../..");

describe("inventário das 23 posições publicitárias canônicas", () => {
  it("preserva todas as posições e identificadores únicos", () => {
    expect(CANONICAL_AD_PLACEMENTS).toHaveLength(23);
    expect(new Set(CANONICAL_AD_PLACEMENTS.map((placement) => placement.id)).size).toBe(
      23,
    );
  });

  it("preserva a distribuição exata de formatos do HTML raiz", () => {
    const count = (variant: string) =>
      CANONICAL_AD_PLACEMENTS.filter((placement) => placement.variant === variant)
        .length;

    expect(count("leaderboard")).toBe(15);
    expect(count("billboard")).toBe(4);
    expect(count("skyscraper")).toBe(3);
    expect(count("rectangle")).toBe(1);
  });

  it("preserva a distribuição exata entre telas", () => {
    const expected = {
      home: 3,
      "news-all": 4,
      "news-category": 2,
      "category-home": 3,
      article: 1,
      person: 1,
      browse: 2,
      discover: 1,
      lists: 3,
      "sign-in": 1,
      "ad-popup": 1,
      "ad-interstitial": 1,
    } as const;

    for (const [screen, total] of Object.entries(expected)) {
      expect(
        CANONICAL_AD_PLACEMENTS.filter((placement) => placement.screen === screen),
      ).toHaveLength(total);
    }
  });

  it("distingue posições ativas/condicionais das superfícies sem contrato", () => {
    const modeled = CANONICAL_AD_PLACEMENTS.filter(
      (placement) => placement.implementation !== "deferred",
    );
    const deferred = CANONICAL_AD_PLACEMENTS.filter(
      (placement) => placement.implementation === "deferred",
    );

    expect(modeled).toHaveLength(13);
    expect(deferred).toHaveLength(10);
  });

  it("mantém o componente como reserva local, sem runtime de anúncio externo", () => {
    const source = readFileSync(
      resolve(ROOT, "apps/web/app/_components/ad-slot.tsx"),
      "utf8",
    );
    const css = readFileSync(resolve(ROOT, "apps/web/app/globals.css"), "utf8");

    expect(source).toContain('data-ad-state={showDiagnostic ? "placeholder" : "reserved"}');
    expect(source).not.toMatch(/adsbygoogle|googlesyndication|<script/i);
    expect(css).toContain("width: 728px");
    expect(css).toContain("height: 90px");
    expect(css).toContain("width: 970px");
    expect(css).toContain("height: 250px");
    expect(css).toContain("width: 300px");
    expect(css).toContain("height: 600px");
  });
});
