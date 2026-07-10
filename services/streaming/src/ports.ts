/**
 * ports.ts — Portas (interfaces) do worker de disponibilidade. Modulo PURO.
 *
 * A orquestracao depende SO destas interfaces. Os adapters Prisma vivem em
 * `persistence/*` (fora do typecheck).
 */

import type { SelectedEntity, StreamingEntityType, WatchOfferRow } from './streaming-availability/types.js'

/** Status de um ciclo de sync (espelha o enum `SyncStatus` do schema). */
export type SyncStatus = 'success' | 'partial' | 'failed' | 'empty' | 'aborted'

/** Entrada de gravacao em `api_cache`. */
export interface CacheWriteInput {
  readonly endpoint: string
  readonly requestKey: string
  readonly paramsHash: string
  readonly payload: unknown
  readonly payloadHash: string
  readonly fetchedAt: Date
  readonly expiresAt: Date
}

/** Porta de `api_cache` (payload BRUTO; o render nunca le daqui). */
export interface CachePort {
  write(input: CacheWriteInput): Promise<void>
}

/** Entrada de gravacao em `api_sync_logs`. */
export interface SyncLogInput {
  readonly endpoint: string
  readonly status: SyncStatus
  readonly errorCode?: string | null
  readonly itemsProcessed?: number
  readonly itemsCreated?: number
  readonly itemsUpdated?: number
  readonly durationMs?: number | null
  readonly quotaCost?: number | null
  readonly payloadHash?: string | null
}

/** Porta de `api_sync_logs`. Todo sync externo gera log — sem excecao. */
export interface SyncLogPort {
  write(input: SyncLogInput): Promise<void>
}

/** Porta de selecao das entidades a consultar. */
export interface EntitySelectPort {
  /** Entidades com `tmdb_id` (e `imdb_id` quando houver), ordem determinista. */
  select(entityType: StreamingEntityType, limit: number): Promise<readonly SelectedEntity[]>
  /** Uma entidade especifica por TMDB id. */
  findByTmdbId(entityType: StreamingEntityType, tmdbId: number): Promise<SelectedEntity | null>
  /** Uma entidade especifica por IMDb id. */
  findByImdbId(entityType: StreamingEntityType, imdbId: string): Promise<SelectedEntity | null>
}

/** Resultado de um replace de snapshot. */
export interface WatchReplaceOutcome {
  readonly deleted: number
  readonly created: number
}

/**
 * Porta de escrita em `watch_availability`.
 *
 * `watch_availability` NAO tem unique natural, entao a idempotencia vem de um
 * REPLACE TRANSACIONAL do snapshot daquele `(entityType, entityId, countryCode,
 * providerApi)`. Linhas de OUTROS `provider_api` (ex.: seed demo) sao
 * preservadas — o delete e escopado pelo `providerApi` deste worker.
 *
 * Toda linha nasce `display_allowed = false` (invariante 6): a atribuicao
 * exigida pelos termos do provider ainda nao existe na UI.
 */
export interface WatchStorePort {
  replaceSnapshot(input: {
    readonly entityType: StreamingEntityType
    readonly entityId: string
    readonly countryCode: string
    readonly offers: readonly WatchOfferRow[]
    readonly fetchedAt: Date
    readonly staleAfter: Date
  }): Promise<WatchReplaceOutcome>
}
