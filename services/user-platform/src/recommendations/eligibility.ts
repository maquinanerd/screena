/**
 * eligibility.ts — Elegibilidade e exclusoes de candidatos (Backend C, C6A).
 *
 * PURO: sem rede, sem DB, sem relogio. Aplica as EXCLUSOES OBRIGATORIAS (secao
 * 9: watched salvo rewatch, not_interested, bloqueadas por licenca) e as regras
 * por CONTEXTO. FAIL-CLOSED: flag ausente/false, estado desconhecido, sinal
 * numerico invalido e tipo nao recomendavel => EXCLUI. O dominio NAO decide
 * legalidade — recebe displayEligible/licenseEligible/territoryEligible ja
 * resolvidos externamente.
 *
 * Contextos NUNCA se misturam:
 *  - discovery/similar: so entidades NAO engajadas (novas); similar exclui a
 *    propria entidade de contexto;
 *  - continue_watching: exige progresso real (watching/paused + hasProgress);
 *  - rewatch: exige ter assistido antes (watched/rewatching).
 */

import { WATCH_STATES } from "../core/types.js";
import {
  DISCOVERY_ENTITY_TYPES,
  PROGRESS_ENTITY_TYPES,
  type RecommendationCandidate,
  type RecommendationContext,
  type RecommendationEntityRef,
} from "./types.js";

/** Motivos de exclusao (internos; usados em teste, nunca em resultado publico). */
export const EXCLUSION_REASONS = [
  "invalid_ref",
  "type_not_recommendable",
  "invalid_signal",
  "blocked",
  "display_ineligible",
  "license_ineligible",
  "territory_ineligible",
  "not_interested",
  "hidden",
  "unknown_state",
  "engaged_in_discovery",
  "not_in_progress",
  "not_watched",
  "context_entity",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export type EligibilityResult =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: ExclusionReason };

const WATCH_STATE_SET: ReadonlySet<string> = new Set(WATCH_STATES);
const DISCOVERY_SET: ReadonlySet<string> = new Set(DISCOVERY_ENTITY_TYPES);
const PROGRESS_SET: ReadonlySet<string> = new Set(PROGRESS_ENTITY_TYPES);

const ELIGIBLE: EligibilityResult = { eligible: true };
function excluded(reason: ExclusionReason): EligibilityResult {
  return { eligible: false, reason };
}

/** Tipo recomendavel no contexto: continue_watching aceita season/episode. */
export function isRecommendableForContext(
  entityType: string,
  context: RecommendationContext,
): boolean {
  if (context === "continue_watching") {
    return PROGRESS_SET.has(entityType);
  }
  return DISCOVERY_SET.has(entityType);
}

/** Sinal unitario valido: null (ausente) ou numero finito em 0..1. */
function isValidUnitSignal(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && value >= 0 && value <= 1);
}

/**
 * Avalia a elegibilidade de UM candidato no contexto dado. Ordem fail-closed:
 * ref -> tipo -> sinais numericos -> flags de licenca/bloqueio -> estado
 * conhecido -> entidade de contexto -> regra de watch state por contexto.
 */
export function evaluateEligibility(input: {
  readonly candidate: RecommendationCandidate;
  readonly context: RecommendationContext;
  readonly contextEntityRef?: RecommendationEntityRef;
}): EligibilityResult {
  const c = input.candidate;

  if (typeof c.ref.entityType !== "string" || c.ref.entityType.length === 0 || c.ref.entityId <= 0n) {
    return excluded("invalid_ref");
  }
  if (!isRecommendableForContext(c.ref.entityType, input.context)) {
    return excluded("type_not_recommendable");
  }
  if (
    !isValidUnitSignal(c.popularity) ||
    !isValidUnitSignal(c.similarity) ||
    !isValidUnitSignal(c.recency)
  ) {
    return excluded("invalid_signal");
  }

  // Flags fail-closed (undefined/false excluem).
  if (c.blocked === true) return excluded("blocked");
  if (c.displayEligible !== true) return excluded("display_ineligible");
  if (c.licenseEligible !== true) return excluded("license_ineligible");
  if (c.territoryEligible !== true) return excluded("territory_ineligible");
  if (c.notInterested === true) return excluded("not_interested");
  if (c.hidden === true) return excluded("hidden");

  // Estado de acompanhamento conhecido (fail-closed) e not_interested via estado.
  if (c.watchState !== null && !WATCH_STATE_SET.has(c.watchState)) {
    return excluded("unknown_state");
  }
  if (c.watchState === "not_interested") return excluded("not_interested");

  if (input.context === "similar" && input.contextEntityRef !== undefined) {
    if (
      c.ref.entityType === input.contextEntityRef.entityType &&
      c.ref.entityId === input.contextEntityRef.entityId
    ) {
      return excluded("context_entity");
    }
  }

  const ws = c.watchState;
  if (input.context === "discovery" || input.context === "similar") {
    // Descoberta: exclui entidades ENGAJADAS (watched inclusive, secao 9).
    if (ws === "watched" || ws === "watching" || ws === "paused" || ws === "rewatching") {
      return excluded("engaged_in_discovery");
    }
  } else if (input.context === "continue_watching") {
    const inProgress = (ws === "watching" || ws === "paused") && c.hasProgress === true;
    if (!inProgress) {
      return excluded("not_in_progress");
    }
  } else {
    // rewatch: exige ter assistido antes.
    if (ws !== "watched" && ws !== "rewatching") {
      return excluded("not_watched");
    }
  }

  return ELIGIBLE;
}
