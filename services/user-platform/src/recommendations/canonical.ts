/**
 * canonical.ts — JSON-safety, canonicalizacao e fingerprint (Backend C, C6B).
 *
 * PURO e DETERMINISTICO. Duas responsabilidades separadas:
 *  1. JSON-SAFETY: `collectJsonSafetyErrors`/`isJsonSafe` provam por VERIFICACAO
 *     DE TIPOS (nao por `JSON.stringify` cego) que um payload persistivel nao
 *     carrega BigInt, Date, Map, Set, undefined, NaN, Infinity, funcoes, classes
 *     ou referencias circulares.
 *  2. FINGERPRINT: `canonicalizeSnapshot` produz uma STRING canonica ESTAVEL
 *     (independente da ordem incidental de propriedades — usa arrays posicionais)
 *     dos campos SEMANTICOS do snapshot; `computeFingerprint` aplica uma
 *     `HashPort` INJETADA. A canonicalizacao e pura e separada do hash: o dominio
 *     nunca importa `node:crypto`. O adapter (C7) injeta `core/crypto.sha256Hex`.
 *
 * O fingerprint NAO considera `generatedAt`, `expiresAt`, `isCurrent`, ids de
 * banco nem dados pessoais — so o conteudo semantico (contexto, versoes,
 * parametros de diversidade e itens ordenados com score/confianca/razoes).
 */

import type { RankedRecommendation } from "./types.js";

/** Valor estritamente JSON-safe (sem BigInt/Date/undefined/NaN/Infinity/...). */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Porta de HASH injetada: recebe a string canonica e devolve um digest estavel.
 * O dominio nunca implementa criptografia — o adapter fornece (ex.:
 * `core/crypto.sha256Hex`). Sincrona e pura (mesma entrada => mesmo digest).
 */
export type HashPort = (input: string) => string;

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Acumula TODOS os motivos pelos quais `value` nao e JSON-safe (verificacao de
 * tipos real, com deteccao de ciclo por pilha de DFS). `[]` = seguro. Nunca
 * lanca.
 */
export function collectJsonSafetyErrors(value: unknown): string[] {
  const errors: string[] = [];
  const stack = new Set<object>();

  function walk(node: unknown, path: string): void {
    if (node === null) return;
    const t = typeof node;
    if (t === "boolean" || t === "string") return;
    if (t === "number") {
      if (!Number.isFinite(node as number)) {
        errors.push(`${path}: numero nao finito (NaN/Infinity)`);
      }
      return;
    }
    if (t === "bigint") {
      errors.push(`${path}: BigInt nao e JSON-safe`);
      return;
    }
    if (t === "undefined") {
      errors.push(`${path}: undefined nao e JSON-safe`);
      return;
    }
    if (t === "function" || t === "symbol") {
      errors.push(`${path}: ${t} nao e JSON-safe`);
      return;
    }
    // t === "object"
    const obj = node as object;
    if (stack.has(obj)) {
      errors.push(`${path}: referencia circular`);
      return;
    }
    if (obj instanceof Date) {
      errors.push(`${path}: Date nao e JSON-safe (use ISO string)`);
      return;
    }
    if (obj instanceof Map || obj instanceof Set) {
      errors.push(`${path}: ${obj.constructor.name} nao e JSON-safe`);
      return;
    }
    stack.add(obj);
    if (Array.isArray(obj)) {
      obj.forEach((el, i) => walk(el, `${path}[${i}]`));
    } else if (isPlainObject(obj)) {
      for (const key of Object.keys(obj)) {
        walk((obj as Record<string, unknown>)[key], `${path}.${key}`);
      }
    } else {
      errors.push(`${path}: objeto nao-plano (instancia de classe) nao e JSON-safe`);
    }
    stack.delete(obj);
  }

  walk(value, "$");
  return errors;
}

/** true quando `value` e estritamente JSON-safe. */
export function isJsonSafe(value: unknown): value is JsonValue {
  return collectJsonSafetyErrors(value).length === 0;
}

/** Casas decimais fixas para estabilizar floats no fingerprint. */
const FINGERPRINT_PRECISION = 1_000_000;

/** Numero estavel: arredonda finitos; nao-finitos viram sentinela distinta (defesa). */
function stableNumber(value: number): number | string {
  if (!Number.isFinite(value)) {
    return `NF:${String(value)}`;
  }
  return Math.round(value * FINGERPRINT_PRECISION) / FINGERPRINT_PRECISION;
}

/** Parametros de diversidade que participam da identidade semantica do snapshot. */
export interface CanonicalDiversityParams {
  readonly diversityPolicyVersion: string;
  readonly maxPerPrimaryGenre: number;
  readonly maxPerFranchise: number;
  readonly maxPerEntityType: number;
  readonly outputLimit: number;
}

/** Entrada SEMANTICA do fingerprint (sem tempo, sem ids de banco, sem PII). */
export interface CanonicalSnapshotInput {
  readonly context: string;
  readonly algorithmVersion: string;
  readonly policyVersion: string;
  readonly diversity: CanonicalDiversityParams;
  readonly items: readonly RankedRecommendation[];
}

/**
 * String canonica ESTAVEL do conteudo semantico. Usa arrays POSICIONAIS (nao
 * objetos) para que a ordem incidental de propriedades nunca afete o resultado;
 * a ordem dos ITENS e das RAZOES e preservada (e semantica). Muda quando muda
 * contexto/versoes/diversidade/ordem/refs/score/confianca/razoes; NAO muda com
 * generatedAt/expiresAt/isCurrent/ids de banco.
 */
export function canonicalizeSnapshot(input: CanonicalSnapshotInput): string {
  const d = input.diversity;
  const structure = [
    "cinerie-reco-snap",
    1,
    input.context,
    input.algorithmVersion,
    input.policyVersion,
    d.diversityPolicyVersion,
    [d.maxPerPrimaryGenre, d.maxPerFranchise, d.maxPerEntityType, d.outputLimit],
    input.items.map((it) => [
      it.ref.entityType,
      it.ref.entityId.toString(),
      stableNumber(it.score),
      stableNumber(it.confidence),
      it.reasons.map((r) => [r.code, stableNumber(r.contribution)]),
    ]),
  ];
  return JSON.stringify(structure);
}

/** Fingerprint = hash injetado sobre a string canonica. Determinstico. */
export function computeFingerprint(canonical: string, hash: HashPort): string {
  return hash(canonical);
}
