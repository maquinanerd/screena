/**
 * Testes puros do presenter de "Onde assistir" (invariantes 6 e 8).
 *
 * Garantem: LICENCA antes de exibir (so display_allowed); SEM pirataria (so
 * modalidades legais do enum; tipos desconhecidos descartados); agrupamento por
 * provedor em ordem canonica; carimbo "Atualizado em" pelo fetched_at mais
 * recente; secao vazia quando nao ha oferta permitida.
 */

import { describe, expect, it } from "vitest";

import {
  buildWatchView,
  formatWatchDate,
  type WatchOfferInput,
} from "../../apps/web/src/lib/watch-presenter";

function offer(overrides: Partial<WatchOfferInput> = {}): WatchOfferInput {
  return {
    providerName: "Netflix",
    offerType: "subscription",
    displayAllowed: true,
    fetchedAtIso: null,
    ...overrides,
  };
}

describe("formatWatchDate", () => {
  it("formata ISO -> DD/MM/AAAA e recusa invalido", () => {
    expect(formatWatchDate("2026-06-15T00:00:00.000Z")).toBe("15/06/2026");
    expect(formatWatchDate("2026-06-15")).toBe("15/06/2026");
    expect(formatWatchDate(null)).toBeNull();
    expect(formatWatchDate("15/06/2026")).toBeNull();
  });
});

describe("buildWatchView — licenca e pirataria", () => {
  it("descarta oferta sem display_allowed (gate de licenca, invariante 6)", () => {
    const view = buildWatchView([offer({ displayAllowed: false })]);
    expect(view.providers).toEqual([]);
    expect(view.updatedAtLabel).toBeNull();
  });

  it("descarta modalidade fora do enum legal (sem pirataria)", () => {
    const view = buildWatchView([
      offer({ providerName: "X", offerType: "torrent" }),
      offer({ providerName: "X", offerType: "iptv" }),
    ]);
    expect(view.providers).toEqual([]);
  });

  it("descarta provedor sem nome", () => {
    expect(buildWatchView([offer({ providerName: "   " })]).providers).toEqual([]);
  });
});

describe("buildWatchView — agrupamento e frescor", () => {
  it("agrupa por provedor com modalidades distintas em ordem canonica", () => {
    const view = buildWatchView([
      offer({ providerName: "Prime Video", offerType: "buy" }),
      offer({ providerName: "Prime Video", offerType: "rent" }),
      offer({ providerName: "Prime Video", offerType: "subscription" }),
      offer({ providerName: "Apple TV", offerType: "buy" }),
    ]);
    expect(view.providers.map((p) => p.providerName)).toEqual(["Apple TV", "Prime Video"]);
    const prime = view.providers.find((p) => p.providerName === "Prime Video");
    expect(prime?.offerLabels).toEqual(["Assinatura", "Aluguel", "Compra"]);
  });

  it("carimbo pelo fetched_at mais recente", () => {
    const view = buildWatchView([
      offer({ fetchedAtIso: "2026-05-01T00:00:00Z" }),
      offer({ providerName: "Max", fetchedAtIso: "2026-06-20T00:00:00Z" }),
    ]);
    expect(view.updatedAtLabel).toBe("Atualizado em 20/06/2026");
  });

  it("sem fetched_at -> sem carimbo, mas com provedores", () => {
    const view = buildWatchView([offer()]);
    expect(view.providers).toHaveLength(1);
    expect(view.updatedAtLabel).toBeNull();
  });
});
