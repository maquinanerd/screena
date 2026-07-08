/**
 * Testes puros do presenter dos portais (home /pt/ e /pt/explorar/).
 *
 * Garantem que os portais nao inventam dados (recorte deterministico dos
 * cards reais, nunca preenchimento), que contagens fake sao impossiveis
 * (formatCollectionCount so aceita inteiro > 0) e que o gate anti-thin
 * (invariante 5) da `noindex` a portal com menos de 2 secoes reais.
 */

import { describe, expect, it } from "vitest";

import {
  countPopulatedSections,
  evaluatePortalIndexability,
  formatCollectionCount,
  MIN_PORTAL_SECTIONS,
  takeSectionCards,
} from "../../apps/web/src/lib/portal-presenter";

describe("takeSectionCards", () => {
  it("recorta os N primeiros sem reordenar nem completar", () => {
    expect(takeSectionCards(["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });

  it("com menos itens que o limite, devolve so o que existe (nada fake)", () => {
    expect(takeSectionCards(["a"], 6)).toEqual(["a"]);
    expect(takeSectionCards([], 6)).toEqual([]);
  });

  it("limite nao positivo devolve vazio", () => {
    expect(takeSectionCards(["a"], 0)).toEqual([]);
    expect(takeSectionCards(["a"], -1)).toEqual([]);
  });
});

describe("countPopulatedSections", () => {
  it("conta apenas secoes com pelo menos 1 item real", () => {
    expect(countPopulatedSections([0, 0, 0])).toBe(0);
    expect(countPopulatedSections([1, 0, 3])).toBe(2);
    expect(countPopulatedSections([6, 6, 4, 8])).toBe(4);
  });
});

describe("evaluatePortalIndexability (indexacao total)", () => {
  it("portal vazio (0 secoes) -> noindex; >= 1 secao real -> index", () => {
    expect(evaluatePortalIndexability({ populatedSectionCount: 0 }).decision).toBe(
      "noindex",
    );
    expect(evaluatePortalIndexability({ populatedSectionCount: 1 }).decision).toBe(
      "index",
    );
  });

  it(`com >= ${MIN_PORTAL_SECTIONS} secoes populadas -> index (pagina "rica")`, () => {
    expect(evaluatePortalIndexability({ populatedSectionCount: 2 }).decision).toBe(
      "index",
    );
    expect(evaluatePortalIndexability({ populatedSectionCount: 4 }).decision).toBe(
      "index",
    );
  });

  it("contagem negativa e tratada como 0 (noindex)", () => {
    expect(
      evaluatePortalIndexability({ populatedSectionCount: -3 }).decision,
    ).toBe("noindex");
  });
});

describe("formatCollectionCount (sem numero fake)", () => {
  it("formata contagem real com singular/plural", () => {
    expect(formatCollectionCount(1, "título", "títulos")).toBe("1 título");
    expect(formatCollectionCount(12, "título", "títulos")).toBe("12 títulos");
  });

  it("contagem <= 0 ou nao inteira -> null (nunca inventa numero)", () => {
    expect(formatCollectionCount(0, "título", "títulos")).toBeNull();
    expect(formatCollectionCount(-5, "título", "títulos")).toBeNull();
    expect(formatCollectionCount(1.5, "título", "títulos")).toBeNull();
  });
});
