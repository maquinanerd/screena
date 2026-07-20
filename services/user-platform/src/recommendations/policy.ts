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

import type {
  DiversityPolicy,
  FeedbackPolicy,
  HistorySummary,
  RecommendationPolicy,
  SnapshotPolicy,
} from "./types.js";

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

// ---------------------------------------------------------------------------
// C6B — Politicas de diversidade e snapshot (PROVISORIAS, versionadas)
// ---------------------------------------------------------------------------

export const DIVERSITY_POLICY_VERSION = "reco-div-v1" as const;

/**
 * Diversidade provisoria v1. Decisoes de produto (secao 9) fixam as DIMENSOES
 * (cap por franquia/genero no snapshot) mas NAO os numeros — POLICY_GAP. Caps
 * "no maximo N por balde". `maxPerEntityType` e provisorio e generoso (a
 * diferenciacao movie/tv ja e forte no ranking); flagado para decisao humana.
 */
export const DEFAULT_DIVERSITY_POLICY: DiversityPolicy = {
  version: DIVERSITY_POLICY_VERSION,
  maxPerPrimaryGenre: 3, // POLICY_GAP
  maxPerFranchise: 2, // POLICY_GAP
  maxPerEntityType: 20, // POLICY_GAP (generoso; ranking ja separa movie/tv)
  outputLimit: 20, // POLICY_GAP
};

export const SNAPSHOT_POLICY_VERSION = "reco-snap-v1" as const;

const HOUR_MS = 3_600_000;

/**
 * Snapshot provisorio v1. TTL/janela de renovacao NAO estao nas decisoes de
 * produto — POLICY_GAP (valores provisorios, versionados, concentrados aqui).
 * `allowEmptySnapshot=false`: melhor NAO ter snapshot atual do que persistir um
 * vazio (fail-closed anti-vazio). `renewOnExpiring=false`: so renova quando
 * efetivamente expirado (o pipeline reexecuta periodicamente).
 */
export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = {
  version: SNAPSHOT_POLICY_VERSION,
  ttlMs: 24 * HOUR_MS, // POLICY_GAP
  renewWindowMs: 6 * HOUR_MS, // POLICY_GAP
  renewOnExpiring: false, // POLICY_GAP
  allowEmptySnapshot: false, // POLICY_GAP
};

export const FEEDBACK_POLICY_VERSION = "reco-feedback-v1" as const;

const DAY_MS = 86_400_000;

/**
 * Feedback provisorio v1. Decisoes de produto (secao 9) so ancoram
 * `not_interested` (WatchState) como exclusao DURA de recomendacoes. As duracoes
 * das exclusoes TEMPORARIAS (dismiss/not_relevant) sao POLICY_GAP — provisorias,
 * versionadas, concentradas aqui.
 */
export const DEFAULT_FEEDBACK_POLICY: FeedbackPolicy = {
  version: FEEDBACK_POLICY_VERSION,
  dismissTtlMs: 30 * DAY_MS, // POLICY_GAP
  notRelevantTtlMs: 30 * DAY_MS, // POLICY_GAP
};
