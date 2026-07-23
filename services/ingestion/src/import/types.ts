/**
 * import/types.ts — Contexto e resultado da orquestracao de import.
 *
 * A orquestracao depende SO de ports (sem Prisma/TMDB concretos), o que a torna
 * pura e testavel com fakes em memoria.
 */

import type { CatalogDisplayFields } from '../display-fields.js'
import type { CachePort, EntityStorePort, SyncLogPort, SyncStatus, TmdbReadPort } from '../ports.js'
import type { EntityType } from '../types.js'

/** Dependencias injetadas na orquestracao. */
export interface ImportContext {
  readonly tmdb: TmdbReadPort
  readonly cache: CachePort
  readonly store: EntityStorePort
  readonly syncLog: SyncLogPort
  /** Relogio injetavel (default: () => new Date() no wiring real). */
  readonly now: () => Date
  /** Politica de frescor: calcula `stale_after` a partir de agora. */
  readonly staleAfter: (now: Date) => Date | null
}

/** Resultado de uma operacao de import (por entidade). */
export interface ImportResult {
  readonly entityType: EntityType
  readonly tmdbId: number
  readonly status: SyncStatus
  /** true se o payload mudou (e houve upsert); false se short-circuit (touch). */
  readonly changed: boolean
  /** true se a entidade foi criada agora. */
  readonly created: boolean
  /** Id interno da entidade (quando houve upsert). */
  readonly id: string | null
  /**
   * Titulo/sinopse de exibicao lidos do payload, quando houve upsert.
   *
   * Existe para a FINALIZACAO editorial (slug canonico + traducao pt-BR) poder
   * acontecer no caminho da fila duravel (`sync_details`), do mesmo jeito que
   * ja acontece na promocao de `tmdb_raw`. Sem isto, o import direto gravava a
   * ficha tipada e parava ali — sem slug a entidade nao tem rota publica, nao
   * entra na busca e nao entra no sitemap.
   *
   * `undefined` no caminho `changed === false` (short-circuit/touch): ali nao
   * houve upsert, entao nao ha id para finalizar.
   */
  readonly display?: CatalogDisplayFields
  /** Numero de chamadas de rede TMDB consumidas (cache hit = 0). */
  readonly quotaCost: number
  /** Temporadas upsertadas (apenas series). */
  readonly seasons?: number
  /** Episodios upsertados (apenas series). */
  readonly episodes?: number
  /** Mensagem de erro quando status != success. */
  readonly error?: string
}
