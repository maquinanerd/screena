/**
 * ranking.ts — Pipeline puro de ranking de recomendacoes (Backend C, C6A).
 *
 * PURO e DETERMINISTICO: sem rede, sem DB, sem relogio, sem Math.random. NAO
 * modifica as entradas. Pipeline: valida limite -> dedup por entidade -> filtra
 * inelegiveis -> pontua -> deriva razoes -> ORDENA (score, depois confianca,
 * popularidade, ref) -> aplica limite APOS ordenar -> posicoes contiguas.
 *
 * Toda recomendacao tem PELO MENOS uma razao (sem base explicavel, o candidato
 * nao entra) — cold start sem sinais retorna resultado vazio, nunca uma
 * recomendacao "personalizada" falsa. O resultado nunca contem userId,
 * historico bruto, review nem o Cinerie Score.
 */

import { type DomainResult, err, ok } from "../core/result.js";
import { evaluateEligibility } from "./eligibility.js";
import { isColdStart } from "./policy.js";
import { deriveReasons } from "./reasons.js";
import { computeConfidence, computeScore } from "./scoring.js";
import { computeSignals } from "./signals.js";
import type {
  HistorySummary,
  PreferenceProfile,
  RankedRecommendation,
  RecommendationCandidate,
  RecommendationContext,
  RecommendationEntityRef,
  RecommendationPolicy,
  RecommendationResult,
} from "./types.js";

export interface RankRequest {
  readonly context: RecommendationContext;
  readonly profile: PreferenceProfile;
  readonly history: HistorySummary;
  readonly candidates: readonly RecommendationCandidate[];
  readonly policy: RecommendationPolicy;
  readonly limit: number;
  /** Entidade de contexto para o modo `similar` (excluida do resultado). */
  readonly contextEntityRef?: RecommendationEntityRef;
}

function refKey(ref: RecommendationEntityRef): string {
  return `${ref.entityType}${ref.entityId.toString()}`;
}

/** Tupla de sinais para desempate determinista (null vira -1). */
function signalRank(candidate: RecommendationCandidate): [number, number, number] {
  return [candidate.popularity ?? -1, candidate.similarity ?? -1, candidate.recency ?? -1];
}

/**
 * Assinatura canonica determinista de um candidato (independe da ordem de
 * entrada). Cobre TODOS os campos que afetam score/razoes — para o desempate de
 * dedup ser TOTAL mesmo quando os 3 sinais empatam. Nao muta a entrada (spread
 * antes de sort).
 */
function candidateSignature(c: RecommendationCandidate): string {
  const genres = [...c.genres].sort().join(",");
  const locales = [...c.locales].sort().join(",");
  const flags = [
    c.displayEligible,
    c.licenseEligible,
    c.territoryEligible,
    c.blocked,
    c.notInterested,
    c.hidden,
    c.hasProgress,
  ].join("");
  return [c.popularity ?? -1, c.similarity ?? -1, c.recency ?? -1, c.watchState ?? "", genres, locales, flags].join(
    "|",
  );
}

/**
 * Preferencia ESTRITA e TOTAL entre duplicatas do mesmo ref: maiores sinais
 * vencem; no empate total dos 3 sinais, desempata pela assinatura canonica
 * (maior vence). Antissimetrica — nunca prefersFirst(a,b) e prefersFirst(b,a)
 * sao ambos true — logo o sobrevivente da dedup INDEPENDE da ordem de entrada
 * (duplicatas identicas dao o mesmo resultado seja qual for a mantida).
 */
function prefersFirst(a: RecommendationCandidate, b: RecommendationCandidate): boolean {
  const [ap, as_, ar] = signalRank(a);
  const [bp, bs, br] = signalRank(b);
  if (ap !== bp) return ap > bp;
  if (as_ !== bs) return as_ > bs;
  if (ar !== br) return ar > br;
  return candidateSignature(a) > candidateSignature(b);
}

function dedupe(
  candidates: readonly RecommendationCandidate[],
): RecommendationCandidate[] {
  const byKey = new Map<string, RecommendationCandidate>();
  for (const candidate of candidates) {
    const key = refKey(candidate.ref);
    const kept = byKey.get(key);
    if (kept === undefined || prefersFirst(candidate, kept)) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()];
}

/** Item enriquecido com a popularidade para desempate (removida na saida). */
interface ScoredItem extends RankedRecommendation {
  readonly tiebreakPopularity: number;
}

/**
 * Ordem total determinista: score desc -> confianca desc -> popularidade desc
 * (null=-1) -> entityId asc -> entityType asc. Como refs sao unicas apos dedup,
 * a ordem independe da ordem de entrada.
 */
function compareRanked(a: ScoredItem, b: ScoredItem): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  if (a.tiebreakPopularity !== b.tiebreakPopularity) return b.tiebreakPopularity - a.tiebreakPopularity;
  if (a.ref.entityId !== b.ref.entityId) return a.ref.entityId < b.ref.entityId ? -1 : 1;
  return a.ref.entityType < b.ref.entityType ? -1 : a.ref.entityType > b.ref.entityType ? 1 : 0;
}

/**
 * Ranqueia candidatos em um resultado explicavel. Limite negativo ou nao
 * inteiro => validation_failed; limite 0 => resultado vazio. Nunca lanca
 * excecao para caminho de negocio normal.
 */
export function rankRecommendations(request: RankRequest): DomainResult<RecommendationResult> {
  if (!Number.isInteger(request.limit) || request.limit < 0) {
    return err("validation_failed", "limite de recomendacoes invalido.", [
      "limit deve ser inteiro >= 0",
    ]);
  }

  const emptyResult: RecommendationResult = {
    context: request.context,
    policyVersion: request.policy.version,
    items: [],
  };
  if (request.limit === 0) {
    return ok(emptyResult);
  }

  const coldStart = isColdStart(request.history, request.policy);
  const scored: ScoredItem[] = [];

  for (const candidate of dedupe(request.candidates)) {
    const eligibility = evaluateEligibility({
      candidate,
      context: request.context,
      contextEntityRef: request.contextEntityRef,
    });
    if (!eligibility.eligible) {
      continue;
    }

    const signals = computeSignals(candidate, request.profile);
    const breakdown = computeScore({ signals, candidate, policy: request.policy });
    const reasons = deriveReasons({
      contributions: breakdown.contributions,
      context: request.context,
      coldStart,
      reasonThreshold: request.policy.reasonThreshold,
    });

    // Toda recomendacao precisa de uma base explicavel.
    if (reasons.length === 0) {
      continue;
    }

    const confidence = computeConfidence({
      signals,
      usedSignalCount: breakdown.usedSignalCount,
      history: request.history,
      coldStart,
      policy: request.policy,
    });

    scored.push({
      ref: { entityType: candidate.ref.entityType, entityId: candidate.ref.entityId },
      score: breakdown.score,
      confidence,
      position: 0,
      reasons,
      tiebreakPopularity: candidate.popularity ?? -1,
    });
  }

  scored.sort(compareRanked);

  const items: RankedRecommendation[] = scored.slice(0, request.limit).map((item, index) => ({
    ref: item.ref,
    score: item.score,
    confidence: item.confidence,
    position: index,
    reasons: item.reasons,
  }));

  return ok({ context: request.context, policyVersion: request.policy.version, items });
}
