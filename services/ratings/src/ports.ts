/**
 * ports.ts — Portas (interfaces) do worker de ratings. Modulo PURO.
 *
 * A orquestracao (`film-show-ratings/run.ts`) depende SO destas interfaces —
 * nunca do Prisma nem do client HTTP concreto. Isso mantem o core testavel com
 * fakes em memoria; os adapters reais vivem em `persistence/*` (tocam o Prisma
 * Client gerado).
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

/**
 * Uma entidade local candidata a enriquecimento por `/item/`.
 *
 * So entidades com `imdbId` (o `/item/` foi validado com IMDb id) entram na
 * lista — a selecao NUNCA casa por titulo/ano.
 */
export interface RatingsEntityCandidate {
  readonly entityType: RatingsEntityType
  /** Id local (BigInt serializado como string). */
  readonly entityId: string
  /** IMDb id (`tt<digitos>`), sempre presente para um candidato. */
  readonly imdbId: string
  readonly tmdbId: number | null
}

/**
 * Porta de SELECAO de candidatos locais por tipo, para o modo sem `--id`.
 *
 * Complementa `EntityLookupPort` (que resolve UM id): aqui listamos ate `limit`
 * entidades locais com IMDb id, em ordem estavel, para enriquecer via `/item/`.
 */
export interface EntityCandidateSelectPort {
  selectByType(
    entityType: RatingsEntityType,
    limit: number,
  ): Promise<readonly RatingsEntityCandidate[]>
}

/** Uma selecao de candidatos que ja levou o frescor em conta. */
export interface StaleCandidateSelection {
  /** Candidatos a consultar (ja excluidos os recentes). */
  readonly candidates: readonly RatingsEntityCandidate[]
  /**
   * Quantas entidades foram PULADAS por terem coleta recente demais. Reportado
   * ao operador: "0 consultados" com 40 pulados e um resultado saudavel, e sem
   * este numero pareceria falha.
   */
  readonly skippedFresh: number
}

/**
 * Porta de selecao de candidatos que PRECISAM de re-consulta.
 *
 * Separada de `EntityCandidateSelectPort` de proposito: aquela lista candidatos
 * por tipo, sem olhar o relogio. Esta aplica a janela de frescor
 * (`omdbRefreshCutoff`) para nao queimar cota reconfirmando nota que nao mudou.
 * Manter as duas evita mudar a semantica do adapter antigo.
 */
export interface StaleEntityCandidateSelectPort {
  /**
   * Ate `limit` entidades do tipo, com IMDb id, cuja nota mais recente daquele
   * `providerApi` foi coletada ANTES de `cutoff` (ou que nunca foram coletadas).
   * `cutoff = null` desliga o filtro de frescor (sem politica declarada).
   */
  selectStaleByType(input: {
    readonly entityType: RatingsEntityType
    readonly limit: number
    readonly providerApi: string
    readonly cutoff: Date | null
  }): Promise<StaleCandidateSelection>
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
