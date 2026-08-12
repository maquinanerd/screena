/**
 * types.ts — Portas e relatorio do reprocessamento de `watch/providers`.
 * Modulo PURO (sem Prisma, sem rede).
 *
 * O reprocessamento le `tmdb_raw` (payload JA arquivado) e escreve
 * `watch_availability`. ZERO chamada ao TMDB: um "reprocessamento" que refizesse
 * fetch seria um sync disfarcado, com custo de cota escondido — a mesma regra
 * que `reprocess_raw` ja declara.
 */

import type {
  WatchProviderOffer,
  WatchProviderRejection,
  WatchProviderRejectionReason,
  WatchProvidersEntityType,
} from '../normalizers/watch-providers.js'

/** Uma linha bruta lida de `tmdb_raw`. */
export interface RawWatchSourceRow {
  readonly tmdbId: number
  readonly baseLanguage: string
  readonly payload: unknown
}

/** Porta de leitura do bruto arquivado, por tipo de entidade. */
export interface RawWatchSource {
  count(entityType: WatchProvidersEntityType): Promise<number>
  list(
    entityType: WatchProvidersEntityType,
    limit: number,
  ): Promise<readonly RawWatchSourceRow[]>
}

/** Uma entidade local ja resolvida (tmdbId -> id interno). */
export interface ResolvedWatchEntity {
  readonly tmdbId: number
  /** Id interno (BigInt serializado como string). */
  readonly entityId: string
}

/**
 * Porta de resolucao tmdbId -> id interno.
 *
 * Separada da escrita de proposito: uma entidade presente em `tmdb_raw` mas
 * ainda NAO promovida para `movies`/`tv_shows` nao tem id interno, e gravar
 * oferta apontando para id inexistente violaria a FK. O desfecho e
 * `unresolved` — contado e nomeado, nunca descartado em silencio.
 */
export interface WatchEntityResolver {
  resolve(
    entityType: WatchProvidersEntityType,
    tmdbIds: readonly number[],
  ): Promise<readonly ResolvedWatchEntity[]>
}

/** Resultado de um replace de snapshot por (entidade, pais). */
export interface WatchSnapshotOutcome {
  /** Linhas inseridas ou atualizadas por identidade. */
  readonly upserted: number
  /** Ofertas que sumiram do snapshot: revogadas + marcadas stale, nunca apagadas. */
  readonly revoked: number
}

/**
 * Porta de escrita em `watch_availability`, escopada por
 * (entidade, pais, `provider_api` deste worker).
 *
 * Toda linha nasce `display_allowed = false` (invariante 6). Este contrato NAO
 * expoe nenhum campo de licenca/atribuicao/revisao: acender a exibicao e
 * decisao HUMANA, feita por outro caminho.
 */
export interface WatchOfferStore {
  replaceSnapshot(input: {
    readonly entityType: WatchProvidersEntityType
    readonly entityId: string
    readonly countryCode: string
    readonly offers: readonly WatchProviderOffer[]
    readonly fetchedAt: Date
    readonly staleAfter: Date
  }): Promise<WatchSnapshotOutcome>
}

/** Desfecho de UMA entidade reprocessada. */
export type WatchReprocessOutcome =
  /** Ofertas reconhecidas e gravadas (ou planejadas, em dry-run). */
  | 'applied'
  /** Payload reconhecido, zero pais com oferta: o titulo nao tem oferta. */
  | 'empty'
  /** Payload NAO reconhecido: snapshot preservado, nada tocado. */
  | 'unrecognized'
  /** Entidade ainda nao promovida para a tabela tipada: sem id interno. */
  | 'unresolved'
  /** Erro na escrita. Sempre acompanhado da causa em `failures`. */
  | 'failed'

/** Contagem por desfecho. */
export interface WatchReprocessCounts {
  readonly scanned: number
  readonly applied: number
  readonly empty: number
  readonly unrecognized: number
  readonly unresolved: number
  readonly failed: number
  readonly offersUpserted: number
  readonly offersRevoked: number
}

/** Uma falha nomeada. O erro NUNCA evapora: classe + mensagem sanitizada. */
export interface WatchReprocessFailure {
  readonly tmdbId: number
  readonly errorClass: string
  readonly message: string
}

/** Quantas vezes cada motivo de recusa apareceu no lote. */
export type WatchRejectionTally = Readonly<Partial<Record<WatchProviderRejectionReason, number>>>

/** Relatorio de um ciclo de reprocessamento. */
export interface WatchReprocessReport {
  readonly entityType: WatchProvidersEntityType
  readonly counts: WatchReprocessCounts
  readonly failures: readonly WatchReprocessFailure[]
  /** Recusas agregadas por motivo — nenhum descarte fica anonimo. */
  readonly rejections: WatchRejectionTally
  /**
   * Provedores TMDB distintos vistos, com contagem. Serve para preparar os
   * `watch_provider_aliases`: sem alias, a oferta e ingerida e auditavel mas o
   * trigger de governanca nao a deixa exibir.
   */
  readonly providersSeen: readonly { readonly providerKey: string; readonly providerName: string; readonly offers: number }[]
  readonly countriesSeen: readonly string[]
  readonly durationMs: number
  readonly dryRun: boolean
}

/** Status derivado do ciclo (espelha o enum `SyncStatus`). */
export type WatchReprocessStatus = 'success' | 'partial' | 'failed' | 'empty'

export type { WatchProviderOffer, WatchProviderRejection, WatchProvidersEntityType }
