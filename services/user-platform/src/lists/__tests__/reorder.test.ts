/**
 * Testes — reordenacao de itens de lista (@screena/user-platform lists).
 *
 * Garantem: posicoes SEMPRE contiguas 0..n-1 para todos os itens, clamp da
 * posicao alvo, rejeicao de id estranho/duplicado e validacao da
 * reordenacao completa proposta pelo cliente.
 */

import { describe, expect, it } from "vitest";

import { buildPositionsFromOrder, planReorder, validateFullReorder } from "../reorder.js";

const IDS = [10n, 20n, 30n, 40n] as const;

function basePlanInput(
  overrides: Partial<{
    orderedItemIds: ReadonlyArray<bigint>;
    moveItemId: bigint;
    toPosition: number;
  }> = {},
): { orderedItemIds: ReadonlyArray<bigint>; moveItemId: bigint; toPosition: number } {
  return {
    orderedItemIds: [...IDS],
    moveItemId: 30n,
    toPosition: 0,
    ...overrides,
  };
}

describe("planReorder", () => {
  it("(1) move o item para o inicio e devolve posicoes contiguas 0..n-1", () => {
    const result = planReorder(basePlanInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { itemId: 30n, position: 0 },
        { itemId: 10n, position: 1 },
        { itemId: 20n, position: 2 },
        { itemId: 40n, position: 3 },
      ]);
    }
  });

  it("(2) move o item para o meio preservando a ordem relativa dos demais", () => {
    const result = planReorder(basePlanInput({ moveItemId: 10n, toPosition: 2 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((p) => p.itemId)).toEqual([20n, 30n, 10n, 40n]);
      expect(result.value.map((p) => p.position)).toEqual([0, 1, 2, 3]);
    }
  });

  it("(3) clampa posicao alvo alem do fim para n-1", () => {
    const result = planReorder(basePlanInput({ moveItemId: 10n, toPosition: 999 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((p) => p.itemId)).toEqual([20n, 30n, 40n, 10n]);
      expect(result.value.map((p) => p.position)).toEqual([0, 1, 2, 3]);
    }
  });

  it("(4) clampa posicao alvo negativa para 0", () => {
    const result = planReorder(basePlanInput({ moveItemId: 40n, toPosition: -5 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((p) => p.itemId)).toEqual([40n, 10n, 20n, 30n]);
    }
  });

  it("(5) devolve not_found para item que nao pertence a lista", () => {
    const result = planReorder(basePlanInput({ moveItemId: 999n }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
    }
  });

  it("(6) rejeita ordem atual com id duplicado (validation_failed)", () => {
    const result = planReorder(basePlanInput({ orderedItemIds: [10n, 20n, 20n, 30n] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_failed");
    }
  });

  it("(7) rejeita posicao alvo nao-inteira (validation_failed)", () => {
    const result = planReorder(basePlanInput({ toPosition: 1.5 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_failed");
    }
  });

  it("(8) lista de um unico item continua contigua ao mover para qualquer lugar", () => {
    const result = planReorder(
      basePlanInput({ orderedItemIds: [7n], moveItemId: 7n, toPosition: 42 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([{ itemId: 7n, position: 0 }]);
    }
  });
});

describe("validateFullReorder", () => {
  it("(9) passa quando a proposta e uma permutacao exata dos itens atuais", () => {
    const result = validateFullReorder({
      currentItemIds: [...IDS],
      proposedItemIds: [40n, 10n, 30n, 20n],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("(10) falha quando a cardinalidade diverge", () => {
    const result = validateFullReorder({
      currentItemIds: [...IDS],
      proposedItemIds: [10n, 20n, 30n],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("cardinalidade"))).toBe(true);
  });

  it("(11) falha quando a proposta contem id duplicado", () => {
    const result = validateFullReorder({
      currentItemIds: [...IDS],
      proposedItemIds: [10n, 20n, 20n, 30n],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicado"))).toBe(true);
  });

  it("(12) falha quando a proposta contem id estranho a lista", () => {
    const result = validateFullReorder({
      currentItemIds: [...IDS],
      proposedItemIds: [10n, 20n, 30n, 999n],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("nao pertence"))).toBe(true);
    expect(result.errors.some((e) => e.includes("omite"))).toBe(true);
  });
});

describe("buildPositionsFromOrder", () => {
  it("(13) devolve posicoes contiguas 0..n-1 na ordem dada", () => {
    expect(buildPositionsFromOrder([5n, 3n, 9n])).toEqual([
      { itemId: 5n, position: 0 },
      { itemId: 3n, position: 1 },
      { itemId: 9n, position: 2 },
    ]);
    expect(buildPositionsFromOrder([])).toEqual([]);
  });
});
