/**
 * Testes de governanca do gate anti-thin / indexabilidade.
 *
 * Cobrem as invariantes 5 (pagina fina = noindex), 6 (licenca bloqueada =
 * blocked) e 7 (pt-BR publica primeiro; en/es nascem em draft) a partir da
 * API publica de "@screena/seo".
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

describe("evaluateIndexability (governanca anti-thin)", () => {
  it("(1) pt-BR com structured data mas apenas 1 bloco de valor -> noindex (invariante 5)", () => {
    const result = evaluateIndexability(
      baseInput({ valueBlocksCount: 1 }),
    );

    expect(result.decision).toBe("noindex");
    expect(result.hasUniqueValue).toBe(false);
  });

  it("(2) pt-BR completa (structured data, 2 blocos, thin 0.1, review ok, sem ratings bloqueados) -> index", () => {
    const result = evaluateIndexability(
      baseInput({
        valueBlocksCount: 2,
        thinContentScore: 0.1,
        reviewStatusOk: true,
      }),
    );

    expect(result.decision).toBe("index");
    expect(result.hasUniqueValue).toBe(true);
    expect(result.allRatingsLicensed).toBe(true);
  });

  it("(3) qualquer pagina com um rating display_allowed=false -> blocked (invariante 6)", () => {
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

  it("(4) language 'en' com tudo ok -> draft (nao indexa no MVP, invariante 7)", () => {
    const result = evaluateIndexability(
      baseInput({ language: "en" }),
    );

    expect(result.decision).toBe("draft");
  });
});
