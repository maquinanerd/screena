/**
 * ports.ts — Portas (interfaces) do worker de ratings. Modulo PURO.
 *
 * A orquestracao (`film-show-ratings/run.ts`) depende SO destas interfaces —
 * nunca do Prisma nem do client HTTP concreto. Isso mantem o core testavel com
 * fakes em memoria; os adapters reais vivem em `persistence/*` (fora do
 * typecheck, pois tocam o Prisma Client gerado).
 */

import type { ExternalRatingRow, RatingsEntityType } from './film-show-ratings/types.js'

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

/** Porta de `api_cache` (grava o payload BRUTO; o render nunca le daqui). */
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

/** Uma entidade local resolvida. */
export interface ResolvedEntity {
  readonly entityType: RatingsEntityType
  /** Id local (BigInt serializado como string). */
  readonly entityId: string
}

/**
 * Porta de resolucao de entidade local a partir de um id externo.
 *
 * Resolve SO por identificador inequivoco. Nunca casa por titulo/ano — isso
 * produziria atribuicao de nota a entidade errada.
 */
export interface EntityLookupPort {
  findByImdbId(entityType: RatingsEntityType, imdbId: string): Promise<ResolvedEntity | null>
  findByTmdbId(entityType: RatingsEntityType, tmdbId: number): Promise<ResolvedEntity | null>
}

/** Resultado de um upsert em `external_ratings`. */
export interface ExternalRatingUpsertOutcome {
  /** A linha foi criada agora? */
  readonly created: boolean
  /**
   * Houve escrita? `false` quando a linha ja existia identica — nesse caso o
   * adapter NAO reescreve nem bumpa `updated_at` (regra de hash de payload).
   */
  readonly changed: boolean
}

/**
 * Porta de escrita em `external_ratings`.
 *
 * Idempotente pelo unique `(entity_type, entity_id, rating_source, metric)`.
 * Toda linha nasce `display_allowed = false` e `license_status = unknown`
 * (invariante 6) — a liberacao e decisao humana, fora do worker.
 */
export interface ExternalRatingsPort {
  upsert(row: ExternalRatingRow): Promise<ExternalRatingUpsertOutcome>
}
