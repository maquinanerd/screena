/**
 * hash.ts — Hash determinístico de payload/saída do Entity Writer.
 *
 * `stableStringify` serializa com chaves de objeto ordenadas recursivamente,
 * para que o hash NAO dependa da ordem das chaves. Usado para preencher
 * `input_hash` (payload controlado) e `output_hash` (saida gerada) — o
 * versionamento obrigatorio de `content_blocks` (invariante 13).
 *
 * WORKER/SERVER-ONLY: usa `node:crypto`. Este modulo nunca e importado pelo
 * render publico (apps/web) — a guarda `audit:render` bloqueia o import do
 * Entity Writer em `apps/web`.
 */

import { createHash } from "node:crypto";
import type { EntityPayload, EntityWriterOutput } from "../types.js";

/** Serializa um valor de forma determinística (chaves de objeto ordenadas). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortValue(source[key]);
    }
    return sorted;
  }
  return value;
}

/** SHA-256 hex de uma string. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Hash do payload controlado de entrada (`input_hash`). */
export function hashPayload(payload: EntityPayload): string {
  return sha256Hex(stableStringify(payload));
}

/** Hash da saída gerada (`output_hash`). */
export function hashOutput(output: EntityWriterOutput): string {
  return sha256Hex(stableStringify(output));
}
