/**
 * Tipos do dominio de tracking (Backend C, unidade C4).
 *
 * PURO: sem rede, sem DB, sem crypto, sem relogio. Distingue explicitamente as
 * entidades RASTREAVEIS (movie|tv|season|episode) — pessoa/noticia/tipo
 * desconhecido NUNCA sao rastreaveis. Espelha ViewingEventType/WatchState/
 * UserStatus do schema (fonte: core/types.ts).
 */

import type { UserStatus, ViewingEventType, WatchState } from "../core/types.js";

export type { UserStatus, ViewingEventType, WatchState };

// ---------------------------------------------------------------------------
// Entidade rastreavel (discriminada)
// ---------------------------------------------------------------------------

/**
 * Tipos rastreaveis pelo tracking. Deliberadamente NAO inclui `person` (nem
 * qualquer outro): pessoa/noticia nao sao acompanhaveis. Mesmos 4 valores de
 * RATABLE_ENTITY_TYPES, com nome proprio para clareza de dominio.
 */
export const TRACKABLE_ENTITY_TYPES = ["movie", "tv", "season", "episode"] as const;
export type TrackableEntityType = (typeof TRACKABLE_ENTITY_TYPES)[number];

const TRACKABLE_SET: ReadonlySet<string> = new Set(TRACKABLE_ENTITY_TYPES);

/** Guard: valor e um tipo rastreavel conhecido (fail-closed para o resto). */
export function isTrackableEntityType(value: unknown): value is TrackableEntityType {
  return typeof value === "string" && TRACKABLE_SET.has(value);
}

/** Referencia polimorfica a uma entidade rastreavel do catalogo. */
export interface TrackableEntityRef {
  readonly entityType: TrackableEntityType;
  readonly entityId: bigint;
}

// ---------------------------------------------------------------------------
// Eventos de visualizacao (para viewing-events / diario / projecoes)
// ---------------------------------------------------------------------------

/** Origem controlada de um evento (nunca texto livre com segredo). */
export const VIEWING_EVENT_SOURCES = ["app", "import", "derivation"] as const;
export type ViewingEventSource = (typeof VIEWING_EVENT_SOURCES)[number];

/**
 * Evento de visualizacao a REGISTRAR (entrada). Carrega o timestamp EFETIVO
 * (`occurredAt`) — nunca o de chegada. `idempotencyKey` deduplica; `metadata`
 * so dados minimos (sem segredo).
 */
export interface ViewingEventInput {
  readonly userId: bigint;
  readonly entityType: TrackableEntityType;
  readonly entityId: bigint;
  readonly eventType: ViewingEventType;
  readonly occurredAt: Date;
  readonly idempotencyKey: string;
  readonly source: ViewingEventSource;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Evento ja PERSISTIDO (para checagem de idempotencia e projecao do diario).
 * `eventId` e a PK interna (BigInt) — nunca exposta em DTO publico sem decisao.
 */
export interface StoredViewingEvent {
  readonly eventId: bigint;
  readonly userId: bigint;
  readonly entityType: TrackableEntityType;
  readonly entityId: bigint;
  readonly eventType: ViewingEventType;
  readonly occurredAt: Date;
  readonly idempotencyKey: string;
  readonly source: ViewingEventSource;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}
