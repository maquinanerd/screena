/**
 * store-port.ts — Porta da persistencia da busca (PURO).
 *
 * O adapter Prisma real (`createPrismaSearchStore`) implementa isto em
 * services/ingestion/src/persistence/search-store.ts.
 * A leitura (`search`) roda a consulta parametrizada de query.ts; a escrita
 * (`upsertDocument`) mantem uma linha por (entityType, entityId, locale).
 */

import type { SearchDocumentRow, SearchEntityType } from './projection.js'
import type { SearchMatchReason, SearchQueryOptions } from './query.js'

/** Um resultado de busca (ja pronto para virar SearchResult publico). */
export interface SearchResultRow {
  readonly entityType: SearchEntityType
  readonly entityId: string
  readonly title: string
  readonly subtitle: string | null
  readonly year: number | null
  readonly imagePath: string | null
  readonly canonicalUrl: string | null
  readonly matchReason: SearchMatchReason
  readonly score: number
}

/** Porta de persistencia/leitura da busca. */
export interface SearchStorePort {
  /** Upsert idempotente de uma linha de projecao (por chave natural). */
  upsertDocument(row: SearchDocumentRow): Promise<void>
  /** Remove a projecao de uma entidade/locale (ex.: entidade despublicada). */
  deleteDocument(entityType: SearchEntityType, entityId: string, locale: string): Promise<void>
  /** Busca ranqueada. Termo vazio (so espacos/acentos) retorna []. */
  search(rawTerm: string, options: SearchQueryOptions): Promise<SearchResultRow[]>
}
