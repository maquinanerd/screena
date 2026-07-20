/**
 * projections.ts — Projecoes AGREGADAS NEUTRAS da AVALIACAO DE USUARIO
 * (Backend C, unidade C5A).
 *
 * PURO e DETERMINISTICO: sem rede, sem DB, sem relogio. Deriva numeros a partir
 * de uma lista de notas ja lida pela camada de persistencia. Regras de ouro:
 *  - nota fora da grade 0.5..5.0 (passo 0.5) e IGNORADA, nunca arredondada;
 *  - escala fixa 5; NUNCA entra nota de fonte externa nem Cinerie Score;
 *  - `userId` NUNCA aparece na saida — apenas sua CARDINALIDADE (uniqueUsers);
 *  - conjunto vazio => estado neutro (zeros / null); sem divisao por zero, sem
 *    NaN, sem Infinity;
 *  - duplicidade logica (mesmo user + entidade) e deduplicada de forma
 *    determinista, independente da ordem de entrada.
 *
 * NAO faz ranking complexo nem recomendacao (fora de escopo desta unidade).
 */

import {
  isRatableEntityType,
  RATABLE_ENTITY_TYPES,
  type RatableEntityType,
  toHalfStarUnits,
  USER_RATING_MIN,
  USER_RATING_SCALE,
} from "./types.js";

/** Chaves canonicas da distribuicao (0.5..5.0, passo 0.5) — sempre presentes. */
export const USER_RATING_DISTRIBUTION_KEYS = [
  "0.5",
  "1",
  "1.5",
  "2",
  "2.5",
  "3",
  "3.5",
  "4",
  "4.5",
  "5",
] as const;
export type UserRatingDistributionKey = (typeof USER_RATING_DISTRIBUTION_KEYS)[number];

/** Uma nota de usuario ja persistida — entrada da projecao. */
export interface RatingProjectionEntry {
  readonly userId: bigint;
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
  readonly value: number;
  readonly ratedAt: Date;
}

/** Media e contagem de UM tipo de entidade (mantidos separados por tipo). */
export interface EntityTypeAverage {
  readonly entityType: RatableEntityType;
  readonly count: number;
  readonly average: number;
}

/** Nota mais recente do conjunto — SEM userId (neutra). */
export interface MostRecentRating {
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
  readonly value: number;
  /** ISO 8601 (nunca Date mutavel na saida). */
  readonly ratedAt: string;
}

/** Snapshot agregado neutro das notas de usuario. */
export interface UserRatingProjection {
  readonly count: number;
  /** Media com 1 casa decimal (0 quando nao ha nota valida). */
  readonly average: number;
  readonly distribution: Record<UserRatingDistributionKey, number>;
  readonly byEntityType: ReadonlyArray<EntityTypeAverage>;
  readonly mostRecent: MostRecentRating | null;
  readonly uniqueUsers: number;
}

/** Arredonda para 1 casa decimal de forma estavel. */
function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Mapeia uma nota para a chave canonica da distribuicao. Nota fora da grade
 * 0.5..5.0 passo 0.5 => null (ignorada, nunca arredondada).
 */
function valueToDistributionKey(value: number): UserRatingDistributionKey | null {
  if (!Number.isFinite(value) || value < USER_RATING_MIN || value > USER_RATING_SCALE) {
    return null;
  }
  if (!Number.isInteger(value * 2)) {
    return null;
  }
  const key = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return (USER_RATING_DISTRIBUTION_KEYS as readonly string[]).includes(key)
    ? (key as UserRatingDistributionKey)
    : null;
}

/** Distribuicao zerada com TODAS as 10 chaves presentes. */
function emptyDistribution(): Record<UserRatingDistributionKey, number> {
  const distribution = {} as Record<UserRatingDistributionKey, number>;
  for (const key of USER_RATING_DISTRIBUTION_KEYS) {
    distribution[key] = 0;
  }
  return distribution;
}

/**
 * Ordem estrita e TOTAL entre notas: mais recente vence; empate de instante
 * -> maior valor; empate de valor -> ordem canonica de tipo, depois entityId.
 * Deterministica e independente da ordem de entrada.
 */
function isPreferred(a: RatingProjectionEntry, b: RatingProjectionEntry): boolean {
  const ta = a.ratedAt.getTime();
  const tb = b.ratedAt.getTime();
  if (ta !== tb) {
    return ta > tb;
  }
  const ha = toHalfStarUnits(a.value);
  const hb = toHalfStarUnits(b.value);
  if (ha !== hb) {
    return ha > hb;
  }
  const oa = RATABLE_ENTITY_TYPES.indexOf(a.entityType);
  const ob = RATABLE_ENTITY_TYPES.indexOf(b.entityType);
  if (oa !== ob) {
    return oa < ob;
  }
  return a.entityId < b.entityId;
}

/**
 * Projecao deterministica das notas de usuario. Mesma entrada (em qualquer
 * ordem) => mesma saida. Entradas invalidas (ref nao avaliavel, id nao
 * positivo, ratedAt invalido, nota fora da grade) sao descartadas.
 */
export function computeUserRatingProjection(
  entries: ReadonlyArray<RatingProjectionEntry>,
): UserRatingProjection {
  // 1. Mantem so notas validas.
  const valid = entries.filter(
    (entry) =>
      isRatableEntityType(entry.entityType) &&
      entry.entityId > 0n &&
      Number.isFinite(entry.ratedAt.getTime()) &&
      valueToDistributionKey(entry.value) !== null,
  );

  // 2. Dedupe determinista por (userId, entityType, entityId): vence a nota
  //    preferida (mais recente). Independe da ordem de entrada.
  const byKey = new Map<string, RatingProjectionEntry>();
  for (const entry of valid) {
    const key = `${entry.userId.toString()}|${entry.entityType}|${entry.entityId.toString()}`;
    const kept = byKey.get(key);
    if (kept === undefined || isPreferred(entry, kept)) {
      byKey.set(key, entry);
    }
  }
  const deduped = [...byKey.values()];

  // 3. Agregacoes neutras (uma unica passada).
  const distribution = emptyDistribution();
  const uniqueUsers = new Set<string>();
  const perType = new Map<RatableEntityType, { count: number; sum: number }>();
  let sum = 0;
  let mostRecent: RatingProjectionEntry | null = null;

  for (const entry of deduped) {
    const key = valueToDistributionKey(entry.value);
    if (key === null) {
      continue; // ja filtrado; guarda defensiva
    }
    distribution[key] += 1;
    sum += entry.value;
    uniqueUsers.add(entry.userId.toString());

    const bucket = perType.get(entry.entityType) ?? { count: 0, sum: 0 };
    bucket.count += 1;
    bucket.sum += entry.value;
    perType.set(entry.entityType, bucket);

    if (mostRecent === null || isPreferred(entry, mostRecent)) {
      mostRecent = entry;
    }
  }

  const count = deduped.length;
  const average = count === 0 ? 0 : roundTo1(sum / count);

  const byEntityType: EntityTypeAverage[] = RATABLE_ENTITY_TYPES.map((entityType) => {
    const bucket = perType.get(entityType);
    return {
      entityType,
      count: bucket?.count ?? 0,
      average: bucket !== undefined && bucket.count > 0 ? roundTo1(bucket.sum / bucket.count) : 0,
    };
  });

  return {
    count,
    average,
    distribution,
    byEntityType,
    mostRecent:
      mostRecent === null
        ? null
        : {
            entityType: mostRecent.entityType,
            entityId: mostRecent.entityId,
            value: mostRecent.value,
            ratedAt: mostRecent.ratedAt.toISOString(),
          },
    uniqueUsers: uniqueUsers.size,
  };
}
