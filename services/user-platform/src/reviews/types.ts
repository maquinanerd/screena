/**
 * types.ts — Tipos do dominio de REVIEWS de usuario (UGC textual) da Cinerie
 * (Backend C, unidade C5B).
 *
 * PURO: sem rede, sem DB, sem IO, sem relogio. Review TEXTUAL e um universo
 * proprio e NUNCA se mistura com:
 *  - a nota numerica do usuario (unidade C5A, `user_ratings`) — dominios e
 *    registros independentes; nunca importar ratings/ para calcular/validar nota;
 *  - ratings externos (IMDb/Rotten Tomatoes/...) — sem ratingSource/providerApi/
 *    sourceLicenseId/attribution;
 *  - o Cinerie Score editorial — nunca calculado nem autorizado aqui;
 *  - conteudo editorial/critica de terceiros — review e conteudo do usuario.
 *
 * Fonte de verdade: docs/product/user-product-decisions.md secoes 2/5/12 +
 * schema.prisma models UserReview/ReviewReport + enums espelhados em core/types.
 *
 * VERSIONAMENTO — LACUNA REGISTRADA (POLICY_GAP): `user_reviews` NAO tem coluna
 * `version` (nem `user_ratings`); optimistic locking por versao e
 * intencionalmente ausente. A pre-imagem (`ReviewSnapshot`) deixa o plano
 * transaction-ready para a persistencia futura. Alem disso, `user_reviews` NAO
 * tem unique (user, entidade): a criacao SEMPRE cria (nao ha dedup por unique;
 * a idempotencia recai sobre edit/spoiler/visibility/withdraw/report).
 *
 * SPOILER — o campo canonico e `UserReview.contains_spoiler`. A coluna homonima
 * em `user_ratings` (registrada em C5A) NAO e fonte de verdade aqui e nunca e
 * lida/sincronizada — SCHEMA_CLEANUP_FUTURE.
 */

import {
  RATABLE_ENTITY_TYPES,
  type RatableEntityType,
  type ReportReason,
  type ReviewModerationStatus,
  type Visibility,
} from "../core/types.js";

export type { ReportReason, ReviewModerationStatus, Visibility };

/**
 * Tipos de entidade REVISAVEL. Mesma regra do CHECK do banco (rating/review
 * <> person): movie | tv | season | episode. `person` e qualquer outro
 * (inclusive `article`, que nem existe no enum EntityType) sao rejeitados.
 */
export const REVIEWABLE_ENTITY_TYPES = RATABLE_ENTITY_TYPES;
export type ReviewableEntityType = RatableEntityType;

const REVIEWABLE_SET: ReadonlySet<string> = new Set(REVIEWABLE_ENTITY_TYPES);

/** Guard fail-closed: valor e um ReviewableEntityType canonico. */
export function isReviewableEntityType(value: unknown): value is ReviewableEntityType {
  return typeof value === "string" && REVIEWABLE_SET.has(value);
}

/**
 * Origem de uma mutacao. AUTHOR = acao do dono da review (gated por estado da
 * conta). MODERATION = acao administrativa (pressupoe contexto autorizado
 * futuro; NAO reutiliza o gate do autor). Modeladas separadas de proposito.
 */
export const MUTATION_ORIGINS = ["author", "moderation"] as const;
export type MutationOrigin = (typeof MUTATION_ORIGINS)[number];

/**
 * Fotografia da review JA persistida (pre-imagem lida pela persistencia).
 * Espelha as colunas de dominio de `user_reviews` (sem PII; sem colunas
 * DB-managed alem das necessarias a decisao).
 */
export interface ReviewSnapshot {
  readonly entityType: ReviewableEntityType;
  readonly entityId: bigint;
  readonly title: string | null;
  readonly body: string;
  readonly containsSpoiler: boolean;
  readonly status: ReviewModerationStatus;
  readonly visibility: Visibility;
  readonly deletedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Planos de mutacao do AUTOR
// ---------------------------------------------------------------------------

export type ReviewPlanKind = "create" | "update" | "withdraw" | "restore" | "noop";

/**
 * Subconjunto de colunas a persistir. Ausente = nao muda. So conceitos de
 * review — nunca nota numerica, fonte externa ou Cinerie Score.
 */
export interface ReviewChanges {
  readonly title?: string | null;
  readonly body?: string;
  readonly containsSpoiler?: boolean;
  readonly visibility?: Visibility;
  readonly status?: ReviewModerationStatus;
  readonly publishedAt?: Date | null;
  readonly deletedAt?: Date | null;
}

export interface ReviewMutationPlan {
  readonly kind: ReviewPlanKind;
  readonly entityType: ReviewableEntityType;
  readonly entityId: bigint;
  readonly changes: ReviewChanges;
}

// ---------------------------------------------------------------------------
// Planos de MODERACAO
// ---------------------------------------------------------------------------

export type ModerationPlanKind = "moderate" | "noop";

export interface ModerationPlan {
  readonly kind: ModerationPlanKind;
  /** Colunas de `user_reviews` alteradas pela decisao. */
  readonly changes: { readonly status: ReviewModerationStatus; readonly publishedAt: Date | null };
  /** Revisor humano identificado (nunca "agent"/"system"). */
  readonly decidedBy: string;
  /**
   * Motivo fechado (reutiliza ReportReason, enum real) e nota interna
   * limitada. NAO ha coluna dedicada em `user_reviews` — destino e um audit
   * sink futuro (SCHEMA_CLEANUP_FUTURE). NUNCA entram na projecao publica.
   */
  readonly reasonCode: ReportReason | null;
  readonly moderationNote: string | null;
}

// ---------------------------------------------------------------------------
// Planos de DENUNCIA
// ---------------------------------------------------------------------------

export type ReportPlanKind = "report" | "noop";

export interface ReportPlan {
  readonly kind: ReportPlanKind;
  readonly reviewId: bigint;
  readonly reporterId: bigint;
  readonly reason: ReportReason;
  readonly detail: string | null;
  /** Denuncia nasce sempre `open` (nunca decide sozinha). */
  readonly status: "open";
}
