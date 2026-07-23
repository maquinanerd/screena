/**
 * policy.ts — Politica pura de REVIEWS (Backend C, unidade C5B).
 *
 * PURO: sem rede, sem DB, sem relogio. Concentra os GATES e guards que as
 * mutacoes reutilizam, sem duplicar regra:
 *  - gate de mutacao do AUTOR (delega a privacy.assertCanMutate — so `active`);
 *  - guard de visibilidade (enum real Visibility).
 *
 * SEPARACAO DE ORIGENS: acao do AUTOR e gated por estado da conta; acao de
 * MODERACAO e administrativa e NAO reutiliza este gate (pressupoe contexto
 * autorizado — RBAC concreto fica para fase futura). A validacao de moderacao
 * (revisor humano identificado) vive em moderation.ts.
 */

import type { DomainResult } from "../core/result.js";
import { VISIBILITIES, type UserStatus, type Visibility } from "../core/types.js";
import { assertCanMutate } from "../privacy/deletion.js";

/**
 * Toda mutacao do AUTOR sobre a propria review exige conta `active`. disabled /
 * pending_deletion / deleted / estado desconhecido sao bloqueados (fail-closed).
 * Delegado a privacy/deletion.assertCanMutate — mesma fonte de status do resto
 * do produto.
 */
export function assertAuthorMutationAllowed(accountStatus: UserStatus): DomainResult<true> {
  return assertCanMutate(accountStatus);
}

const VISIBILITY_SET: ReadonlySet<string> = new Set(VISIBILITIES);

/** Guard fail-closed: valor e um Visibility canonico (private|unlisted|public). */
export function isVisibility(value: unknown): value is Visibility {
  return typeof value === "string" && VISIBILITY_SET.has(value);
}
