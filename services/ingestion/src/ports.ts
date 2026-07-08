/**
 * ports.ts — Portas (interfaces) da ingestao.
 *
 * A orquestracao (import/*) depende SO destas interfaces — nunca do Prisma nem
 * do client TMDB concretos. Isso mantem a orquestracao pura e testavel com
 * fakes em memoria; os adapters reais (persistence/*) vivem fora do typecheck.
 */

import type {
  TmdbMovieDetail,
  TmdbMoviePage,
  TmdbPersonDetail,
  TmdbSeasonDetail,
  TmdbTvDetail,
  UpcomingMoviesParams,
} from '@screena/tmdb-client'
import type {
  CastMemberInput,
  CrewMemberInput,
  EpisodeUpsert,
  ExternalIdInput,
  MovieUpsert,
  PersonUpsert,
  SeasonUpsert,
  TvShowUpsert,
} from './types.js'

/** Status de um ciclo de sync (espelha o enum SyncStatus). */
export type SyncStatus = 'success' | 'partial' | 'failed' | 'empty' | 'aborted'

/** Carimbos de frescor a gravar na entidade. */
export interface SyncTimestamps {
  readonly lastSyncedAt: Date
  readonly staleAfter: Date | null
}

/** Resultado de um upsert (para contagem em api_sync_logs). */
export interface UpsertOutcome {
  /** Id interno (BigInt serializado como string). */
  readonly id: string
  /** true se a linha foi criada; false se atualizada. */
  readonly created: boolean
}

/** Resultado do upsert de uma temporada com seus episodios. */
export interface SeasonUpsertOutcome extends UpsertOutcome {
  readonly episodesUpserted: number
}

/** Porta de leitura TMDB (client real ou fake de teste). */
export interface TmdbReadPort {
  getMovie(tmdbId: number): Promise<TmdbMovieDetail>
  getTvShow(tmdbId: number): Promise<TmdbTvDetail>
  getTvSeason(tvTmdbId: number, seasonNumber: number): Promise<TmdbSeasonDetail>
  getPerson(tmdbId: number): Promise<TmdbPersonDetail>
  /**
   * Lista de filmes com estreia futura (`/movie/upcoming`) — endpoint de
   * CATALOGO (descoberta de ids para "Em breve"), consumido offline pelo backfill
   * de ingestao. Faz parte do contrato de leitura desde a Fase 1.1D.
   */
  getUpcomingMovies(params?: UpcomingMoviesParams): Promise<TmdbMoviePage>
}

/** Entrada de uma busca cacheada. */
export interface CacheFetchInput<T> {
  readonly endpoint: string
  readonly params?: Record<string, string | number | undefined>
  readonly fetcher: () => Promise<T>
}

/** Resultado de uma busca cacheada. */
export interface CacheResult<T> {
  readonly data: T
  /** true se veio do cache dentro do TTL (sem ir a rede). */
  readonly fromCache: boolean
  /** Hash do payload bruto. */
  readonly payloadHash: string
  /** true se o payload mudou em relacao ao ultimo armazenado (ou e novo). */
  readonly changed: boolean
}

/** Porta de cache bruto (api_cache) com short-circuit por payload hash. */
export interface CachePort {
  getOrFetch<T>(input: CacheFetchInput<T>): Promise<CacheResult<T>>
}

/** Porta de log de sync (api_sync_logs). */
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

/** Porta de log de sync. */
export interface SyncLogPort {
  write(input: SyncLogInput): Promise<void>
}

/** Entrada de upsert de filme. */
export interface StoreMovieInput {
  readonly movie: MovieUpsert
  readonly externalIds: readonly ExternalIdInput[]
  readonly cast: readonly CastMemberInput[]
  readonly crew: readonly CrewMemberInput[]
  readonly timestamps: SyncTimestamps
}

/** Entrada de upsert de serie. */
export interface StoreTvShowInput {
  readonly tvShow: TvShowUpsert
  readonly externalIds: readonly ExternalIdInput[]
  readonly cast: readonly CastMemberInput[]
  readonly crew: readonly CrewMemberInput[]
  readonly timestamps: SyncTimestamps
}

/** Entrada de upsert de temporada (com episodios). */
export interface StoreSeasonInput {
  readonly tvShowTmdbId: number
  readonly season: SeasonUpsert
  readonly episodes: readonly EpisodeUpsert[]
  readonly lastSyncedAt: Date
}

/** Entrada de upsert de pessoa. */
export interface StorePersonInput {
  readonly person: PersonUpsert
  readonly externalIds: readonly ExternalIdInput[]
  readonly lastSyncedAt: Date
}

/** Porta de persistencia de entidades (upserts idempotentes + touch de frescor). */
export interface EntityStorePort {
  upsertMovie(input: StoreMovieInput): Promise<UpsertOutcome>
  touchMovie(tmdbId: number, timestamps: SyncTimestamps): Promise<boolean>
  upsertTvShow(input: StoreTvShowInput): Promise<UpsertOutcome>
  touchTvShow(tmdbId: number, timestamps: SyncTimestamps): Promise<boolean>
  upsertSeasonWithEpisodes(input: StoreSeasonInput): Promise<SeasonUpsertOutcome>
  touchSeason(tvShowTmdbId: number, seasonNumber: number, lastSyncedAt: Date): Promise<boolean>
  upsertPerson(input: StorePersonInput): Promise<UpsertOutcome>
  touchPerson(tmdbId: number, lastSyncedAt: Date): Promise<boolean>
}
