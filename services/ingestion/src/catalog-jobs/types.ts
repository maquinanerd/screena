/**
 * types.ts — Contratos PUROS da fila duravel de jobs do catalogo (Backend A).
 *
 * Espelham os enums CatalogJobType/CatalogJobStatus e o model CatalogJob do
 * PostgreSQL (packages/db), mas sem depender do Prisma: os planejadores deste
 * dominio sao funcoes puras (sem rede/DB/IO), testaveis isoladamente. Os
 * adapters Prisma (claim FOR UPDATE SKIP LOCKED, heartbeat, reclaim) vivem em
 * services/ingestion/src/persistence/ (excluidos do typecheck), como o padrao
 * provado do EntityWriterJob.
 */

/** Tipo do trabalho de catalogo (espelha o enum CatalogJobType do banco). */
export type CatalogJobType =
  | 'bootstrap'
  | 'discover_ids'
  | 'sync_details'
  | 'sync_credits'
  | 'sync_external_ids'
  | 'sync_media'
  | 'sync_seasons'
  | 'sync_episodes'
  | 'sync_lists'
  | 'sync_changes'
  | 'reprocess_raw'

/** Estado do job na fila (espelha o enum CatalogJobStatus do banco). */
export type CatalogJobStatus =
  | 'pending'
  | 'claimed'
  | 'running'
  | 'retry_wait'
  | 'succeeded'
  | 'failed'
  | 'dead_letter'
  | 'cancelled'

/**
 * Alvo do job (espelha TmdbEntityKind — superset de EntityType). Cobre kinds
 * que NAO sao entidades renderizaveis (collection/network/company/keyword),
 * pois a fila orquestra a ingestao inteira, nao so o que vira pagina.
 */
export type CatalogEntityKind =
  | 'movie'
  | 'tv'
  | 'season'
  | 'episode'
  | 'person'
  | 'collection'
  | 'network'
  | 'company'
  | 'keyword'

/** Conjunto canonico dos tipos de job (para validacao/iteracao). */
export const CATALOG_JOB_TYPES: readonly CatalogJobType[] = [
  'bootstrap',
  'discover_ids',
  'sync_details',
  'sync_credits',
  'sync_external_ids',
  'sync_media',
  'sync_seasons',
  'sync_episodes',
  'sync_lists',
  'sync_changes',
  'reprocess_raw',
] as const

/** Estados terminais: nao voltam a ser reivindicados sem replay explicito. */
export const CATALOG_JOB_TERMINAL_STATES: readonly CatalogJobStatus[] = [
  'succeeded',
  'dead_letter',
  'cancelled',
] as const

/** Estados elegiveis a claim (a fila reivindica destes quando available_at chega). */
export const CATALOG_JOB_CLAIMABLE_STATES: readonly CatalogJobStatus[] = [
  'pending',
  'retry_wait',
] as const

/** Estados "em voo" (worker os detem): alvo de reclaim quando o heartbeat expira. */
export const CATALOG_JOB_IN_FLIGHT_STATES: readonly CatalogJobStatus[] = [
  'claimed',
  'running',
] as const

/**
 * Subconjunto do job que os planejadores puros leem para decidir transicoes.
 * Espelha as colunas do CatalogJob relevantes para retry/reclaim.
 */
export interface CatalogJobState {
  readonly status: CatalogJobStatus
  readonly attempts: number
  readonly maxAttempts: number
  /** Ultimo sinal de vida do worker; null enquanto nunca reivindicado. */
  readonly heartbeatAt: Date | null
  readonly claimedAt: Date | null
}

/** Erro seguro (sem PII/segredo) anexavel a um job que falhou. */
export interface SafeJobError {
  readonly code: string | null
  readonly safe: string | null
}
