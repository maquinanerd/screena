/**
 * reasons.ts — Razoes explicaveis e HONESTAS (Backend C, C6A).
 *
 * PURO e DETERMINISTICO. Uma razao SO aparece quando o sinal correspondente
 * realmente contribuiu (contribuicao >= reasonThreshold) ou quando o CONTEXTO a
 * justifica estruturalmente (continue_watching/rewatch). Nunca inventa razao:
 *  - sem afinidade de genero => sem "genre_affinity";
 *  - sem sinal de similaridade => sem "similar_to_watched";
 *  - sem popularidade => sem "popular_in_catalog";
 *  - "continue_series" so em continue_watching; "rewatch_pattern" so em rewatch.
 * Nenhuma razao contem userId, historico bruto, review ou dado externo.
 */

import {
  SIGNAL_KEYS,
  type RecommendationContext,
  type RecommendationReason,
  type RecommendationReasonCode,
  type SignalKey,
} from "./types.js";

/** Mapa sinal -> razao (popularity e tratado a parte por causa do cold start). */
const SIGNAL_TO_REASON: Readonly<Record<Exclude<SignalKey, "popularity">, RecommendationReasonCode>> = {
  genreAffinity: "genre_affinity",
  entityTypeAffinity: "type_affinity",
  similarity: "similar_to_watched",
  recency: "recently_added",
  localeAffinity: "locale_match",
};

/**
 * Deriva as razoes a partir das contribuicoes normalizadas do score. Ordem
 * determinista (SIGNAL_KEYS, depois razoes de contexto). Razao estrutural de
 * contexto usa contribuicao 1 (certeza estrutural, nao sinal ponderado).
 */
export function deriveReasons(input: {
  readonly contributions: Readonly<Partial<Record<SignalKey, number>>>;
  readonly context: RecommendationContext;
  readonly coldStart: boolean;
  readonly reasonThreshold: number;
}): RecommendationReason[] {
  const reasons: RecommendationReason[] = [];

  for (const key of SIGNAL_KEYS) {
    const contribution = input.contributions[key];
    if (typeof contribution !== "number" || !Number.isFinite(contribution)) {
      continue;
    }
    if (contribution < input.reasonThreshold) {
      continue;
    }
    const code: RecommendationReasonCode =
      key === "popularity"
        ? input.coldStart
          ? "cold_start_popular"
          : "popular_in_catalog"
        : SIGNAL_TO_REASON[key];
    reasons.push({ code, contribution });
  }

  if (input.context === "continue_watching") {
    reasons.push({ code: "continue_series", contribution: 1 });
  } else if (input.context === "rewatch") {
    reasons.push({ code: "rewatch_pattern", contribution: 1 });
  }

  return reasons;
}
