/**
 * import/types.ts — Contexto e resultado da orquestracao de import.
 *
 * A orquestracao depende SO de ports (sem Prisma/TMDB concretos), o que a torna
 * pura e testavel com fakes em memoria.
 */

import type { CatalogDisplayFields } from '../display-fields.js'
import type { CachePort, EntityStorePort, SyncLogPort, SyncStatus, TmdbReadPort } from '../ports.js'
import type { EntityType } from '../types.js'
import type { DetailWatchReport, DetailWatchSink } from '../watch-providers/from-detail.js'

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
  /**
   * Sink de disponibilidade ("onde assistir").
   *
   * O detalhe TMDB JA traz o bloco `watch/providers` (o append real e o RICO de
   * `api-clients/tmdb/src/append-to-response.ts`); sem este sink, o import
   * apenas o descartava — e um `catalog sync` respondia `N ok` sem materializar
   * uma unica oferta. Ver `src/watch-providers/from-detail.ts`.
   *
   * Opcional porque nem todo runtime de import escreve oferta (fakes de teste,
   * caminhos de reparo). A ausencia NAO e silenciosa: vira o desfecho nomeado
   * `not-configured` em `ImportResult.watch`.
   */
  readonly watch?: DetailWatchSink
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
  /**
   * Desfecho da ingestao de disponibilidade, SEMPRE presente.
   *
   * Obrigatorio (nao opcional) de proposito: o defeito que este campo fecha e
   * um comando que respondia `39 ok` enquanto nenhuma das 39 entidades ganhava
   * uma oferta. Um campo opcional deixaria o silencio de volta — `undefined` e
   * indistinguivel de "nao havia oferta". Com o desfecho nomeado, "nao tentei"
   * (`not-configured`), "nao da para saber" (`unrecognized`), "nao tem oferta"
   * (`empty`) e "tem, mas fora do escopo" (`out-of-scope`) sao legiveis e
   * distintos.
   */
  readonly watch: DetailWatchReport
  /** Temporadas upsertadas (apenas series). */
  readonly seasons?: number
  /** Episodios upsertados (apenas series). */
  readonly episodes?: number
  /** Mensagem de erro quando status != success. */
  readonly error?: string
  /**
   * Codigo do erro (driver/HTTP quando existe; senao o `name`).
   *
   * Existe porque o unico consumidor de `error` e um embrulho que vira excecao
   * do worker, e o worker CLASSIFICA por `code`. Sem carregar o codigo aqui, o
   * embrulho so tinha o STATUS do import (`failed`) para oferecer — e toda
   * falha de banco ou de rede chegava a metrica como `error_class: "unknown"`.
   */
  readonly errorCode?: string
  /** Status HTTP quando o erro carrega um (classifica 404/429/5xx corretamente). */
  readonly errorStatus?: number
}
