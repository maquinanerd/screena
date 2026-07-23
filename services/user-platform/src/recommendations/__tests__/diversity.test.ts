/**
 * Testes de DIVERSIDADE (C6B). Provam que a diversidade respeita caps
 * (genero/franquia/tipo), repoe vagas, nao muda score/confianca/razoes, nao
 * depende da ordem de entrada, produz posicoes contiguas, nao duplica, nao muta
 * a entrada, falha fechado para politica/limite invalidos e nunca reintroduz
 * candidato fora do conjunto recebido (logo respeita licenca/display de C6A).
 */

import { describe, expect, it } from "vitest";
import { applyDiversity, diversityRefKey, type DiversityAttributes } from "../diversity.js";
import type { DiversityPolicy, RankedRecommendation } from "../types.js";

function reason(code: string, contribution: number) {
  return { code: code as never, contribution };
}

function ranked(
  entityType: string,
  entityId: number,
  score: number,
  confidence = score,
  reasons = [reason("genre_affinity", score)],
): RankedRecommendation {
  return { ref: { entityType, entityId: BigInt(entityId) }, score, confidence, position: 0, reasons };
}

function attrs(genres: string[], franchiseKey: string | null = null): DiversityAttributes {
  return { genres, franchiseKey };
}

function attrMap(
  entries: ReadonlyArray<[string, number, DiversityAttributes]>,
): ReadonlyMap<string, DiversityAttributes> {
  const m = new Map<string, DiversityAttributes>();
  for (const [type, id, a] of entries)
    m.set(diversityRefKey({ entityType: type, entityId: BigInt(id) }), a);
  return m;
}

const BASE_POLICY: DiversityPolicy = {
  version: "test-div",
  maxPerPrimaryGenre: 10,
  maxPerFranchise: 10,
  maxPerEntityType: 10,
  outputLimit: 100,
};

function refIds(items: readonly RankedRecommendation[]): string[] {
  return items.map((i) => `${i.ref.entityType}:${i.ref.entityId.toString()}`);
}

describe("applyDiversity: guardas e caps", () => {
  it("(1) entrada vazia retorna vazio", () => {
    const r = applyDiversity({ items: [], attributesByRefKey: new Map(), policy: BASE_POLICY, limit: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.items).toEqual([]);
      expect(r.value.audit.outputCount).toBe(0);
    }
  });

  it("(2) limite zero retorna vazio", () => {
    const items = [ranked("movie", 1, 0.9)];
    const r = applyDiversity({ items, attributesByRefKey: new Map(), policy: BASE_POLICY, limit: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items).toEqual([]);
  });

  it("(3) limite negativo e rejeitado (fail-closed)", () => {
    const r = applyDiversity({ items: [], attributesByRefKey: new Map(), policy: BASE_POLICY, limit: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("validation_failed");
  });

  it("(4) cap por genero e respeitado (troca drama excedente por outro genero)", () => {
    const items = [
      ranked("movie", 1, 0.9), // drama
      ranked("movie", 2, 0.8), // drama
      ranked("movie", 3, 0.7), // comedy
    ];
    const a = attrMap([
      ["movie", 1, attrs(["drama"])],
      ["movie", 2, attrs(["drama"])],
      ["movie", 3, attrs(["comedy"])],
    ]);
    const policy = { ...BASE_POLICY, maxPerPrimaryGenre: 1 };
    const r = applyDiversity({ items, attributesByRefKey: a, policy, limit: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(refIds(r.value.items)).toEqual(["movie:1", "movie:3"]);
      expect(r.value.audit.skippedByCap).toBe(1);
    }
  });

  it("(5) cap por franquia e respeitado quando ha franchiseKey", () => {
    const items = [ranked("movie", 1, 0.9), ranked("movie", 2, 0.8), ranked("movie", 3, 0.7)];
    const a = attrMap([
      ["movie", 1, attrs(["x"], "marvel")],
      ["movie", 2, attrs(["y"], "marvel")],
      ["movie", 3, attrs(["z"], "dc")],
    ]);
    const policy = { ...BASE_POLICY, maxPerFranchise: 1 };
    const r = applyDiversity({ items, attributesByRefKey: a, policy, limit: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(refIds(r.value.items)).toEqual(["movie:1", "movie:3"]);
  });

  it("(6) ausencia de franchiseKey NAO agrupa candidatos", () => {
    const items = [ranked("movie", 1, 0.9), ranked("movie", 2, 0.8), ranked("movie", 3, 0.7)];
    const a = attrMap([
      ["movie", 1, attrs(["x"], null)],
      ["movie", 2, attrs(["y"], null)],
      ["movie", 3, attrs(["z"], null)],
    ]);
    const policy = { ...BASE_POLICY, maxPerFranchise: 1 };
    const r = applyDiversity({ items, attributesByRefKey: a, policy, limit: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items.length).toBe(3); // franquia desconhecida = individual
  });

  it("(7) cap por tipo e respeitado", () => {
    const items = [ranked("movie", 1, 0.9), ranked("movie", 2, 0.8), ranked("tv", 3, 0.7)];
    const policy = { ...BASE_POLICY, maxPerEntityType: 1 };
    const r = applyDiversity({ items, attributesByRefKey: new Map(), policy, limit: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(refIds(r.value.items)).toEqual(["movie:1", "tv:3"]);
  });

  it("(8) proximos candidatos preenchem vagas (fallback relaxa caps)", () => {
    const items = [ranked("movie", 1, 0.9), ranked("movie", 2, 0.8), ranked("movie", 3, 0.7)];
    const a = attrMap([
      ["movie", 1, attrs(["drama"])],
      ["movie", 2, attrs(["drama"])],
      ["movie", 3, attrs(["drama"])],
    ]);
    const policy = { ...BASE_POLICY, maxPerPrimaryGenre: 1 };
    const r = applyDiversity({ items, attributesByRefKey: a, policy, limit: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(refIds(r.value.items)).toEqual(["movie:1", "movie:2", "movie:3"]);
      expect(r.value.audit.skippedByCap).toBe(0); // todos repostos
    }
  });
});

describe("applyDiversity: invariantes de preservacao", () => {
  it("(9) score e confianca nao mudam", () => {
    const items = [ranked("movie", 1, 0.9, 0.42), ranked("tv", 2, 0.5, 0.31)];
    const r = applyDiversity({ items, attributesByRefKey: new Map(), policy: BASE_POLICY, limit: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const byId = new Map(r.value.items.map((i) => [i.ref.entityId.toString(), i]));
      expect(byId.get("1")!.score).toBe(0.9);
      expect(byId.get("1")!.confidence).toBe(0.42);
      expect(byId.get("2")!.confidence).toBe(0.31);
    }
  });

  it("(10) razoes nao mudam", () => {
    const rs = [reason("genre_affinity", 0.4), reason("popular_in_catalog", 0.2)];
    const items = [ranked("movie", 1, 0.9, 0.9, rs)];
    const r = applyDiversity({ items, attributesByRefKey: new Map(), policy: BASE_POLICY, limit: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items[0]!.reasons).toEqual(rs);
  });

  it("(11) ordem de entrada NAO altera o resultado", () => {
    const a = [ranked("movie", 1, 0.9), ranked("tv", 2, 0.6), ranked("movie", 3, 0.3)];
    const shuffled = [a[2]!, a[0]!, a[1]!];
    const r1 = applyDiversity({ items: a, attributesByRefKey: new Map(), policy: BASE_POLICY, limit: 3 });
    const r2 = applyDiversity({ items: shuffled, attributesByRefKey: new Map(), policy: BASE_POLICY, limit: 3 });
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.value.items).toEqual(r2.value.items);
  });

  it("(12) posicoes sao contiguas", () => {
    const items = [ranked("movie", 1, 0.9), ranked("tv", 2, 0.6), ranked("movie", 3, 0.3)];
    const r = applyDiversity({ items, attributesByRefKey: new Map(), policy: BASE_POLICY, limit: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it("(13) nao cria duplicidade mesmo com ref repetida na entrada", () => {
    const items = [ranked("movie", 1, 0.9), ranked("movie", 1, 0.8)];
    const r = applyDiversity({ items, attributesByRefKey: new Map(), policy: BASE_POLICY, limit: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items.length).toBe(1);
  });

  it("(14) nao modifica a entrada", () => {
    const items = [ranked("movie", 1, 0.9), ranked("tv", 2, 0.6)];
    const before = JSON.stringify(items.map((i) => ({ ...i, ref: { ...i.ref, entityId: i.ref.entityId.toString() } })));
    applyDiversity({ items, attributesByRefKey: new Map(), policy: BASE_POLICY, limit: 1 });
    const after = JSON.stringify(items.map((i) => ({ ...i, ref: { ...i.ref, entityId: i.ref.entityId.toString() } })));
    expect(after).toBe(before);
    expect(items[0]!.position).toBe(0);
    expect(items[1]!.position).toBe(0);
  });

  it("(15) politica invalida falha fechado", () => {
    const items = [ranked("movie", 1, 0.9)];
    const zeroCap = { ...BASE_POLICY, maxPerPrimaryGenre: 0 };
    const negLimit = { ...BASE_POLICY, outputLimit: -5 };
    const emptyVersion = { ...BASE_POLICY, version: "" };
    expect(applyDiversity({ items, attributesByRefKey: new Map(), policy: zeroCap, limit: 10 }).ok).toBe(false);
    expect(applyDiversity({ items, attributesByRefKey: new Map(), policy: negLimit, limit: 10 }).ok).toBe(false);
    expect(applyDiversity({ items, attributesByRefKey: new Map(), policy: emptyVersion, limit: 10 }).ok).toBe(false);
  });

  it("(16/17) output e SUBCONJUNTO da entrada (nunca reintroduz inelegivel/sem licenca)", () => {
    // C6A ja excluiu inelegiveis/sem-licenca; a diversidade so escolhe do conjunto
    // recebido — jamais adiciona algo de fora.
    const items = [ranked("movie", 1, 0.9), ranked("tv", 2, 0.6)];
    const inputKeys = new Set(refIds(items));
    const r = applyDiversity({ items, attributesByRefKey: new Map(), policy: BASE_POLICY, limit: 50 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      for (const k of refIds(r.value.items)) expect(inputKeys.has(k)).toBe(true);
    }
  });
});
