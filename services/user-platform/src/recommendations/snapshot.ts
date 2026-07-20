/**
 * snapshot.ts — Construcao do snapshot PERSISTIVEL de recomendacoes (C6B).
 *
 * PURO e DETERMINISTICO. Transforma o ranking DIVERSIFICADO numa FOTOGRAFIA
 * imutavel e minimizada, pronta para C7 persistir em `user_recommendation_snapshots`.
 * NAO escreve no banco, NAO promove (is_current fica com a transacao), NAO
 * recalcula ranking, NAO inventa razoes.
 *
 * MAPA schema (SCHEMA_GAP registrado): a tabela tem colunas fixas
 * `user_id`, `algorithm_version`, `generated_at`, `items(Json)`, `is_current`,
 * `created_at`. NAO existem colunas para `policy_version`, `fingerprint` nem
 * `expires_at`. Como o unico campo livre e o Json `items`, o snapshot persiste um
 * ENVELOPE nesse Json (`SnapshotPayload`) que carrega policyVersion, fingerprint,
 * expiresAt e a auditoria de diversidade. `algorithm_version`/`generated_at` sao
 * duplicados nas colunas proprias (queryaveis). O envelope e estritamente
 * JSON-safe: sem BigInt (entityId vira string), sem Date (datas em ISO UTC), sem
 * undefined/NaN/Infinity. `user_id` fica SO na coluna (owner) — nunca no Json.
 */

import { type DomainResult, err, ok } from "../core/result.js";
import {
  canonicalizeSnapshot,
  collectJsonSafetyErrors,
  computeFingerprint,
  type HashPort,
} from "./canonical.js";
import { type DiversifiedRanking, diversityRefKey } from "./diversity.js";
import { epochMillisToIsoUtc, isValidEpochMillis, MAX_EPOCH_MS } from "./time.js";
import type {
  DiversityPolicy,
  RankedRecommendation,
  RecommendationContext,
  SnapshotPolicy,
} from "./types.js";

/** Versao do contrato do envelope JSON (permite migracao futura do reader). */
export const SNAPSHOT_CONTRACT_VERSION = "cinerie-reco-snap-1" as const;

/** Razao explicavel serializada (JSON-safe). */
export interface PersistableReason {
  readonly code: string;
  readonly contribution: number;
}

/** Item do snapshot em forma JSON-safe (entityId como string; sem PII). */
export interface PersistableSnapshotItem {
  readonly entityType: string;
  readonly entityId: string;
  readonly score: number;
  readonly confidence: number;
  readonly position: number;
  readonly reasons: readonly PersistableReason[];
}

/** Auditoria de diversidade dentro do envelope (metadata interna). */
export interface SnapshotDiversityAudit {
  readonly policyVersion: string;
  readonly appliedCaps: {
    readonly maxPerPrimaryGenre: number;
    readonly maxPerFranchise: number;
    readonly maxPerEntityType: number;
    readonly outputLimit: number;
  };
  readonly skippedCandidates: number;
}

/** Envelope persistido na coluna Json `items`. Estritamente JSON-safe. */
export interface SnapshotPayload {
  readonly contractVersion: string;
  readonly context: RecommendationContext;
  readonly algorithmVersion: string;
  readonly policyVersion: string;
  readonly fingerprint: string;
  readonly generatedAt: string;
  readonly expiresAt: string | null;
  readonly diversity: SnapshotDiversityAudit;
  readonly items: readonly PersistableSnapshotItem[];
}

/** Registro persistivel: colunas + envelope. `ownerUserId` NAO entra no Json. */
export interface PersistableSnapshotRecord {
  readonly ownerUserId: bigint;
  readonly algorithmVersion: string;
  readonly generatedAt: string;
  readonly payload: SnapshotPayload;
}

/** Resultado da construcao (record + metadados uteis ao planner de publicacao). */
export interface BuiltSnapshot {
  readonly record: PersistableSnapshotRecord;
  readonly payload: SnapshotPayload;
  readonly fingerprint: string;
  readonly canonical: string;
  readonly generatedAtMs: number;
  readonly expiresAtMs: number | null;
}

export interface BuildSnapshotInput {
  readonly ownerUserId: bigint;
  readonly context: RecommendationContext;
  readonly algorithmVersion: string;
  readonly policyVersion: string;
  readonly diversified: DiversifiedRanking;
  readonly diversityPolicy: DiversityPolicy;
  readonly snapshotPolicy: SnapshotPolicy;
  readonly now: number;
  readonly hash: HashPort;
}

function itemsHaveContiguousPositions(items: readonly RankedRecommendation[]): boolean {
  for (let i = 0; i < items.length; i += 1) {
    if (items[i]!.position !== i) return false;
  }
  return true;
}

function finiteUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Constroi o snapshot persistivel. Fail-closed: owner/versao/tempo/itens
 * invalidos, snapshot vazio sem permissao de politica, TTL invalido ou payload
 * nao JSON-safe => validation_failed (nunca lanca em caminho normal).
 */
export function buildRecommendationSnapshot(
  input: BuildSnapshotInput,
): DomainResult<BuiltSnapshot> {
  const errors: string[] = [];

  if (typeof input.ownerUserId !== "bigint" || input.ownerUserId <= 0n) {
    errors.push("ownerUserId invalido (deve ser BigInt positivo)");
  }
  if (typeof input.algorithmVersion !== "string" || input.algorithmVersion.trim().length === 0) {
    errors.push("algorithmVersion vazio (CHECK do banco: btrim <> '')");
  }
  if (typeof input.policyVersion !== "string" || input.policyVersion.length === 0) {
    errors.push("policyVersion vazio");
  }
  if (typeof input.diversityPolicy.version !== "string" || input.diversityPolicy.version.length === 0) {
    errors.push("diversityPolicy.version vazio");
  }
  if (!isValidEpochMillis(input.now)) {
    errors.push("now (epoch-ms) invalido");
  }

  const ttlMs = input.snapshotPolicy.ttlMs;
  if (ttlMs !== null && (!Number.isInteger(ttlMs) || ttlMs < 0)) {
    errors.push("ttlMs invalido (deve ser inteiro >= 0 ou null)");
  }

  const items = input.diversified.items;
  if (items.length === 0 && !input.snapshotPolicy.allowEmptySnapshot) {
    errors.push("snapshot vazio nao permitido pela politica");
  }
  if (!itemsHaveContiguousPositions(items)) {
    errors.push("posicoes dos itens nao sao contiguas (0..n-1)");
  }
  const seenRefs = new Set<string>();
  for (const it of items) {
    const key = diversityRefKey(it.ref);
    if (seenRefs.has(key)) {
      errors.push(`ref duplicada no snapshot: ${key}`);
    }
    seenRefs.add(key);
    if (!finiteUnit(it.score) || !finiteUnit(it.confidence)) {
      errors.push(`score/confianca invalidos em ${key}`);
    }
    for (const r of it.reasons) {
      if (!Number.isFinite(r.contribution)) {
        errors.push(`contribuicao de razao invalida em ${key}`);
      }
    }
  }

  if (errors.length > 0) {
    return err("validation_failed", "snapshot de recomendacao invalido.", errors);
  }

  const generatedAtMs = input.now;
  let expiresAtMs: number | null = null;
  if (ttlMs !== null) {
    const candidate = generatedAtMs + ttlMs;
    if (candidate > MAX_EPOCH_MS) {
      return err("validation_failed", "snapshot de recomendacao invalido.", [
        "expiresAt (now + ttlMs) fora da faixa suportada",
      ]);
    }
    expiresAtMs = candidate;
  }

  const generatedAtIso = epochMillisToIsoUtc(generatedAtMs);
  const expiresAtIso = expiresAtMs === null ? null : epochMillisToIsoUtc(expiresAtMs);

  const persistableItems: PersistableSnapshotItem[] = items.map((it) => ({
    entityType: it.ref.entityType,
    entityId: it.ref.entityId.toString(),
    score: it.score,
    confidence: it.confidence,
    position: it.position,
    reasons: it.reasons.map((r) => ({ code: r.code, contribution: r.contribution })),
  }));

  const dp = input.diversityPolicy;
  const canonical = canonicalizeSnapshot({
    context: input.context,
    algorithmVersion: input.algorithmVersion,
    policyVersion: input.policyVersion,
    diversity: {
      diversityPolicyVersion: dp.version,
      maxPerPrimaryGenre: dp.maxPerPrimaryGenre,
      maxPerFranchise: dp.maxPerFranchise,
      maxPerEntityType: dp.maxPerEntityType,
      outputLimit: dp.outputLimit,
    },
    items,
  });
  const fingerprint = computeFingerprint(canonical, input.hash);

  const payload: SnapshotPayload = {
    contractVersion: SNAPSHOT_CONTRACT_VERSION,
    context: input.context,
    algorithmVersion: input.algorithmVersion,
    policyVersion: input.policyVersion,
    fingerprint,
    generatedAt: generatedAtIso,
    expiresAt: expiresAtIso,
    diversity: {
      policyVersion: dp.version,
      appliedCaps: {
        maxPerPrimaryGenre: dp.maxPerPrimaryGenre,
        maxPerFranchise: dp.maxPerFranchise,
        maxPerEntityType: dp.maxPerEntityType,
        outputLimit: dp.outputLimit,
      },
      skippedCandidates: input.diversified.audit.skippedByCap,
    },
    items: persistableItems,
  };

  // Garantia final anti-vazamento: o envelope tem de ser estritamente JSON-safe.
  const jsonErrors = collectJsonSafetyErrors(payload);
  if (jsonErrors.length > 0) {
    return err("validation_failed", "payload do snapshot nao e JSON-safe.", jsonErrors);
  }

  const record: PersistableSnapshotRecord = {
    ownerUserId: input.ownerUserId,
    algorithmVersion: input.algorithmVersion,
    generatedAt: generatedAtIso,
    payload,
  };

  return ok({ record, payload, fingerprint, canonical, generatedAtMs, expiresAtMs });
}
