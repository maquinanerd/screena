/**
 * Consumo de tokens de uso unico (verificacao de email / reset de senha).
 *
 * PURO: sem rede, sem DB, sem relogio — `now` entra por parametro. O adapter
 * localiza o registro por `token_hash = hashSecret(tokenCru)` (o token cru
 * NUNCA e buscado nem persistido) e entrega o registro ja encontrado aqui.
 *
 * Replay-safe e anti-enumeracao: inexistente, expirado, ja consumido ou de
 * PROPOSITO errado retornam o MESMO resultado publico generico; o motivo real
 * fica so no `internalReason` (para audit), nunca no texto publico.
 */

import { err, ok } from "../core/result.js";
import type { AuthTokenPurpose } from "../core/types.js";
import { type AuthDecision, authDecision, GENERIC_TOKEN_FAILURE_MESSAGE } from "./types.js";

/** Estado minimo de um token ja localizado por hash pela persistencia. */
export interface StoredTokenRecord {
  readonly purpose: AuthTokenPurpose;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/** Motivo interno do consumo (audit); nunca vira texto publico. */
export type TokenConsumptionReason =
  | "ok"
  | "not_found"
  | "wrong_purpose"
  | "expired"
  | "already_consumed";

/**
 * Decide o consumo de um token de uso unico para um `expectedPurpose`.
 *
 * Fail-closed: qualquer condicao ruim => publicResult err generico. Expira
 * exatamente em `expiresAt` (`now >= expiresAt` ja e expirado). A ordem de
 * checagem (existencia -> proposito -> consumo -> expiracao) so afeta o
 * `internalReason`; o texto publico e SEMPRE identico.
 */
export function evaluateTokenConsumption(input: {
  readonly now: Date;
  readonly expectedPurpose: AuthTokenPurpose;
  readonly tokenRecord: StoredTokenRecord | null;
}): AuthDecision<{ consume: true }> {
  const record = input.tokenRecord;

  let reason: TokenConsumptionReason;
  if (record === null) {
    reason = "not_found";
  } else if (record.purpose !== input.expectedPurpose) {
    reason = "wrong_purpose";
  } else if (record.consumedAt !== null) {
    reason = "already_consumed";
  } else if (input.now.getTime() >= record.expiresAt.getTime()) {
    reason = "expired";
  } else {
    return authDecision(ok({ consume: true }), "ok");
  }

  return authDecision(err("unauthorized", GENERIC_TOKEN_FAILURE_MESSAGE), reason);
}
