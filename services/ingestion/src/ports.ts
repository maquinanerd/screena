/**
 * ports.ts — Portas (interfaces) da ingestao.
 *
 * A orquestracao (import/*) depende SO destas interfaces — nunca do Prisma nem
 * do client TMDB concretos. Isso mantem a orquestracao pura e testavel com
 * fakes em memoria; os adapters reais vivem em `persistence/*`.
 */

import type {
  TmdbEpisodeDetail,
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
  TitleRecommendationLink,
  TitleGenreLink,
  TitleCountryLink,
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

/**
 * Resumo da escrita de creditos (replace-set) de um upsert de filme/serie.
 *
 * Existe para que "nao mexi no elenco" e "regravei o elenco" deixem de ser
 * indistinguiveis no relatorio: antes, um payload sem o bloco `credits` apagava
 * o elenco e o ciclo reportava `updated: 1` / `cast: 0` como SUCESSO.
 */
export interface CreditsWriteOutcome {
  /** O replace-set de elenco rodou (a fonte trouxe a lista). */
  readonly castReplaced: boolean
  /** O replace-set de equipe rodou (a fonte trouxe a lista). */
  readonly crewReplaced: boolean
  /** Creditos de elenco efetivamente gravados. */
  readonly castLinked: number
  /** Creditos de equipe efetivamente gravados. */
  readonly crewLinked: number
  /**
   * Creditos de elenco DESCARTADOS por falta de stub de pessoa. Deveria ser
   * sempre 0 (o stub e upsertado a partir do proprio credito); qualquer valor
   * acima disso e perda de dado e precisa aparecer, nunca sumir em silencio.
   */
  readonly castDropped: number
  /** Idem para equipe. */
  readonly crewDropped: number
}

/** Resultado do upsert de filme/serie (upsert + resumo do replace-set de creditos). */
export interface EntityUpsertOutcome extends UpsertOutcome {
  readonly credits: CreditsWriteOutcome
}

/** Porta de leitura TMDB (client real ou fake de teste). */
export interface TmdbReadPort {
  getMovie(tmdbId: number): Promise<TmdbMovieDetail>
  getTvShow(tmdbId: number): Promise<TmdbTvDetail>
  getTvSeason(tvTmdbId: number, seasonNumber: number): Promise<TmdbSeasonDetail>
  /**
   * Detalhe de UM episodio (`/tv/{id}/season/{n}/episode/{e}`), com os appends
   * de `TV_EPISODE_APPEND` (credits, external_ids, images, videos, translations).
   *
   * ENTROU NO CONTRATO EM 2026-08-27, e o motivo importa. `syncEpisodes` lia os
   * episodios do payload de TEMPORADA, cujo `episodes[]` traz so um resumo: sem
   * `credits`, sem `external_ids`, sem `images`. Os normalizadores de episodio
   * — que sempre souberam ler esses blocos — recebiam um objeto que nunca os
   * teve e devolviam listas vazias, contadas como sucesso. A pagina de episodio
   * ficou sem elenco convidado, sem direcao e sem roteiro por falta desta
   * chamada, nao por falta de dado.
   *
   * Custo: UMA requisicao por episodio (os cinco appends cabem no mesmo pedido,
   * bem abaixo do teto de 20 sub-requests).
   */
  getTvEpisode(
    tvTmdbId: number,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<TmdbEpisodeDetail>
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
  /**
   * A FONTE trouxe a lista de elenco (array, mesmo vazio)? OBRIGATORIO (nao
   * opcional) de proposito: um default silencioso reintroduziria o defeito —
   * default `true` apagaria elenco em payload sem `credits`, default `false`
   * impediria para sempre uma limpeza legitima. Cada chamador declara.
   */
  readonly castPresent: boolean
  /** Idem para a lista de equipe. */
  readonly crewPresent: boolean
  /** `recommendations` + `similar`, na ORDEM do TMDB. */
  readonly recommendations: readonly TitleRecommendationLink[]
  /**
   * A FONTE trouxe algum dos dois blocos? OBRIGATORIO pelo MESMO motivo de
   * `castPresent`: raw antigo nao tem os blocos, e le-lo como "lista vazia"
   * apagaria o que ja foi coletado.
   */
  readonly recommendationsPresent: boolean
  /** Generos do titulo, na ORDEM do TMDB. */
  readonly genres: readonly TitleGenreLink[]
  /** Paises de origem (`production_countries`), na ordem do payload. */
  readonly countries: readonly TitleCountryLink[]
  /** Ver `genresPresent`: ausencia do campo nunca e lista vazia. */
  readonly countriesPresent: boolean
  /**
   * A FONTE trouxe o array de generos (mesmo vazio)? OBRIGATORIO pelo MESMO
   * motivo de `castPresent`, e o precedente e literal: creditos ja foram
   * apagados em massa neste repositorio porque um payload sem `credits` foi
   * lido como "lista vazia". Genero tem a mesma forma e o mesmo risco.
   */
  readonly genresPresent: boolean
  readonly timestamps: SyncTimestamps
}

/** Entrada de upsert de serie. */
export interface StoreTvShowInput {
  readonly tvShow: TvShowUpsert
  readonly externalIds: readonly ExternalIdInput[]
  readonly cast: readonly CastMemberInput[]
  readonly crew: readonly CrewMemberInput[]
  /** Ver `StoreMovieInput.castPresent`. */
  readonly castPresent: boolean
  /** Ver `StoreMovieInput.crewPresent`. */
  readonly crewPresent: boolean
  /** Ver `StoreMovieInput.recommendations`. */
  readonly recommendations: readonly TitleRecommendationLink[]
  /** Ver `StoreMovieInput.recommendationsPresent`. */
  readonly recommendationsPresent: boolean
  /** Ver `StoreMovieInput.genres`. */
  readonly genres: readonly TitleGenreLink[]
  /** Ver `StoreMovieInput.genresPresent`. */
  readonly genresPresent: boolean
  /** Paises de origem (`origin_country`), na ordem do payload. */
  readonly countries: readonly TitleCountryLink[]
  /** Ver `StoreMovieInput.countriesPresent`. */
  readonly countriesPresent: boolean
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
  upsertMovie(input: StoreMovieInput): Promise<EntityUpsertOutcome>
  touchMovie(tmdbId: number, timestamps: SyncTimestamps): Promise<boolean>
  upsertTvShow(input: StoreTvShowInput): Promise<EntityUpsertOutcome>
  touchTvShow(tmdbId: number, timestamps: SyncTimestamps): Promise<boolean>
  upsertSeasonWithEpisodes(input: StoreSeasonInput): Promise<SeasonUpsertOutcome>
  touchSeason(tvShowTmdbId: number, seasonNumber: number, lastSyncedAt: Date): Promise<boolean>
  upsertPerson(input: StorePersonInput): Promise<UpsertOutcome>
  touchPerson(tmdbId: number, lastSyncedAt: Date): Promise<boolean>
}
