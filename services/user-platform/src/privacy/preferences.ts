/**
 * Preferencias de privacidade — regras puras (Backend C, unidade C3).
 *
 * PURO: sem rede, sem DB, sem relogio. Privacidade por PADRAO (decisoes secao
 * 2): perfil, listas, tracking e reviews nascem privados. Valor desconhecido
 * SEMPRE resolve para o estado mais privado (fail-closed).
 */

import { type DomainResult, err, ok } from "../core/result.js";
import {
  PROFILE_VISIBILITIES,
  type ProfileVisibility,
  VISIBILITIES,
  type Visibility,
} from "../core/types.js";
import type { PublicPrivacyPreferencesDto } from "./types.js";

const PROFILE_VISIBILITY_SET: ReadonlySet<string> = new Set(PROFILE_VISIBILITIES);
const VISIBILITY_SET: ReadonlySet<string> = new Set(VISIBILITIES);

/** Defaults seguros (espelham os @default do schema). */
export const PRIVACY_DEFAULTS = {
  profileVisibility: "private",
  listVisibility: "private",
  watchStateVisibility: "private",
  reviewVisibility: "private",
} as const;

/**
 * Normaliza uma visibilidade de perfil vinda de fonte desconhecida: valor fora
 * do enum => `private` (fail-closed). Nunca "adivinha" um estado mais aberto.
 */
export function normalizeProfileVisibility(value: unknown): ProfileVisibility {
  return typeof value === "string" && PROFILE_VISIBILITY_SET.has(value)
    ? (value as ProfileVisibility)
    : "private";
}

/** Normaliza visibilidade de conteudo (lista/tracking/review): unknown => private. */
export function normalizeVisibility(value: unknown): Visibility {
  return typeof value === "string" && VISIBILITY_SET.has(value)
    ? (value as Visibility)
    : "private";
}

/**
 * Valida uma transicao de visibilidade de PERFIL. Publicar (private -> public)
 * exige email verificado (anti-abuso; coerente com listas publicas). Voltar a
 * private e sempre permitido. Alvo desconhecido e rejeitado (fail-closed).
 */
export function validateProfileVisibilityTransition(input: {
  readonly to: unknown;
  readonly emailVerifiedAt: Date | null;
}): DomainResult<ProfileVisibility> {
  if (typeof input.to !== "string" || !PROFILE_VISIBILITY_SET.has(input.to)) {
    return err("validation_failed", "visibilidade invalida.");
  }
  const target = input.to as ProfileVisibility;
  if (target === "public" && input.emailVerifiedAt === null) {
    return err("forbidden", "verifique seu email antes de tornar o perfil publico.");
  }
  return ok(target);
}

/**
 * Valida uma transicao de visibilidade de CONTEUDO (lista/tracking/review).
 * `public` e `unlisted` exigem email verificado; `private` e sempre permitido;
 * alvo desconhecido e rejeitado (fail-closed).
 */
export function validateContentVisibilityTransition(input: {
  readonly to: unknown;
  readonly emailVerifiedAt: Date | null;
}): DomainResult<Visibility> {
  if (typeof input.to !== "string" || !VISIBILITY_SET.has(input.to)) {
    return err("validation_failed", "visibilidade invalida.");
  }
  const target = input.to as Visibility;
  if (target !== "private" && input.emailVerifiedAt === null) {
    return err(
      "forbidden",
      "verifique seu email antes de tornar este conteudo publico ou nao listado.",
    );
  }
  return ok(target);
}

/**
 * Monta o DTO publico de preferencias (defaults quando ausentes). Nunca expoe
 * id interno; valores desconhecidos caem para private.
 */
export function toPublicPrivacyPreferences(input: {
  readonly profileVisibility?: unknown;
  readonly defaultListVisibility?: unknown;
  readonly defaultWatchStateVisibility?: unknown;
}): PublicPrivacyPreferencesDto {
  return {
    profileVisibility: normalizeProfileVisibility(input.profileVisibility),
    defaultListVisibility: normalizeVisibility(input.defaultListVisibility),
    defaultWatchStateVisibility: normalizeVisibility(input.defaultWatchStateVisibility),
  };
}
