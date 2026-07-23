/**
 * Testes das projecoes agregadas NEUTRAS de AVALIACAO DE USUARIO: estado neutro
 * para vazio, media/distribuicao corretas, separacao por tipo, dedupe
 * determinista, ausencia de NaN/Infinity, independencia de ordem e NAO
 * vazamento de userId. Nota fora da grade (inclui escalas externas) e ignorada.
 */

import { describe, expect, it } from "vitest";
import {
  computeUserRatingProjection,
  type RatingProjectionEntry,
  USER_RATING_DISTRIBUTION_KEYS,
} from "../projections.js";

function entry(overrides: Partial<RatingProjectionEntry> = {}): RatingProjectionEntry {
  return {
    userId: 1000n,
    entityType: "movie",
    entityId: 42n,
    value: 4,
    ratedAt: new Date("2026-07-20T12:00:00.000Z"),
    ...overrides,
  };
}

describe("computeUserRatingProjection — estado neutro", () => {
  it("(1) conjunto vazio retorna zeros e mostRecent null (sem NaN/Infinity)", () => {
    const p = computeUserRatingProjection([]);
    expect(p.count).toBe(0);
    expect(p.average).toBe(0);
    expect(p.uniqueUsers).toBe(0);
    expect(p.mostRecent).toBeNull();
    for (const key of USER_RATING_DISTRIBUTION_KEYS) {
      expect(p.distribution[key]).toBe(0);
    }
    for (const bucket of p.byEntityType) {
      expect(bucket.count).toBe(0);
      expect(bucket.average).toBe(0);
    }
    expect(Number.isFinite(p.average)).toBe(true);
  });

  it("(2) todas as entradas invalidas => estado neutro (nenhuma vira nota)", () => {
    const p = computeUserRatingProjection([
      entry({ entityType: "person" as never }),
      entry({ entityId: 0n }),
      entry({ ratedAt: new Date("nao-e-data") }),
      entry({ value: 3.3 }),
    ]);
    expect(p.count).toBe(0);
    expect(p.mostRecent).toBeNull();
  });
});

describe("computeUserRatingProjection — agregacao", () => {
  it("(3) media e distribuicao corretas", () => {
    const p = computeUserRatingProjection([
      entry({ entityId: 1n, value: 4 }),
      entry({ entityId: 2n, value: 5 }),
    ]);
    expect(p.count).toBe(2);
    expect(p.average).toBe(4.5);
    expect(p.distribution["4"]).toBe(1);
    expect(p.distribution["5"]).toBe(1);
    expect(p.distribution["0.5"]).toBe(0);
  });

  it("(4) mantem tipos de entidade separados (movie vs tv)", () => {
    const p = computeUserRatingProjection([
      entry({ entityType: "movie", entityId: 1n, value: 4 }),
      entry({ entityType: "movie", entityId: 2n, value: 5 }),
      entry({ entityType: "tv", entityId: 3n, value: 3 }),
    ]);
    const movie = p.byEntityType.find((b) => b.entityType === "movie");
    const tv = p.byEntityType.find((b) => b.entityType === "tv");
    const season = p.byEntityType.find((b) => b.entityType === "season");
    expect(movie).toEqual({ entityType: "movie", count: 2, average: 4.5 });
    expect(tv).toEqual({ entityType: "tv", count: 1, average: 3 });
    expect(season).toEqual({ entityType: "season", count: 0, average: 0 });
  });

  it("(5) nota fora da grade (3.3) e escala externa (8) sao ignoradas, nunca arredondadas", () => {
    const p = computeUserRatingProjection([
      entry({ entityId: 1n, value: 4 }),
      entry({ entityId: 2n, value: 3.3 }),
      entry({ entityId: 3n, value: 8 }),
    ]);
    expect(p.count).toBe(1);
    expect(p.average).toBe(4);
    // 3.3 nunca virou 3.5; 8 nunca entrou como nota.
    expect(p.distribution["3.5"]).toBe(0);
  });

  it("(6) media nunca produz NaN nem Infinity com uma unica nota", () => {
    const p = computeUserRatingProjection([entry({ value: 0.5 })]);
    expect(Number.isFinite(p.average)).toBe(true);
    expect(p.average).toBe(0.5);
  });
});

describe("computeUserRatingProjection — dedupe e determinismo", () => {
  it("(7) duplicidade logica (mesmo user+entidade) vence a mais recente", () => {
    const p = computeUserRatingProjection([
      entry({ userId: 1n, entityId: 42n, value: 2, ratedAt: new Date("2026-01-01T00:00:00Z") }),
      entry({ userId: 1n, entityId: 42n, value: 5, ratedAt: new Date("2026-06-01T00:00:00Z") }),
    ]);
    expect(p.count).toBe(1);
    expect(p.average).toBe(5);
    expect(p.mostRecent?.value).toBe(5);
  });

  it("(8) ordem de entrada NAO altera o resultado", () => {
    const entries: RatingProjectionEntry[] = [
      entry({ userId: 1n, entityId: 1n, value: 4, ratedAt: new Date("2026-02-01T00:00:00Z") }),
      entry({ userId: 2n, entityId: 1n, value: 5, ratedAt: new Date("2026-03-01T00:00:00Z") }),
      entry({ userId: 3n, entityType: "tv", entityId: 9n, value: 3, ratedAt: new Date("2026-01-01T00:00:00Z") }),
    ];
    const forward = computeUserRatingProjection(entries);
    const reversed = computeUserRatingProjection([...entries].reverse());
    const stable = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
    expect(stable(forward)).toEqual(stable(reversed));
  });

  it("(9) mostRecent seleciona a nota de maior ratedAt (empate determinista)", () => {
    const p = computeUserRatingProjection([
      entry({ userId: 1n, entityId: 1n, value: 4, ratedAt: new Date("2026-02-01T00:00:00Z") }),
      entry({ userId: 2n, entityId: 2n, value: 5, ratedAt: new Date("2026-05-01T00:00:00Z") }),
    ]);
    expect(p.mostRecent?.entityId).toBe(2n);
    expect(p.mostRecent?.value).toBe(5);
    expect(p.mostRecent?.ratedAt).toBe("2026-05-01T00:00:00.000Z");
  });
});

describe("computeUserRatingProjection — neutralidade / privacidade", () => {
  it("(10) userId NUNCA aparece na saida; apenas a cardinalidade uniqueUsers", () => {
    const p = computeUserRatingProjection([
      entry({ userId: 1000n, entityId: 1n, value: 4 }),
      entry({ userId: 2000n, entityId: 2n, value: 5 }),
      entry({ userId: 2000n, entityId: 3n, value: 3 }),
    ]);
    expect(p.uniqueUsers).toBe(2);
    const serialized = JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(serialized.includes("userId")).toBe(false);
    expect(serialized.includes("1000")).toBe(false);
    expect(serialized.includes("2000")).toBe(false);
  });

  it("(11) mostRecent nao expoe userId (so entityType/entityId/value/ratedAt)", () => {
    const p = computeUserRatingProjection([entry({ userId: 777n })]);
    expect(p.mostRecent && Object.keys(p.mostRecent).sort()).toEqual(
      ["entityId", "entityType", "ratedAt", "value"].sort(),
    );
  });
});
