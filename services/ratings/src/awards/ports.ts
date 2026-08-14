/**
 * ports.ts — Portas do promotor de premiacao. Modulo PURO.
 *
 * Nenhuma delas fala com a rede: a unica origem de dado e `api_cache`, que ja
 * esta no banco. Os adapters concretos vivem em `../persistence/*`.
 */

import type {
  AwardsCreditResolution,
  CachedOmdbPayload,
  EntityAwardRow,
  EntityAwardUpsertOutcome,
} from './types.js'

/** Le os payloads OMDb ja em `api_cache`. Somente leitura. */
export interface AwardsCacheSourcePort {
  /** Ate `limit` payloads, em ordem ESTAVEL (id crescente). */
  list(limit: number): Promise<readonly CachedOmdbPayload[]>
}

/** Resolve a licenca/credito vigente de premiacao. */
export interface AwardsCreditPort {
  /**
   * Sem parametro de fonte DE PROPOSITO: quem nomeia a fonte editorial do fato
   * e a licenca registrada, nao o worker. Se o worker recebesse a fonte como
   * argumento, alguem acabaria passando `"imdb"` a mao — e o credito viraria um
   * palpite do codigo em vez de uma decisao registrada.
   */
  resolve(): Promise<AwardsCreditResolution>
}

/** Escreve em `entity_awards`. Idempotente por (entity, provider). */
export interface EntityAwardsPort {
  upsert(row: EntityAwardRow): Promise<EntityAwardUpsertOutcome>
}
