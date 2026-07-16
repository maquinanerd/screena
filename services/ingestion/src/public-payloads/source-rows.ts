/**
 * source-rows.ts — Linhas de ORIGEM dos payloads publicos (PURO).
 *
 * A fronteira entre o banco e o contrato: o adapter Prisma
 * (persistence/public-payload-reader.ts) le o PostgreSQL e produz ESTAS
 * formas; os mappers (map.ts) as transformam nos payloads de
 * @screena/public-contracts. Nenhum tipo do Prisma atravessa: `BigInt` ja
 * chega serializado como string, `Decimal` como number, `Date` como Date
 * (a serializacao ISO e responsabilidade do mapper).
 *
 * Governanca embutida nas formas:
 *  - ratings/streaming so chegam aqui JA filtrados por `display_allowed=true`
 *    e licenca nao-bloqueada (o reader aplica o gate no WHERE — invariante 6);
 *  - midia chega CRUA (MediaImageRow/MediaVideoRow) e o filtro fail-closed e do
 *    `buildMediaPayload` (que descarta displayAllowed=false);
 *  - nenhum campo carrega payload bruto do TMDB.
 */

import type { MediaImageRow, MediaVideoRow } from '../media/build.js'

/** Traducao pt aplicada a entidade (title/summary da entity_translations). */
export interface TranslationRow {
  readonly title: string | null
  readonly summary: string | null
  readonly metaTitle: string | null
  readonly metaDescription: string | null
}

/** Credito bruto (cast ou crew) com a pessoa resolvida. */
export interface CreditRow {
  readonly personId: string
  readonly personName: string
  /** Slug canonico pt da pessoa, quando existe (link renderavel). */
  readonly personSlug: string | null
  readonly character: string | null
  readonly job: string | null
  readonly department: string | null
  readonly billingOrder: number | null
}

/** Rating externo JA liberado por licenca (o reader filtra; inv. 6). */
export interface RatingRow {
  readonly source: string
  readonly label: string
  readonly value: number
  readonly scale: number
  readonly url: string | null
  readonly attributionText: string | null
  readonly attributionUrl: string | null
}

/** Oferta de streaming JA liberada (o reader filtra; inv. 6/8). */
export interface StreamingRow {
  readonly provider: string
  readonly offerType: string
  readonly country: string
  readonly url: string | null
}

/** Midia crua da entidade (filtro fail-closed e do buildMediaPayload). */
export interface MediaRows {
  readonly images: readonly MediaImageRow[]
  readonly videos: readonly MediaVideoRow[]
}

/** Colecao a que um filme pertence. */
export interface CollectionRefRow {
  readonly id: string
  readonly name: string
}

/** Linha de origem de um FILME. */
export interface MovieSourceRow {
  readonly id: string
  readonly tmdbId: number
  readonly slug: string
  readonly titleOriginal: string
  readonly translation: TranslationRow | null
  readonly aliases: readonly string[]
  readonly releaseDate: Date | null
  readonly runtimeMinutes: number | null
  readonly certification: string | null
  readonly cast: readonly CreditRow[]
  readonly crew: readonly CreditRow[]
  readonly collection: CollectionRefRow | null
  readonly media: MediaRows
  readonly ratings: readonly RatingRow[]
  readonly streaming: readonly StreamingRow[]
}

/** Referencia de temporada dentro da serie. */
export interface SeasonRefRow {
  readonly id: string
  readonly seasonNumber: number
  readonly name: string | null
  readonly episodeCount: number | null
}

/** Linha de origem de uma SERIE. */
export interface TvSourceRow {
  readonly id: string
  readonly tmdbId: number
  readonly slug: string
  readonly nameOriginal: string
  readonly translation: TranslationRow | null
  readonly aliases: readonly string[]
  readonly firstAirDate: Date | null
  readonly lastAirDate: Date | null
  readonly numberOfSeasons: number | null
  readonly numberOfEpisodes: number | null
  readonly certification: string | null
  readonly cast: readonly CreditRow[]
  readonly seasons: readonly SeasonRefRow[]
  readonly media: MediaRows
  readonly ratings: readonly RatingRow[]
  readonly streaming: readonly StreamingRow[]
}

/** Referencia de episodio dentro da temporada. */
export interface EpisodeRefRow {
  readonly id: string
  readonly episodeNumber: number
  readonly name: string | null
  readonly airDate: Date | null
}

/** Linha de origem de uma TEMPORADA. */
export interface SeasonSourceRow {
  readonly id: string
  readonly seasonNumber: number
  readonly name: string | null
  readonly overview: string | null
  readonly airDate: Date | null
  readonly series: { readonly id: string; readonly title: string; readonly slug: string }
  readonly episodes: readonly EpisodeRefRow[]
  readonly media: MediaRows
}

/** Linha de origem de um EPISODIO. */
export interface EpisodeSourceRow {
  readonly id: string
  readonly seasonNumber: number
  readonly episodeNumber: number
  readonly name: string | null
  readonly overview: string | null
  readonly airDate: Date | null
  readonly runtimeMinutes: number | null
  readonly series: { readonly id: string; readonly title: string; readonly slug: string }
  readonly media: MediaRows
}

/** Linha de origem de uma PESSOA. */
export interface PersonSourceRow {
  readonly id: string
  readonly tmdbId: number
  readonly slug: string
  readonly name: string
  readonly knownForDepartment: string | null
  readonly birthday: Date | null
  readonly deathday: Date | null
  readonly placeOfBirth: string | null
  /**
   * Biografia SO quando `biography_source_status` permite (o reader aplica o
   * gate; inv. 6). Bloqueada => null, nunca "texto que nao podiamos mostrar".
   */
  readonly biography: string | null
  readonly credits: readonly CreditRow[]
  readonly media: MediaRows
}

/** Card de origem para home/descoberta. */
export interface CardSourceRow {
  readonly kind: 'movie' | 'tv'
  readonly id: string
  readonly title: string
  readonly slug: string
  readonly year: number | null
  readonly posterPath: string | null
  /** Nota editorial propria (escala 5) SO quando screen_score_display=true. */
  readonly screenScore: number | null
}

/** Linha de origem de um resultado de busca (ja vem do search_documents). */
export interface SearchSourceRow {
  readonly entityType: 'movie' | 'tv' | 'person'
  readonly entityId: string
  readonly title: string
  readonly subtitle: string | null
  readonly year: number | null
  readonly imagePath: string | null
  readonly canonicalUrl: string | null
  readonly matchReason: 'exact' | 'alias' | 'prefix' | 'fuzzy'
  readonly score: number
}

/** Linha de origem de um job da fila (visao de status). */
export interface CatalogJobSourceRow {
  readonly id: string
  readonly jobType: string
  readonly status:
    | 'pending'
    | 'claimed'
    | 'running'
    | 'retry_wait'
    | 'succeeded'
    | 'failed'
    | 'dead_letter'
    | 'cancelled'
  readonly entityType: string | null
  readonly externalId: string | null
  readonly attempts: number
  readonly maxAttempts: number
  readonly priority: number
  readonly availableAt: Date | null
  readonly lastErrorCode: string | null
  readonly lastErrorSafe: string | null
}
