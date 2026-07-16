/**
 * store-port.ts — Porta de persistencia das entidades de referencia (PURO).
 *
 * O adapter Prisma (`createPrismaCatalogEntitiesStore`) implementa isto em
 * services/ingestion/src/persistence/catalog-entities-store.ts (excluido do
 * typecheck). A porta fala em IDs TMDB (a chave natural do payload); o adapter
 * resolve para os ids internos e faz o link.
 */

import type {
  AlternativeTitleRow,
  CollectionPartRow,
  CollectionRow,
  CompanyRow,
  KeywordRow,
  NetworkRow,
} from './normalize.js'

/** Tipo de entidade que pode ter referencias (so movie/tv). */
export type ReferenceOwnerType = 'movie' | 'tv'

/** Contagens de um ciclo de sync de referencias. */
export interface CatalogEntitiesSyncResult {
  readonly collections: number
  readonly companies: number
  readonly networks: number
  readonly keywords: number
  readonly alternativeTitles: number
}

/** Entrada do sync de referencias de UMA entidade (movie|tv). */
export interface SyncEntityReferencesInput {
  readonly entityType: ReferenceOwnerType
  readonly entityTmdbId: number
  readonly collection: CollectionRow | null
  readonly companies: readonly CompanyRow[]
  readonly networks: readonly NetworkRow[]
  readonly keywords: readonly KeywordRow[]
  readonly alternativeTitles: readonly AlternativeTitleRow[]
}

/** Porta de persistencia das entidades de referencia. Idempotente por natureza. */
export interface CatalogEntitiesStorePort {
  /**
   * Persiste (upsert + link) colecao/produtoras/redes/keywords/titulos
   * alternativos de UMA entidade. Idempotente: reexecutar nao duplica. Se a
   * entidade dona nao estiver promovida (tmdbId desconhecido), retorna zeros.
   */
  syncEntityReferences(input: SyncEntityReferencesInput): Promise<CatalogEntitiesSyncResult>
  /** Upsert de colecao completa (GET dedicado) + vinculo dos filmes membros ja promovidos. */
  upsertCollectionWithParts(
    collection: CollectionRow,
    parts: readonly CollectionPartRow[],
  ): Promise<number>
  upsertCompany(row: CompanyRow): Promise<void>
  upsertNetwork(row: NetworkRow): Promise<void>
  upsertKeyword(row: KeywordRow): Promise<void>
}
