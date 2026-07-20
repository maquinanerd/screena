/**
 * signals.ts — Normalizacao dos sinais de UM candidato (Backend C, C6A).
 *
 * PURO e DETERMINISTICO. Cada sinal vive em 0..1 (mesma escala) ou e `null`
 * (ausente/desconhecido — NUNCA vira zero por conveniencia). Afinidades vem do
 * perfil DERIVADO (pesos 0..1); popularity/similarity/recency ja chegam
 * normalizados e validados (eligibility rejeita fora de faixa/NaN/Inf). Escalas
 * jamais se misturam: nada de 0..5 ou 0..100 entra aqui.
 */

import type {
  PreferenceProfile,
  RecommendationCandidate,
  SignalContributions,
} from "./types.js";

/** Clampa em 0..1; nao-finito vira 0 (defensivo — nunca deveria chegar). */
function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * Melhor afinidade (max) entre os pesos do perfil e as chaves do candidato.
 * `null` quando NENHUMA chave tem peso conhecido — ausencia semantica, nao zero.
 */
function bestAffinity(
  keys: readonly string[],
  weights: Readonly<Record<string, number>>,
): number | null {
  let best: number | null = null;
  for (const key of keys) {
    const weight = weights[key];
    if (typeof weight === "number" && Number.isFinite(weight)) {
      const clamped = clampUnit(weight);
      if (best === null || clamped > best) {
        best = clamped;
      }
    }
  }
  return best;
}

/**
 * Deriva as contribuicoes de sinais (0..1 ou null) de um candidato elegivel.
 * popularity/similarity/recency sao repassados (ja validados pela eligibility).
 */
export function computeSignals(
  candidate: RecommendationCandidate,
  profile: PreferenceProfile,
): SignalContributions {
  const entityTypeWeight = profile.entityTypeWeights[candidate.ref.entityType];
  const entityTypeAffinity =
    typeof entityTypeWeight === "number" && Number.isFinite(entityTypeWeight)
      ? clampUnit(entityTypeWeight)
      : null;

  return {
    genreAffinity: bestAffinity(candidate.genres, profile.genreWeights),
    entityTypeAffinity,
    similarity: candidate.similarity,
    popularity: candidate.popularity,
    recency: candidate.recency,
    localeAffinity: bestAffinity(candidate.locales, profile.localeWeights),
  };
}
