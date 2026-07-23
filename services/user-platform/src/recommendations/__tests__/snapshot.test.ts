/**
 * Testes de SNAPSHOT + canonicalizacao/fingerprint + tempo puro (C6B). Provam:
 * ranking valido -> snapshot; itens JSON-safe (sem Date/BigInt/NaN/Infinity/
 * undefined); fingerprint determinista e sensivel a mudanca SEMANTICA porem
 * insensivel a generatedAt e a ordem incidental de propriedades; ausencia de PII
 * e de userId no envelope JSON; e conversao epoch->ISO identica ao oraculo.
 */

import { describe, expect, it } from "vitest";
import {
  canonicalizeSnapshot,
  collectJsonSafetyErrors,
  isJsonSafe,
} from "../canonical.js";
import type { DiversifiedRanking } from "../diversity.js";
import { DEFAULT_DIVERSITY_POLICY, DEFAULT_SNAPSHOT_POLICY } from "../policy.js";
import { buildRecommendationSnapshot, type BuildSnapshotInput } from "../snapshot.js";
import { epochMillisToIsoUtc, isValidEpochMillis, MAX_EPOCH_MS } from "../time.js";
import type { RankedRecommendation } from "../types.js";

// Hash determinista PURO (FNV-1a 32-bit) — o dominio recebe a HashPort injetada;
// em producao o adapter passa core/crypto.sha256Hex.
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function reason(code: string, contribution: number) {
  return { code: code as never, contribution };
}

function item(
  type: string,
  id: number,
  score: number,
  position: number,
  confidence = score,
  reasons = [reason("genre_affinity", score)],
): RankedRecommendation {
  return { ref: { entityType: type, entityId: BigInt(id) }, score, confidence, position, reasons };
}

function diversified(items: RankedRecommendation[], skippedByCap = 0): DiversifiedRanking {
  return {
    items,
    audit: {
      policyVersion: DEFAULT_DIVERSITY_POLICY.version,
      appliedCaps: {
        maxPerPrimaryGenre: DEFAULT_DIVERSITY_POLICY.maxPerPrimaryGenre,
        maxPerFranchise: DEFAULT_DIVERSITY_POLICY.maxPerFranchise,
        maxPerEntityType: DEFAULT_DIVERSITY_POLICY.maxPerEntityType,
        outputLimit: DEFAULT_DIVERSITY_POLICY.outputLimit,
        effectiveLimit: DEFAULT_DIVERSITY_POLICY.outputLimit,
      },
      inputCount: items.length,
      outputCount: items.length,
      skippedByCap,
    },
  };
}

const NOW = 1_700_000_000_000;

function baseInput(overrides: Partial<BuildSnapshotInput> = {}): BuildSnapshotInput {
  return {
    ownerUserId: 7n,
    context: "discovery",
    algorithmVersion: "reco-v1",
    policyVersion: "reco-v1",
    diversified: diversified([
      item("movie", 1, 0.9, 0, 0.8, [reason("genre_affinity", 0.5), reason("popular_in_catalog", 0.2)]),
      item("tv", 2, 0.6, 1, 0.5),
    ]),
    diversityPolicy: DEFAULT_DIVERSITY_POLICY,
    snapshotPolicy: DEFAULT_SNAPSHOT_POLICY,
    now: NOW,
    hash: fnv1a,
    ...overrides,
  };
}

function fp(overrides: Partial<BuildSnapshotInput> = {}): string {
  const r = buildRecommendationSnapshot(baseInput(overrides));
  if (!r.ok) throw new Error(`esperava ok: ${r.error.details?.join(";")}`);
  return r.value.fingerprint;
}

function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const el of value) collectKeys(el, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

describe("buildRecommendationSnapshot: construcao e JSON-safety", () => {
  it("(1) ranking valido produz snapshot", () => {
    const r = buildRecommendationSnapshot(baseInput());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.record.ownerUserId).toBe(7n);
      expect(r.value.payload.items.length).toBe(2);
      expect(r.value.payload.contractVersion).toBe("cinerie-reco-snap-1");
    }
  });

  it("(2) snapshot vazio segue a politica (proibido por padrao; permitido se allowEmpty)", () => {
    const empty = baseInput({ diversified: diversified([]) });
    expect(buildRecommendationSnapshot(empty).ok).toBe(false);
    const allow = baseInput({
      diversified: diversified([]),
      snapshotPolicy: { ...DEFAULT_SNAPSHOT_POLICY, allowEmptySnapshot: true },
    });
    const r = buildRecommendationSnapshot(allow);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.payload.items).toEqual([]);
  });

  it("(3) itens preservam ordem e posicao", () => {
    const r = buildRecommendationSnapshot(baseInput());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.payload.items.map((i) => i.entityId)).toEqual(["1", "2"]);
      expect(r.value.payload.items.map((i) => i.position)).toEqual([0, 1]);
    }
  });

  it("(4) payload e estritamente JSON-safe (sem Date/BigInt/NaN/Infinity/undefined)", () => {
    const r = buildRecommendationSnapshot(baseInput());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(collectJsonSafetyErrors(r.value.payload)).toEqual([]);
      expect(isJsonSafe(r.value.payload)).toBe(true);
      // round-trip: undefined seria descartado e quebraria a igualdade
      expect(JSON.parse(JSON.stringify(r.value.payload))).toEqual(r.value.payload);
    }
  });

  it("(5) entityId sai como STRING; datas como ISO UTC; expiresAt null-avel", () => {
    const r = buildRecommendationSnapshot(baseInput());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(typeof r.value.payload.items[0]!.entityId).toBe("string");
      expect(r.value.payload.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(r.value.payload.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const noTtl = buildRecommendationSnapshot(
        baseInput({ snapshotPolicy: { ...DEFAULT_SNAPSHOT_POLICY, ttlMs: null } }),
      );
      if (noTtl.ok) expect(noTtl.value.payload.expiresAt).toBeNull();
    }
  });

  it("(6) NaN e Infinity nos itens sao rejeitados (fail-closed)", () => {
    const nan = baseInput({ diversified: diversified([item("movie", 1, Number.NaN, 0)]) });
    const inf = baseInput({ diversified: diversified([item("movie", 1, 0.5, 0, Number.POSITIVE_INFINITY)]) });
    const badReason = baseInput({
      diversified: diversified([item("movie", 1, 0.5, 0, 0.5, [reason("genre_affinity", Number.POSITIVE_INFINITY)])]),
    });
    expect(buildRecommendationSnapshot(nan).ok).toBe(false);
    expect(buildRecommendationSnapshot(inf).ok).toBe(false);
    expect(buildRecommendationSnapshot(badReason).ok).toBe(false);
  });

  it("(7) algorithmVersion em branco e ownerUserId invalido falham (CHECK do banco)", () => {
    expect(buildRecommendationSnapshot(baseInput({ algorithmVersion: "  " })).ok).toBe(false);
    expect(buildRecommendationSnapshot(baseInput({ ownerUserId: 0n })).ok).toBe(false);
  });

  it("(8) TTL que estoura a faixa de epoch e rejeitado", () => {
    const r = buildRecommendationSnapshot(
      baseInput({ snapshotPolicy: { ...DEFAULT_SNAPSHOT_POLICY, ttlMs: MAX_EPOCH_MS } }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("buildRecommendationSnapshot: privacidade do envelope", () => {
  it("(1) payload NAO contem userId/ownerUserId nem PII", () => {
    const r = buildRecommendationSnapshot(baseInput());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const keys = collectKeys(r.value.payload);
      for (const forbidden of [
        "userId",
        "ownerUserId",
        "email",
        "password",
        "token",
        "session",
        "ipHash",
        "reviewBody",
        "moderationNote",
        "reportReason",
      ]) {
        expect(keys.has(forbidden)).toBe(false);
      }
      // O id do dono nao aparece serializado no envelope.
      expect(JSON.stringify(r.value.payload).includes('"7"')).toBe(false);
    }
  });

  it("(2) payload NAO carrega Cinerie Score nem rating externo", () => {
    const r = buildRecommendationSnapshot(baseInput());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const keys = collectKeys(r.value.payload);
      for (const forbidden of ["cinerieScore", "ratingSource", "providerApi", "externalRating"]) {
        expect(keys.has(forbidden)).toBe(false);
      }
    }
  });
});

describe("fingerprint: determinista e semantico", () => {
  it("(1) determinista para a mesma entrada", () => {
    expect(fp()).toBe(fp());
  });

  it("(2) generatedAt (now) NAO altera o fingerprint", () => {
    expect(fp({ now: NOW })).toBe(fp({ now: NOW + 999_999 }));
  });

  it("(3) ordem dos itens altera o fingerprint", () => {
    const reversed = diversified([
      item("tv", 2, 0.6, 0, 0.5),
      item("movie", 1, 0.9, 1, 0.8, [reason("genre_affinity", 0.5), reason("popular_in_catalog", 0.2)]),
    ]);
    expect(fp({ diversified: reversed })).not.toBe(fp());
  });

  it("(4) score alterado altera o fingerprint", () => {
    const changed = diversified([
      item("movie", 1, 0.9, 0, 0.8, [reason("genre_affinity", 0.5), reason("popular_in_catalog", 0.2)]),
      item("tv", 2, 0.61, 1, 0.5),
    ]);
    expect(fp({ diversified: changed })).not.toBe(fp());
  });

  it("(5) razao alterada altera o fingerprint", () => {
    const changed = diversified([
      item("movie", 1, 0.9, 0, 0.8, [reason("similar_to_watched", 0.5), reason("popular_in_catalog", 0.2)]),
      item("tv", 2, 0.6, 1, 0.5),
    ]);
    expect(fp({ diversified: changed })).not.toBe(fp());
  });

  it("(6) versao de algoritmo e de politica alteram o fingerprint", () => {
    expect(fp({ algorithmVersion: "reco-v2" })).not.toBe(fp());
    expect(fp({ policyVersion: "reco-v2" })).not.toBe(fp());
  });

  it("(7) confianca alterada altera o fingerprint", () => {
    const changed = diversified([
      item("movie", 1, 0.9, 0, 0.7, [reason("genre_affinity", 0.5), reason("popular_in_catalog", 0.2)]),
      item("tv", 2, 0.6, 1, 0.5),
    ]);
    expect(fp({ diversified: changed })).not.toBe(fp());
  });
});

describe("canonicalizeSnapshot: estabilidade", () => {
  it("(1) ordem incidental de propriedades NAO altera a string canonica", () => {
    const items: RankedRecommendation[] = [item("movie", 1, 0.9, 0, 0.8)];
    const a = canonicalizeSnapshot({
      context: "discovery",
      algorithmVersion: "reco-v1",
      policyVersion: "reco-v1",
      diversity: {
        diversityPolicyVersion: "d",
        maxPerPrimaryGenre: 3,
        maxPerFranchise: 2,
        maxPerEntityType: 20,
        outputLimit: 20,
      },
      items,
    });
    // mesmos valores, objeto `diversity` declarado com outra ordem de chaves
    const b = canonicalizeSnapshot({
      items,
      policyVersion: "reco-v1",
      algorithmVersion: "reco-v1",
      context: "discovery",
      diversity: {
        outputLimit: 20,
        maxPerEntityType: 20,
        maxPerFranchise: 2,
        maxPerPrimaryGenre: 3,
        diversityPolicyVersion: "d",
      },
    });
    expect(a).toBe(b);
  });
});

describe("time: epoch <-> ISO puro (sem new Date)", () => {
  it("(1) isValidEpochMillis e fail-closed", () => {
    expect(isValidEpochMillis(0)).toBe(true);
    expect(isValidEpochMillis(NOW)).toBe(true);
    expect(isValidEpochMillis(-1)).toBe(false);
    expect(isValidEpochMillis(1.5)).toBe(false);
    expect(isValidEpochMillis(Number.NaN)).toBe(false);
    expect(isValidEpochMillis(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidEpochMillis(MAX_EPOCH_MS + 1)).toBe(false);
  });

  it("(2) epochMillisToIsoUtc bate byte a byte com o oraculo do runtime", () => {
    const samples = [
      0,
      1000,
      NOW,
      NOW + 123,
      1_600_000_000_500,
      MAX_EPOCH_MS,
      Date.UTC(2000, 1, 29, 23, 59, 59, 999), // ano bissexto
      Date.UTC(2024, 11, 31, 0, 0, 0, 1),
    ];
    for (const ms of samples) {
      // oraculo: new Date so em TESTE (o boundary scan cobre apenas o codigo-fonte)
      expect(epochMillisToIsoUtc(ms)).toBe(new Date(ms).toISOString());
    }
  });
});
