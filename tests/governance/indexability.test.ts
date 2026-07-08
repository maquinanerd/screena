/**
 * Testes de governanca de indexabilidade.
 *
 * Cobrem as invariantes 5 (indexacao total — politica 2026-07: toda entidade
 * sincronizada indexa; noindex so em caso tecnico), 6 (licenca bloqueada =
 * blocked) e 7 (pt-BR publica primeiro; locale fora de PUBLISHED_LOCALES =
 * draft) a partir da API publica de "@screena/seo".
 */

import { describe, expect, it } from "vitest";

import { evaluateIndexability, type IndexabilityInput } from "@screena/seo";

/**
 * Base valida (pt-BR, indexavel) que cada caso ajusta pontualmente.
 */
function baseInput(overrides: Partial<IndexabilityInput> = {}): IndexabilityInput {
  return {
    language: "pt-BR",
    hasReliableStructuredData: true,
    valueBlocksCount: 2,
    displayedRatings: [{ licenseDisplayAllowed: true }],
    thinContentScore: 0.1,
    reviewStatusOk: true,
    ...overrides,
  };
}

describe("evaluateIndexability (governanca de indexacao total)", () => {
  it("(1) pt-BR, entidade valida e licenciada -> index (invariante 5)", () => {
    const result = evaluateIndexability(baseInput());

    expect(result.decision).toBe("index");
    expect(result.hasUniqueValue).toBe(true);
    expect(result.allRatingsLicensed).toBe(true);
  });

  it("(2) pt-BR com apenas 1 bloco de valor -> index (indexacao total; blocos nao gateiam)", () => {
    const result = evaluateIndexability(baseInput({ valueBlocksCount: 1 }));

    // Indexa mesmo com poucos blocos; hasUniqueValue segue como sinal informativo.
    expect(result.decision).toBe("index");
    expect(result.hasUniqueValue).toBe(false);
  });

  it("(3) pt-BR com 0 blocos de valor (so ficha crua) -> index (toda entidade sincronizada indexa)", () => {
    const result = evaluateIndexability(
      baseInput({ valueBlocksCount: 0, thinContentScore: 1 }),
    );

    expect(result.decision).toBe("index");
    expect(result.hasUniqueValue).toBe(false);
  });

  it("(4) caso tecnico: sem dados estruturados/slug/traducao confiaveis -> noindex", () => {
    const result = evaluateIndexability(
      baseInput({ hasReliableStructuredData: false }),
    );

    expect(result.decision).toBe("noindex");
  });

  it("(5) qualquer pagina com um rating display_allowed=false -> blocked (invariante 6)", () => {
    const result = evaluateIndexability(
      baseInput({
        displayedRatings: [
          { licenseDisplayAllowed: true },
          { licenseDisplayAllowed: false },
        ],
      }),
    );

    expect(result.decision).toBe("blocked");
    expect(result.allRatingsLicensed).toBe(false);
  });

  it("(6) locale fora de PUBLISHED_LOCALES ('en') -> draft (invariante 7)", () => {
    const result = evaluateIndexability(baseInput({ language: "en" }));

    expect(result.decision).toBe("draft");
  });

  it("(7) locale publicado 'pt' -> index (PUBLISHED_LOCALES inclui pt-BR e pt)", () => {
    const result = evaluateIndexability(baseInput({ language: "pt" }));

    expect(result.decision).toBe("index");
  });
});
