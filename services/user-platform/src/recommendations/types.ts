/**
 * types.ts — Tipos do dominio de RECOMENDACOES pessoais da Cinerie
 * (Backend C, unidade C6A).
 *
 * PURO e DETERMINISTICO: sem rede, sem DB, sem relogio, sem IA, sem ML. Recebe
 * entradas JA preparadas e minimizadas por uma camada futura; produz um ranking
 * explicavel. NUNCA:
 *  - calcula ou usa o Cinerie Score (score editorial != afinidade pessoal);
 *  - importa @screena/cinerie-score, services/ratings ou external-intelligence;
 *  - decide licenca/legalidade (recebe flags ja resolvidas, fail-closed);
 *  - le review textual, e-mail, IP, sessao, token ou qualquer PII.
 *
 * Fonte de verdade: docs/product/user-product-decisions.md secao 9 (sinais e
 * exclusoes obrigatorias) + schema.prisma RecommendationSnapshot (o score e as
 * reasons por item alimentam o snapshot — a persistencia/diversidade e C6B).
 *
 * O `score` aqui e INTERNO ao dominio de recomendacao: NAO e nota publica, NAO
 * e Cinerie Score e NAO deve ser exibido diretamente ao usuario nesta unidade.
 */

import type { WatchState } from "../core/types.js";

export type { WatchState };

// ---------------------------------------------------------------------------
// Contextos (discriminados; NUNCA misturados)
// ---------------------------------------------------------------------------

/**
 * Contexto da recomendacao. Discovery (descobrir algo novo) exclui watched;
 * continue_watching exige progresso; rewatch cobre reassistir (watched
 * permitido); similar exclui a propria entidade de contexto.
 */
export const RECOMMENDATION_CONTEXTS = [
  "discovery",
  "continue_watching",
  "rewatch",
  "similar",
] as const;
export type RecommendationContext = (typeof RECOMMENDATION_CONTEXTS)[number];

/**
 * Tipos recomendaveis em DISCOVERY: apenas movie|tv (itens principais). Season/
 * episode NAO entram em discovery sem decisao explicita (POLICY_GAP) — so em
 * continue_watching/rewatch, onde ha progresso. person/article nunca.
 */
export const DISCOVERY_ENTITY_TYPES = ["movie", "tv"] as const;
/** Tipos com progresso (continue_watching/rewatch): movie|tv|season|episode. */
export const PROGRESS_ENTITY_TYPES = ["movie", "tv", "season", "episode"] as const;

// ---------------------------------------------------------------------------
// Referencia da entidade candidata
// ---------------------------------------------------------------------------

/** Referencia estavel do catalogo (entityType validado por contexto). */
export interface RecommendationEntityRef {
  readonly entityType: string;
  readonly entityId: bigint;
}

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

/**
 * Perfil de preferencias DERIVADO e MINIMIZADO. Pesos de afinidade em 0..1.
 * NUNCA contem e-mail, IP, nome, sessao, senha, token ou dado juridico.
 */
export interface PreferenceProfile {
  readonly genreWeights: Readonly<Record<string, number>>;
  readonly entityTypeWeights: Readonly<Record<string, number>>;
  readonly localeWeights: Readonly<Record<string, number>>;
}

/**
 * Resumo do historico do usuario (profundidade) — para cold start e confianca.
 * Contagens agregadas, nunca historico bruto nem entidades individuais.
 */
export interface HistorySummary {
  readonly watchedCount: number;
  readonly ratedCount: number;
  readonly distinctGenreCount: number;
}

/**
 * Candidato a recomendacao. So o necessario ao ranking/explicacao — NUNCA a
 * entidade Prisma completa. Sinais numericos ja NORMALIZADOS em 0..1 pelo
 * chamador (null = ausente/desconhecido, nunca "zero"). Flags de licenca/
 * display/territorio JA resolvidas externamente (fail-closed).
 */
export interface RecommendationCandidate {
  readonly ref: RecommendationEntityRef;
  readonly genres: readonly string[];
  readonly locales: readonly string[];
  readonly popularity: number | null;
  readonly similarity: number | null;
  readonly recency: number | null;
  readonly displayEligible: boolean;
  readonly licenseEligible: boolean;
  readonly territoryEligible: boolean;
  readonly blocked: boolean;
  readonly notInterested: boolean;
  readonly hidden: boolean;
  /** Estado de acompanhamento do usuario sobre a entidade (null = nenhum). */
  readonly watchState: WatchState | null;
  /** Ha progresso registrado (para continue_watching). */
  readonly hasProgress: boolean;
}

// ---------------------------------------------------------------------------
// Sinais e politica
// ---------------------------------------------------------------------------

/** Chaves dos sinais POSITIVOS normalizados (0..1). */
export const SIGNAL_KEYS = [
  "genreAffinity",
  "entityTypeAffinity",
  "similarity",
  "popularity",
  "recency",
  "localeAffinity",
] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

/** Contribuicoes de sinais de UM candidato (0..1 quando presente; null = ausente). */
export type SignalContributions = Readonly<Record<SignalKey, number | null>>;

/** Politica de recomendacao (pesos + limites) — versionada. */
export interface RecommendationPolicy {
  readonly version: string;
  /** Peso por sinal (>= 0). Peso 0 remove a contribuicao. */
  readonly weights: Readonly<Record<SignalKey, number>>;
  /** Penalidade subtraida do score quando o candidato foi `dropped`. */
  readonly dropPenalty: number;
  /** Contribuicao minima para emitir uma razao (evita razao "vazia"). */
  readonly reasonThreshold: number;
  /** Minimo de titulos assistidos para personalizar (senao cold start). */
  readonly minWatchedForPersonalization: number;
  /** Teto de confianca em cold start (confianca sempre baixa sem historico). */
  readonly maxColdStartConfidence: number;
  /**
   * Coeficientes da mistura de confianca (cobertura de sinais + profundidade de
   * historico + consistencia). Centralizados aqui — nunca numeros magicos
   * espalhados. Somam 1.0 por clareza documental.
   */
  readonly confidenceWeights: {
    readonly coverage: number;
    readonly depth: number;
    readonly consistency: number;
  };
}

// ---------------------------------------------------------------------------
// Razoes explicaveis (union FECHADA — RecommendationReason do schema)
// ---------------------------------------------------------------------------

export const RECOMMENDATION_REASON_CODES = [
  "genre_affinity",
  "type_affinity",
  "similar_to_watched",
  "popular_in_catalog",
  "cold_start_popular",
  "recently_added",
  "locale_match",
  "continue_series",
  "rewatch_pattern",
] as const;
export type RecommendationReasonCode = (typeof RECOMMENDATION_REASON_CODES)[number];

/** Uma razao explicavel: codigo fechado + contribuicao (0..1) ao score. */
export interface RecommendationReason {
  readonly code: RecommendationReasonCode;
  readonly contribution: number;
}

// ---------------------------------------------------------------------------
// Saida
// ---------------------------------------------------------------------------

/** Um item recomendado (sem userId, sem historico bruto, sem PII). */
export interface RankedRecommendation {
  readonly ref: RecommendationEntityRef;
  /** Score INTERNO de recomendacao (0..1) — nunca Cinerie Score, nunca publico. */
  readonly score: number;
  readonly confidence: number;
  /** Posicao contigua (0-based) apos ordenacao/limite. */
  readonly position: number;
  readonly reasons: readonly RecommendationReason[];
}

/** Resultado do ranking (alimenta o snapshot de C6B). */
export interface RecommendationResult {
  readonly context: RecommendationContext;
  readonly policyVersion: string;
  readonly items: readonly RankedRecommendation[];
}

// ---------------------------------------------------------------------------
// C6B — Politicas de diversidade e snapshot (tipos aqui para evitar ciclo de
// import entre policy.ts e diversity.ts/snapshot.ts; os VALORES provisorios
// vivem centralizados em policy.ts).
// ---------------------------------------------------------------------------

/**
 * Politica de DIVERSIDADE (caps + limite) — versionada. Caps sao "no maximo N
 * por balde" (>= 1). Aplicada DEPOIS do ranking e ANTES do limite persistido.
 * Dimensoes decididas em produto (secao 9): genero e franquia. `maxPerEntityType`
 * e provisorio (POLICY_GAP) — ver policy.ts.
 */
export interface DiversityPolicy {
  readonly version: string;
  /** Maximo de itens com o MESMO genero primario (genero[0] canonico). */
  readonly maxPerPrimaryGenre: number;
  /** Maximo por franquia/colecao — so aplica quando ha `franchiseKey` confiavel. */
  readonly maxPerFranchise: number;
  /** Maximo por tipo de entidade (movie/tv/...). POLICY_GAP: valor provisorio. */
  readonly maxPerEntityType: number;
  /** Teto de itens no snapshot final (piso de seguranca do output). */
  readonly outputLimit: number;
}

/**
 * Politica de SNAPSHOT (TTL/renovacao/vazio) — versionada. Todo tempo em
 * MILISSEGUNDOS; o instante corrente entra por `now`. POLICY_GAP: TTL/janela nao
 * estao nas decisoes de produto — valores provisorios em policy.ts.
 */
export interface SnapshotPolicy {
  readonly version: string;
  /** Validade do snapshot em ms; `null` = sem expiracao (sempre valido). */
  readonly ttlMs: number | null;
  /** Janela (ms) antes de `expiresAt` em que o snapshot e "expiring". */
  readonly renewWindowMs: number;
  /** Se true, "expiring" (mesmo fingerprint) ja pede renovacao; senao so quando expirado. */
  readonly renewOnExpiring: boolean;
  /** Se false, snapshot com zero itens NAO e persistido (fail-closed anti-vazio). */
  readonly allowEmptySnapshot: boolean;
}

/**
 * Politica de FEEDBACK explicito de recomendacao — versionada. Durata das
 * exclusoes TEMPORARIAS (dismiss/not_relevant) em MILISSEGUNDOS. POLICY_GAP: as
 * decisoes de produto so gravam `not_interested` (WatchState) como exclusao dura;
 * os demais tipos e suas duracoes sao provisorios (ver policy.ts / feedback.ts).
 */
export interface FeedbackPolicy {
  readonly version: string;
  /** Duracao da exclusao temporaria de `dismiss` (ms). POLICY_GAP. */
  readonly dismissTtlMs: number;
  /** Duracao da exclusao temporaria de `not_relevant` (ms). POLICY_GAP. */
  readonly notRelevantTtlMs: number;
}
