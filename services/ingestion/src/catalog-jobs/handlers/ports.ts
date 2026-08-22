/**
 * ports.ts — Portas de servico consumidas pelos handlers (PURO).
 *
 * Os handlers vivem no lado TIPADO da fronteira: eles nao conhecem Prisma nem
 * fetch. Falam por estas portas, e o wiring real (adapters Prisma + client TMDB)
 * acontece em `bin/catalog.ts` / `composition.ts`.
 *
 * Consequencia pratica: todo handler e testavel com fakes em memoria, e um erro
 * de assinatura aqui QUEBRA o typecheck.
 *
 * Nomenclatura: `skipped` significa "a entidade dona nao esta promovida ainda";
 * nunca e sucesso silencioso. O handler propaga isso no resultado.
 */

import type { CreditKind, ExternalIdKind, MediaKind, SyncDetailKind } from './schemas.js'
import type { ChangesKind } from '../../discovery/changes-plan.js'
import type { DetailWatchOutcome } from '../../watch-providers/from-detail.js'

/** Desfecho de um upsert de detalhe. Exatamente um dos tres booleanos e true. */
export interface DetailSyncOutcome {
  readonly created: boolean
  readonly updated: boolean
  readonly unchanged: boolean
  /** Id interno da entidade quando conhecido (para reprojetar a busca). */
  readonly entityId: string | null
  /** true quando nada foi feito por falta de pre-requisito (ex.: nao promovida). */
  readonly skipped: boolean
  /** Motivo curto e seguro do skip (sem PII). */
  readonly skipReason: string | null
  /**
   * Desfecho NOMEADO da disponibilidade ("onde assistir") deste detalhe.
   *
   * Existe porque um sync que dizia `39 ok` e nao materializava uma unica oferta
   * estava certo sobre si mesmo e inutil para quem o chamou: o operador nao
   * tinha como distinguir "os titulos nao tem oferta" de "o dado nunca foi
   * reconhecido". Ver `src/watch-providers/from-detail.ts`.
   */
  readonly watchOutcome: DetailWatchOutcome
  /** Ofertas inseridas/atualizadas neste detalhe (0 fora de `applied`). */
  readonly watchOffers: number
}

/** Entrada comum de um sync de detalhe. */
export interface DetailSyncInput {
  readonly kind: SyncDetailKind
  readonly tmdbId: number
  readonly locale: string
  readonly signal: AbortSignal
}

/** Sync do detalhe de uma entidade: fetch -> cache -> raw -> normalize -> store. */
export interface CatalogDetailSyncPort {
  syncDetail(input: DetailSyncInput): Promise<DetailSyncOutcome>
}

/** Contagens de um sync de creditos. */
export interface CreditsSyncOutcome {
  readonly cast: number
  readonly crew: number
  readonly guestStars: number
  readonly skipped: boolean
  readonly skipReason: string | null
}

/** Entrada de um sync de creditos. */
export interface CreditsSyncInput {
  readonly kind: CreditKind
  readonly tmdbId: number
  readonly seasonNumber: number | null
  readonly episodeNumber: number | null
  readonly locale: string
  readonly signal: AbortSignal
}

/** Sync de elenco/equipe/guest stars. */
export interface CatalogCreditsSyncPort {
  syncCredits(input: CreditsSyncInput): Promise<CreditsSyncOutcome>
}

/** Contagens de um sync de ids externos. */
export interface ExternalIdsSyncOutcome {
  readonly upserted: number
  /** Ids que mudaram de valor (identidade externa alterada upstream). */
  readonly changed: number
  readonly skipped: boolean
  readonly skipReason: string | null
}

/** Entrada de um sync de ids externos. */
export interface ExternalIdsSyncInput {
  readonly kind: ExternalIdKind
  readonly tmdbId: number
  readonly seasonNumber: number | null
  readonly episodeNumber: number | null
  readonly signal: AbortSignal
}

/** Sync de ids externos (imdb/tvdb/wikidata...). NUNCA e fonte de rating. */
export interface CatalogExternalIdsSyncPort {
  syncExternalIds(input: ExternalIdsSyncInput): Promise<ExternalIdsSyncOutcome>
}

/** Contagens de um sync de midia. */
export interface MediaSyncOutcome {
  readonly images: number
  readonly videos: number
  readonly skipped: boolean
  readonly skipReason: string | null
}

/** Entrada de um sync de midia. */
export interface MediaSyncInput {
  readonly kind: MediaKind
  readonly tmdbId: number
  readonly seasonNumber: number | null
  readonly episodeNumber: number | null
  readonly locale: string
  readonly signal: AbortSignal
}

/** Sync de imagens/videos. Toda linha nasce `displayAllowed=false` (invariante 6). */
export interface CatalogMediaSyncPort {
  syncMedia(input: MediaSyncInput): Promise<MediaSyncOutcome>
}

/** Contagens de um sync de temporadas. */
export interface SeasonsSyncOutcome {
  readonly seasons: number
  readonly episodes: number
  /** Numeros de temporada existentes (para enfileirar episodios). */
  readonly seasonNumbers: readonly number[]
  readonly skipped: boolean
  readonly skipReason: string | null
}

/** Entrada de um sync de temporadas. */
export interface SeasonsSyncInput {
  readonly tvTmdbId: number
  readonly locale: string
  readonly signal: AbortSignal
}

/** Sync das temporadas de uma serie. */
export interface CatalogSeasonsSyncPort {
  syncSeasons(input: SeasonsSyncInput): Promise<SeasonsSyncOutcome>
}

/** Contagens de um sync de episodios. */
export interface EpisodesSyncOutcome {
  readonly episodes: number
  readonly cast: number
  readonly guestStars: number
  readonly crew: number
  readonly externalIds: number
  readonly stills: number
  /**
   * Episodios pulados por `tmdbId` nulo. Nao e falha: sem chave natural nao
   * existe episodio para sincronizar, e inventar id seria criar fato.
   */
  readonly skippedNoTmdbId: number
  readonly skipped: boolean
  readonly skipReason: string | null
}

/** Entrada de um sync de episodios de UMA temporada. */
export interface EpisodesSyncInput {
  readonly tvTmdbId: number
  readonly seasonNumber: number
  readonly locale: string
  readonly signal: AbortSignal
}

/** Sync dos episodios de uma temporada (detalhe + creditos + ids + stills). */
export interface CatalogEpisodesSyncPort {
  syncEpisodes(input: EpisodesSyncInput): Promise<EpisodesSyncOutcome>
}

/** Resultado de uma descoberta de ids. */
export interface DiscoverIdsOutcome {
  readonly discovered: number
  readonly accepted: number
  /** Descartados por `adult` true ou malformado (fail-closed). */
  readonly rejectedAdult: number
  readonly duplicate: number
  /** Ids aceitos, ja deduplicados e livres de conteudo adulto. */
  readonly ids: readonly number[]
}

/** Entrada de uma descoberta de ids. */
export interface DiscoverIdsPortInput {
  readonly strategy: string
  readonly kind: ChangesKind
  readonly locale: string
  readonly country: string | null
  readonly limit: number | null
  readonly maxPages: number | null
  /** Usado apenas por `explicit-ids`. */
  readonly ids: readonly number[] | null
  readonly signal: AbortSignal
}

/** Descoberta do universo de ids (Daily ID Exports / listas / discover). */
export interface CatalogDiscoverIdsPort {
  discover(input: DiscoverIdsPortInput): Promise<DiscoverIdsOutcome>
}

/** Resultado de um reprocessamento de raw. */
export interface ReprocessRawOutcome {
  readonly scanned: number
  readonly promoted: number
  readonly unchanged: number
  readonly skipped: number
  readonly failed: number
  /** true quando `dryRun`: nada foi gravado. */
  readonly dryRun: boolean
}

/** Entrada de um reprocessamento de raw. */
export interface ReprocessRawPortInput {
  readonly kind: ChangesKind
  readonly tmdbId: number | null
  readonly baseLanguage: string
  readonly limit: number | null
  readonly dryRun: boolean
  readonly signal: AbortSignal
}

/** Reprocessa `tmdb_raw` JA capturado -> tabelas tipadas. NUNCA chama o TMDB. */
export interface CatalogReprocessRawPort {
  reprocess(input: ReprocessRawPortInput): Promise<ReprocessRawOutcome>
}

/** Uma pagina de lista de descoberta, ja buscada. */
export interface DiscoveryListPage {
  readonly results?: readonly unknown[]
  readonly page?: number | null
  readonly total_pages?: number | null
}

/** Entrada de busca de uma pagina de lista. */
export interface DiscoveryListFetchInput {
  readonly listType: string
  readonly entityType: 'movie' | 'tv'
  readonly locale: string
  readonly country: string | null
  readonly window: string | null
  readonly page: number
  readonly signal: AbortSignal
}

/** Busca de paginas das listas de descoberta (trending/popular/discover/...). */
export interface DiscoveryListFetchPort {
  fetchPage(input: DiscoveryListFetchInput): Promise<DiscoveryListPage>
}

/** Reprojecao da busca apos uma entidade mudar. */
export interface SearchReindexPort {
  /** Reprojeta UMA entidade; remove o documento quando ela some/deixa de indexar. */
  reindexEntity(entityType: 'movie' | 'tv' | 'person', entityId: string, locale: string): Promise<void>
}
