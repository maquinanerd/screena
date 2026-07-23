/**
 * types.ts — Tipos do dominio de AVALIACAO DE USUARIO (nota pessoal) da Cinerie
 * (Backend C, unidade C5A).
 *
 * PURO: sem rede, sem DB, sem IO, sem relogio. Universo PROPRIO, sem qualquer
 * relacao com:
 *  - ratings externos (IMDb, Rotten Tomatoes, Metacritic, Letterboxd,
 *    FilmAffinity) — invariantes 1/2: nota de usuario nunca vira nota de fonte
 *    externa, nunca e reescalada, nunca recebe rotulo de marca de terceiro;
 *  - o Cinerie Score editorial — uma nota individual NUNCA o calcula, autoriza
 *    ou alimenta;
 *  - reviews textuais (titulo, corpo, spoiler, moderacao) — que sao a unidade
 *    C5B, dominio separado.
 *
 * Fonte de verdade: docs/product/user-product-decisions.md secao 1 (escala) +
 * packages/db/prisma/schema.prisma model UserRating. Divergencia = bug; alinhe
 * pelo schema/decisoes, nunca o contrario.
 *
 * DECISAO REGISTRADA (spoiler): a coluna `user_ratings.contains_spoiler` existe
 * no schema (@default(false)), mas a flag de spoiler e decisao de REVIEW
 * (decisoes de produto secao 5) — a nota numerica pura nao a carrega. O dominio
 * de ratings NAO expoe esse campo; a coluna fica no default ate a unidade C5B
 * (reviews) tratar spoiler. Nao alteramos o schema.
 */

import { RATABLE_ENTITY_TYPES, type RatableEntityType } from "../core/types.js";

export { RATABLE_ENTITY_TYPES };
export type { RatableEntityType };

/** Escala canonica e UNICA da nota de usuario (denominador fixo = 5). */
export const USER_RATING_SCALE = 5 as const;
export type UserRatingScale = typeof USER_RATING_SCALE;

/** Passo minimo entre notas (meia estrela). Grade valida: 0.5, 1, ..., 5. */
export const USER_RATING_STEP = 0.5 as const;

/** Menor nota valida (nunca zero). */
export const USER_RATING_MIN = 0.5 as const;

const RATABLE_SET: ReadonlySet<string> = new Set(RATABLE_ENTITY_TYPES);

/**
 * Guard fail-closed: `value` e um RatableEntityType canonico
 * (movie | tv | season | episode). `person` — e qualquer outro valor — e
 * SEMPRE falso (CHECK do banco: rating/review nunca aponta para person).
 */
export function isRatableEntityType(value: unknown): value is RatableEntityType {
  return typeof value === "string" && RATABLE_SET.has(value);
}

/**
 * Converte uma nota em unidades inteiras de meia-estrela (0.5 -> 1, 5 -> 10).
 * Serve para COMPARACAO canonica (evita fragilidade de ponto flutuante ao
 * detectar idempotencia). NAO arredonda uma nota fora da grade para um valor
 * "proximo": quem chama valida antes; aqui so canonicaliza uma nota ja valida.
 */
export function toHalfStarUnits(value: number): number {
  return Math.round(value * 2);
}

/** Evento append-only emitido ao DEFINIR/atualizar uma nota. */
export interface RatingSetEvent {
  readonly eventType: "rating_set";
  readonly occurredAt: Date;
}

/** Evento append-only emitido ao REMOVER uma nota. */
export interface RatingRemovedEvent {
  readonly eventType: "rating_removed";
  readonly occurredAt: Date;
}

export type RatingEvent = RatingSetEvent | RatingRemovedEvent;

/**
 * Fotografia da nota JA persistida (pre-imagem lida pela persistencia e passada
 * ao planner). Espelha SO as colunas de dominio de `user_ratings` — sem PII,
 * sem colunas DB-managed (created_at/updated_at).
 *
 * VERSIONAMENTO: `user_ratings` NAO tem coluna `version` (ao contrario de
 * `user_watch_states`, decisoes de produto secao 3). Optimistic locking por
 * versao NAO e suportado pelo schema (ver policy.ts). A pre-imagem existe para
 * a escrita condicional transacional futura, guardada pelo indice unico
 * (user_id, entity_type, entity_id).
 */
export interface UserRatingSnapshot {
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
  readonly value: number;
  readonly scale: UserRatingScale;
}

/** Intencao de mutacao resolvida pelo planner (nunca executa persistencia). */
export type UserRatingPlanKind = "create" | "update" | "remove" | "noop";

/**
 * Plano EXPLICITO de mutacao de nota (pronto para a persistencia transacional).
 * Carrega SO conceitos de nota de usuario: nunca fonte externa, nunca Cinerie
 * Score, nunca conteudo de review.
 */
export interface UserRatingMutationPlan {
  readonly kind: UserRatingPlanKind;
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
  /** Nota a persistir em create/update; null em remove e em noop-sobre-ausente. */
  readonly value: number | null;
  /** Escala fixa 5 (nunca escala de fonte externa). */
  readonly scale: UserRatingScale;
  /** Eventos append-only a registrar; [] em noop. */
  readonly events: ReadonlyArray<RatingEvent>;
}
