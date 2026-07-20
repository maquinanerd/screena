/**
 * feedback.ts — Feedback explicito de recomendacao e exclusoes derivadas (C6B).
 *
 * PURO e DETERMINISTICO: sem rede, sem DB, sem relogio (o instante entra por
 * `now`/`occurredAt` em epoch-ms). Produz PLANOS e EXCLUSOES estruturadas —
 * nunca muta outros dominios. Feedback de recomendacao NAO altera rating, review,
 * watch state, listas nem calcula Cinerie Score; no maximo emite INSTRUCOES
 * (exclusoes derivadas) que a futura montagem de candidatos de C6A consumira como
 * flags ja resolvidas.
 *
 * SCHEMA_GAP (registrado): NAO existe tabela `recommendation_feedback` no schema.
 * A UNICA exclusao dura hoje PERSISTIDA e o WatchState `not_interested` (dominio
 * de tracking/C4) — que ESTE dominio NAO escreve (separacao). O `create` abaixo e
 * um plano transaction-ready para uma TABELA FUTURA; C7/uma unidade posterior
 * decide onde ele aterrissa. Sem tabela, nao ha persistencia agora.
 *
 * FONTE: decisoes de produto (secao 9) so ancoram `not_interested` como exclusao
 * dura. Os demais tipos sao PROVISORIOS/POLICY_GAP e estao flagados; feedback
 * POSITIVO (like/save) e POLICY_GAP e AQUI e inerte (nunca vira rating/lista).
 */

import { RATABLE_ENTITY_TYPES, type UserStatus } from "../core/types.js";
import { epochMillisToIsoUtc, isValidEpochMillis } from "./time.js";
import {
  RECOMMENDATION_CONTEXTS,
  type FeedbackPolicy,
  type RecommendationContext,
} from "./types.js";

/**
 * Tipos de feedback (conjunto FECHADO, versionado). `not_interested` e GROUNDED
 * (decisoes secao 9 -> exclusao dura). Os demais sao PROVISORIOS (POLICY_GAP):
 * `hide` (dura), `already_seen` (soft, so discovery/similar), `dismiss`/
 * `not_relevant` (temporarias), `like`/`save` (positivos INERTES aqui).
 */
export const RECOMMENDATION_FEEDBACK_TYPES = [
  "not_interested",
  "hide",
  "already_seen",
  "dismiss",
  "not_relevant",
  "like",
  "save",
] as const;
export type FeedbackType = (typeof RECOMMENDATION_FEEDBACK_TYPES)[number];

/** Origem controlada (nunca texto livre). */
export const FEEDBACK_SOURCES = ["app", "system"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

const FEEDBACK_TYPE_SET: ReadonlySet<string> = new Set(RECOMMENDATION_FEEDBACK_TYPES);
const FEEDBACK_SOURCE_SET: ReadonlySet<string> = new Set(FEEDBACK_SOURCES);
const CONTEXT_SET: ReadonlySet<string> = new Set(RECOMMENDATION_CONTEXTS);
const FEEDBACK_ENTITY_SET: ReadonlySet<string> = new Set(RATABLE_ENTITY_TYPES);
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

/** Forca da exclusao derivada. */
export type ExclusionStrength = "hard" | "soft" | "temporary";

/** Contextos em que uma exclusao SOFT (already_seen) se aplica: descoberta. */
const SOFT_CONTEXTS: readonly RecommendationContext[] = ["discovery", "similar"];

// ---------------------------------------------------------------------------
// Planejamento de feedback (idempotencia)
// ---------------------------------------------------------------------------

/** Comando de feedback recebido (entrada nao confiavel). */
export interface FeedbackCommand {
  readonly ownerUserId: bigint;
  readonly entityType: string;
  readonly entityId: bigint;
  readonly feedbackType: string;
  /** Contexto de origem do feedback (escopo); `null` = todos. */
  readonly context: RecommendationContext | null;
  readonly occurredAt: number;
  readonly idempotencyKey: string;
  readonly source: FeedbackSource;
  readonly accountStatus: UserStatus;
}

/** Feedback JA persistido (pre-imagem lida pela persistencia por idempotencyKey). */
export interface StoredFeedback {
  readonly ownerUserId: bigint;
  readonly entityType: string;
  readonly entityId: bigint;
  readonly feedbackType: FeedbackType;
  readonly context: RecommendationContext | null;
  readonly occurredAt: number;
  readonly idempotencyKey: string;
  readonly source: FeedbackSource;
}

/** Registro persistivel para a TABELA FUTURA (SCHEMA_GAP). Sem texto livre/PII. */
export interface PersistableFeedbackRecord {
  readonly ownerUserId: bigint;
  readonly entityType: string;
  readonly entityId: bigint;
  readonly feedbackType: FeedbackType;
  readonly context: RecommendationContext | null;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly source: FeedbackSource;
}

export type FeedbackPlan =
  | {
      readonly kind: "create";
      readonly record: PersistableFeedbackRecord;
      readonly preconditions: {
        readonly ownerUserId: bigint;
        readonly idempotencyKey: string;
        /** Reforca unique (owner, idempotencyKey) na tabela futura. */
        readonly enforceIdempotencyUnique: true;
      };
    }
  | { readonly kind: "noop"; readonly reason: string }
  | { readonly kind: "conflict"; readonly idempotencyKey: string }
  | { readonly kind: "invalid"; readonly errors: readonly string[] }
  | { readonly kind: "forbidden"; readonly reason: string };

/** Assinatura de CONTEUDO (idempotencia) — sem occurredAt (tempo nao quebra idempotencia). */
function contentSignature(f: {
  ownerUserId: bigint;
  entityType: string;
  entityId: bigint;
  feedbackType: string;
  context: RecommendationContext | null;
}): string {
  return [
    f.ownerUserId.toString(),
    f.entityType,
    f.entityId.toString(),
    f.feedbackType,
    f.context ?? "",
  ].join("|");
}

export interface PlanFeedbackInput {
  readonly command: FeedbackCommand;
  /** Feedback ja existente para a MESMA idempotencyKey (null = nenhum). */
  readonly existing: StoredFeedback | null;
}

/**
 * Resolve o plano de feedback. Precedencia: conta -> validacao -> idempotencia.
 * Replay identico => noop; mesma idempotencyKey com conteudo divergente =>
 * conflict; tipo/entidade/origem invalidos => invalid (fail-closed). Total, sem
 * excecao. NAO altera rating/review/watch state/lista; NAO calcula Cinerie Score.
 */
export function planRecommendationFeedback(input: PlanFeedbackInput): FeedbackPlan {
  const c = input.command;

  if (c.accountStatus !== "active") {
    return { kind: "forbidden", reason: "conta indisponivel para registrar feedback." };
  }

  const errors: string[] = [];
  if (typeof c.ownerUserId !== "bigint" || c.ownerUserId <= 0n) errors.push("ownerUserId invalido");
  if (!FEEDBACK_ENTITY_SET.has(c.entityType)) {
    errors.push(`entityType nao recomendavel: "${c.entityType}"`);
  }
  if (typeof c.entityId !== "bigint" || c.entityId <= 0n) errors.push("entityId invalido");
  if (!FEEDBACK_TYPE_SET.has(c.feedbackType)) errors.push(`feedbackType desconhecido: "${c.feedbackType}"`);
  if (c.context !== null && !CONTEXT_SET.has(c.context)) errors.push("context invalido");
  if (!isValidEpochMillis(c.occurredAt)) errors.push("occurredAt (epoch-ms) invalido");
  if (typeof c.idempotencyKey !== "string" || c.idempotencyKey.trim().length === 0) {
    errors.push("idempotencyKey vazia");
  } else if (c.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    errors.push("idempotencyKey longa demais");
  }
  if (!FEEDBACK_SOURCE_SET.has(c.source)) errors.push("source invalida");
  if (errors.length > 0) {
    return { kind: "invalid", errors };
  }

  const feedbackType = c.feedbackType as FeedbackType;

  if (input.existing !== null) {
    // Assinatura so com os campos de CONTEUDO (nunca occurredAt/source/idempotencyKey).
    const same =
      contentSignature(input.existing) ===
      contentSignature({
        ownerUserId: c.ownerUserId,
        entityType: c.entityType,
        entityId: c.entityId,
        feedbackType,
        context: c.context,
      });
    if (same) {
      return { kind: "noop", reason: "replay idempotente (mesmo conteudo)." };
    }
    return { kind: "conflict", idempotencyKey: c.idempotencyKey };
  }

  const record: PersistableFeedbackRecord = {
    ownerUserId: c.ownerUserId,
    entityType: c.entityType,
    entityId: c.entityId,
    feedbackType,
    context: c.context,
    occurredAt: epochMillisToIsoUtc(c.occurredAt),
    idempotencyKey: c.idempotencyKey,
    source: c.source,
  };
  return {
    kind: "create",
    record,
    preconditions: {
      ownerUserId: c.ownerUserId,
      idempotencyKey: c.idempotencyKey,
      enforceIdempotencyUnique: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Exclusoes derivadas (feedback -> flags para C6A)
// ---------------------------------------------------------------------------

/**
 * Exclusao derivada de feedback, pronta para virar flag em C6A. JSON-safe:
 * `entityId` como string, contextos ordenados, sem texto livre nem PII. NUNCA
 * carrega rating/review/watch state/lista/Cinerie Score.
 */
export interface DerivedExclusion {
  readonly entityType: string;
  readonly entityId: string;
  readonly strength: ExclusionStrength;
  /** Contextos onde a exclusao se aplica (ordenados). */
  readonly contexts: readonly RecommendationContext[];
  /** Fim da exclusao TEMPORARIA (epoch-ms); `null` em hard/soft. */
  readonly expiresAtMs: number | null;
  /** Tipos de feedback que contribuiram (ordenados, unicos). */
  readonly sources: readonly FeedbackType[];
}

/** Contribuicao de UM feedback ativo (antes do merge por entidade). */
interface Contribution {
  readonly strength: ExclusionStrength;
  readonly contexts: readonly RecommendationContext[];
  readonly expiresAtMs: number | null;
  readonly feedbackType: FeedbackType;
}

const STRENGTH_RANK: Readonly<Record<ExclusionStrength, number>> = {
  hard: 3,
  soft: 2,
  temporary: 1,
};

function sortedContexts(set: ReadonlySet<RecommendationContext>): RecommendationContext[] {
  return RECOMMENDATION_CONTEXTS.filter((ctx) => set.has(ctx));
}

/**
 * Mapeia UM feedback ativo em uma contribuicao de exclusao (ou `null`: positivo,
 * expirado ou malformado). `now` decide se um temporario ainda esta ativo.
 */
function toContribution(f: StoredFeedback, now: number, policy: FeedbackPolicy): Contribution | null {
  if (!isValidEpochMillis(f.occurredAt)) return null; // malformado: nao exclui (fail-closed sem exclusao errada)
  const all = RECOMMENDATION_CONTEXTS;
  switch (f.feedbackType) {
    case "not_interested":
    case "hide":
      return { strength: "hard", contexts: all, expiresAtMs: null, feedbackType: f.feedbackType };
    case "already_seen":
      return { strength: "soft", contexts: SOFT_CONTEXTS, expiresAtMs: null, feedbackType: f.feedbackType };
    case "dismiss":
    case "not_relevant": {
      const ttl = f.feedbackType === "dismiss" ? policy.dismissTtlMs : policy.notRelevantTtlMs;
      if (!Number.isInteger(ttl) || ttl < 0) return null;
      const expiresAtMs = f.occurredAt + ttl;
      if (now >= expiresAtMs) return null; // expirado: nao exclui mais
      const contexts = f.context === null ? all : [f.context];
      return { strength: "temporary", contexts, expiresAtMs, feedbackType: f.feedbackType };
    }
    case "like":
    case "save":
      return null; // positivo: NUNCA exclui, NUNCA vira rating/lista
    default:
      return null;
  }
}

export interface DeriveExclusionsInput {
  readonly feedbacks: readonly StoredFeedback[];
  readonly now: number;
  readonly policy: FeedbackPolicy;
}

/**
 * Deriva as exclusoes ATIVAS (em `now`) a partir de feedbacks persistidos. UMA
 * exclusao por entidade: escolhe a forca DOMINANTE (hard > soft > temporary),
 * une os contextos dentro dessa forca e, para temporaria, usa o maior expiresAt.
 * Independente da ordem (union/max/dedup sao comutativos); duplicidade nao gera
 * multiplas exclusoes. Nao importa tracking/ratings/lists; nao muta nada.
 */
export function deriveFeedbackExclusions(
  input: DeriveExclusionsInput,
): { readonly exclusions: readonly DerivedExclusion[] } {
  if (!isValidEpochMillis(input.now)) {
    return { exclusions: [] };
  }

  // Agrupa contribuicoes ativas por entidade (chave estavel: type|id).
  const byRef = new Map<
    string,
    { entityType: string; entityId: bigint; contributions: Contribution[] }
  >();
  for (const f of input.feedbacks) {
    if (typeof f.entityId !== "bigint" || f.entityId <= 0n) continue;
    const contribution = toContribution(f, input.now, input.policy);
    if (contribution === null) continue;
    const key = `${f.entityType}:${f.entityId.toString()}`;
    const bucket = byRef.get(key);
    if (bucket === undefined) {
      byRef.set(key, { entityType: f.entityType, entityId: f.entityId, contributions: [contribution] });
    } else {
      bucket.contributions.push(contribution);
    }
  }

  const out: DerivedExclusion[] = [];
  for (const bucket of byRef.values()) {
    // Forca dominante entre as contribuicoes.
    let dominant: ExclusionStrength = "temporary";
    for (const c of bucket.contributions) {
      if (STRENGTH_RANK[c.strength] > STRENGTH_RANK[dominant]) dominant = c.strength;
    }
    const atDominant = bucket.contributions.filter((c) => c.strength === dominant);

    const contextSet = new Set<RecommendationContext>();
    const sourceSet = new Set<FeedbackType>();
    let expiresAtMs: number | null = null;
    for (const c of atDominant) {
      for (const ctx of c.contexts) contextSet.add(ctx);
      sourceSet.add(c.feedbackType);
      if (dominant === "temporary" && c.expiresAtMs !== null) {
        expiresAtMs = expiresAtMs === null ? c.expiresAtMs : Math.max(expiresAtMs, c.expiresAtMs);
      }
    }

    out.push({
      entityType: bucket.entityType,
      entityId: bucket.entityId.toString(),
      strength: dominant,
      contexts: sortedContexts(contextSet),
      expiresAtMs: dominant === "temporary" ? expiresAtMs : null,
      sources: RECOMMENDATION_FEEDBACK_TYPES.filter((t) => sourceSet.has(t)),
    });
  }

  // Ordenacao determinista final (independente da ordem de entrada).
  out.sort((a, b) =>
    a.entityType < b.entityType
      ? -1
      : a.entityType > b.entityType
        ? 1
        : a.entityId < b.entityId
          ? -1
          : a.entityId > b.entityId
            ? 1
            : 0,
  );
  return { exclusions: out };
}
