/**
 * scoring.ts — Pontuacao interna e confianca (Backend C, C6A).
 *
 * PURO e DETERMINISTICO: sem Math.random, sem relogio, sem ML/IA, sem
 * aleatoriedade. O score e MEDIA PONDERADA dos sinais PRESENTES (ausentes ficam
 * fora do denominador — nunca viram zero) menos penalidades, clampado em 0..1.
 *
 * IMPORTANTE: este score e INTERNO ao dominio de recomendacao. NAO e nota
 * publica, NAO e o Cinerie Score e NAO deve ser exibido diretamente ao usuario.
 */

import {
  SIGNAL_KEYS,
  type HistorySummary,
  type RecommendationCandidate,
  type RecommendationPolicy,
  type SignalContributions,
  type SignalKey,
} from "./types.js";

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export interface ScoreBreakdown {
  /** Score interno 0..1 (apos penalidades). */
  readonly score: number;
  /** Contribuicao NORMALIZADA por sinal usado (somam o score pre-penalidade). */
  readonly contributions: Readonly<Partial<Record<SignalKey, number>>>;
  readonly usedSignalCount: number;
}

/**
 * Combina os sinais em um score determinista. Peso 0 (ou ausente) remove a
 * contribuicao. Candidato `dropped` sofre penalidade (nunca exclusao aqui — a
 * exclusao dura e da eligibility). Resultado sempre finito e em 0..1.
 */
export function computeScore(input: {
  readonly signals: SignalContributions;
  readonly candidate: RecommendationCandidate;
  readonly policy: RecommendationPolicy;
}): ScoreBreakdown {
  const { signals, policy } = input;
  const weighted: Partial<Record<SignalKey, number>> = {};
  let numerator = 0;
  let denominator = 0;

  for (const key of SIGNAL_KEYS) {
    const value = signals[key];
    if (value === null || !Number.isFinite(value)) {
      continue;
    }
    const weight = policy.weights[key];
    if (!Number.isFinite(weight) || weight <= 0) {
      continue;
    }
    const contribution = weight * clampUnit(value);
    weighted[key] = contribution;
    numerator += contribution;
    denominator += weight;
  }

  const contributions: Partial<Record<SignalKey, number>> = {};
  let usedSignalCount = 0;
  if (denominator > 0) {
    for (const key of SIGNAL_KEYS) {
      const w = weighted[key];
      if (w !== undefined) {
        contributions[key] = w / denominator;
        usedSignalCount += 1;
      }
    }
  }

  const raw = denominator > 0 ? numerator / denominator : 0;
  const penalty = input.candidate.watchState === "dropped" ? Math.max(0, policy.dropPenalty) : 0;
  return { score: clampUnit(raw - penalty), contributions, usedSignalCount };
}

/** Amplitude (max-min) dos sinais presentes; null com menos de 2 sinais. */
function signalSpread(signals: SignalContributions): number | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const key of SIGNAL_KEYS) {
    const value = signals[key];
    if (value === null || !Number.isFinite(value)) {
      continue;
    }
    const clamped = clampUnit(value);
    min = Math.min(min, clamped);
    max = Math.max(max, clamped);
    count += 1;
  }
  return count < 2 ? null : max - min;
}

/**
 * Confianca (0..1), SEPARADA do score. Combina cobertura de sinais, profundidade
 * de historico e consistencia (sinais contraditorios reduzem confianca). Cold
 * start tem teto baixo. Nunca NaN/Infinity.
 */
export function computeConfidence(input: {
  readonly signals: SignalContributions;
  readonly usedSignalCount: number;
  readonly history: HistorySummary;
  readonly coldStart: boolean;
  readonly policy: RecommendationPolicy;
}): number {
  const coverage = clampUnit(input.usedSignalCount / SIGNAL_KEYS.length);

  const watched = Number.isFinite(input.history.watchedCount) ? Math.max(0, input.history.watchedCount) : 0;
  const depth = clampUnit(watched / Math.max(1, input.policy.minWatchedForPersonalization));

  const spread = signalSpread(input.signals);
  const consistency = spread === null ? 0.5 : clampUnit(1 - spread);

  const cw = input.policy.confidenceWeights;
  let confidence = clampUnit(cw.coverage * coverage + cw.depth * depth + cw.consistency * consistency);
  if (input.coldStart) {
    confidence = Math.min(confidence, clampUnit(input.policy.maxColdStartConfidence));
  }
  return confidence;
}
