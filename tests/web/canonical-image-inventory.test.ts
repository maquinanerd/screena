import { describe, expect, it } from "vitest";

import { CANONICAL_IMAGE_SLOTS } from "../../apps/web/src/lib/canonical-image-inventory";

describe("inventário das 31 categorias de imagem canônicas", () => {
  it("preserva todas as categorias com identificadores internos únicos", () => {
    expect(CANONICAL_IMAGE_SLOTS).toHaveLength(31);
    expect(new Set(CANONICAL_IMAGE_SLOTS.map((slot) => slot.id)).size).toBe(31);
  });

  it("preserva a distribuição exata entre as telas do HTML raiz", () => {
    const expected = {
      movie: 9,
      "series-desktop": 10,
      "series-mobile": 3,
      discover: 7,
      anticipated: 1,
      settings: 1,
    } as const;

    for (const [screen, total] of Object.entries(expected)) {
      expect(
        CANONICAL_IMAGE_SLOTS.filter((slot) => slot.screen === screen),
      ).toHaveLength(total);
    }
  });

  it("não promove slots sem contrato real a mídia pública", () => {
    const deferred = CANONICAL_IMAGE_SLOTS.filter(
      (slot) => slot.implementation === "deferred",
    );
    const modeled = CANONICAL_IMAGE_SLOTS.filter(
      (slot) => slot.implementation !== "deferred",
    );

    expect(modeled).toHaveLength(16);
    expect(deferred).toHaveLength(15);
    expect(
      deferred.some(
        (slot) => slot.screen === "settings" && slot.role === "avatar",
      ),
    ).toBe(true);
  });

  it("mantém os IDs literais e de template usados pelo pacote", () => {
    const canonicalIds = new Set(
      CANONICAL_IMAGE_SLOTS.map((slot) => slot.canonicalId),
    );

    expect(canonicalIds).toContain("movie-poster");
    expect(canonicalIds).toContain("series-backdrop");
    expect(canonicalIds).toContain("{{ discFeature.posterSlot }}");
    expect(canonicalIds).toContain("{{ c.posterSlot }}");
    expect(canonicalIds).toContain("v3-settings-avatar");
  });
});
