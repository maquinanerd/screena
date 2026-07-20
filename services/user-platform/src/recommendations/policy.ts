/**
 * policy.ts — Politica pura de RECOMENDACOES (Backend C, unidade C6A).
 *
 * PURO: sem rede, sem DB, sem relogio. Concentra em UM lugar os PESOS e limites
 * (nunca numeros magicos espalhados) e a deteccao de cold start.
 *
 * POLICY_GAP: as decisoes de produto (secao 9) definem os SINAIS
 * (generos/historico/ratings/similares/popularidade) e as EXCLUSOES
 * obrigatorias, mas NAO fixam pesos numericos. Os valores abaixo sao POLITICA
 * DE DOMINIO PROVISORIA e VERSIONADA (`reco-v1`), flagados para decisao humana
 * de produto — nao sao a calibracao final. Trocar pesos exige nova versao.
 */

import type { HistorySummary, RecommendationPolicy } from "./types.js";

export const RECOMMENDATION_POLICY_VERSION = "reco-v1" as const;

/**
 * Politica provisoria v1. Pesos relativos (o score usa MEDIA PONDERADA dos
 * sinais presentes, entao o que importa e a razao entre pesos; somam 1.0 por
 * clareza documental). Sinais alinhados a secao 9: similaridade e afinidade de
 * genero pesam mais; popularidade/recencia/tipo/locale complementam.
 */
export const DEFAULT_RECOMMENDATION_POLICY: RecommendationPolicy = {
  version: RECOMMENDATION_POLICY_VERSION,
  weights: {
    similarity: 0.3,
    genreAffinity: 0.25,
    popularity: 0.15,
    recency: 0.1,
    entityTypeAffinity: 0.1,
    localeAffinity: 0.1,
  },
  dropPenalty: 0.25,
  reasonThreshold: 0.15,
  minWatchedForPersonalization: 5,
  maxColdStartConfidence: 0.4,
  confidenceWeights: { coverage: 0.4, depth: 0.4, consistency: 0.2 },
};

/**
 * Cold start = historico insuficiente para personalizar. Fail-closed: contagem
 * invalida (NaN/negativa) tambem e tratada como cold start.
 */
export function isColdStart(history: HistorySummary, policy: RecommendationPolicy): boolean {
  const watched = history.watchedCount;
  if (!Number.isFinite(watched) || watched < 0) {
    return true;
  }
  return watched < policy.minWatchedForPersonalization;
}
