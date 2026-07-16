/**
 * detail.ts — Contratos de payload das paginas de detalhe (Backend A, §13).
 *
 * Refletem a forma REALMENTE renderizada hoje (os *PageView dos getters
 * server-only) e ja reservam os campos de valor futuros (ratings/streaming)
 * como arrays OPCIONAIS/vazios — o contrato descreve o presente sem forcar dado
 * que ainda nao e feature publica (ratings/streaming inativos). Tudo
 * serializavel; sem tipos Prisma.
 */

import {
  isRecord,
  optionalString,
  requireArray,
  requireEnum,
  requireNumberOrNull,
  requireString,
  fail,
  ok,
  type ValidationResult,
} from './validation.js'
import {
  creditErrors,
  entityRefErrors,
  mediaPayloadErrors,
  seoPayloadErrors,
  type Credit,
  type EntityRef,
  type MediaPayload,
  type SeoPayload,
} from './primitives.js'

/** Projecao de rating atribuido (contrato; feature ainda inativa). */
export interface RatingProjection {
  readonly source: string
  readonly label: string
  readonly value: number
  readonly scale: number
  readonly url: string | null
  readonly attributionText: string | null
  readonly attributionUrl: string | null
}

/** Projecao de onde-assistir (contrato; so ofertas legais/licenciadas). */
export interface StreamingProjection {
  readonly provider: string
  readonly offerType: string
  readonly country: string
  readonly url: string | null
}

/** Payload da pagina de filme. */
export interface MovieDetailPayload {
  readonly kind: 'movie'
  readonly id: string
  readonly canonicalUrl: string
  readonly title: string
  readonly originalTitle: string | null
  readonly aliases: readonly string[]
  readonly overview: string | null
  readonly releaseDate: string | null
  readonly year: number | null
  readonly runtimeMinutes: number | null
  readonly certification: string | null
  readonly genres: readonly EntityRef[]
  readonly cast: readonly Credit[]
  readonly crew: readonly Credit[]
  readonly collection: EntityRef | null
  readonly media: MediaPayload
  readonly ratings: readonly RatingProjection[]
  readonly streaming: readonly StreamingProjection[]
  readonly seo: SeoPayload
}

/** Referencia a uma temporada (dentro do payload de serie). */
export interface SeasonRef {
  readonly id: string
  readonly seasonNumber: number
  readonly name: string | null
  readonly episodeCount: number | null
  readonly canonicalUrl: string | null
}

/** Payload da pagina de serie. */
export interface TvDetailPayload {
  readonly kind: 'tv'
  readonly id: string
  readonly canonicalUrl: string
  readonly title: string
  readonly originalTitle: string | null
  readonly aliases: readonly string[]
  readonly overview: string | null
  readonly firstAirDate: string | null
  readonly lastAirDate: string | null
  readonly year: number | null
  readonly numberOfSeasons: number | null
  readonly numberOfEpisodes: number | null
  readonly certification: string | null
  readonly genres: readonly EntityRef[]
  readonly cast: readonly Credit[]
  readonly seasons: readonly SeasonRef[]
  readonly media: MediaPayload
  readonly ratings: readonly RatingProjection[]
  readonly streaming: readonly StreamingProjection[]
  readonly seo: SeoPayload
}

/** Referencia a um episodio (dentro do payload de temporada). */
export interface EpisodeRef {
  readonly id: string
  readonly episodeNumber: number
  readonly name: string | null
  readonly airDate: string | null
  readonly canonicalUrl: string | null
}

/** Payload da pagina de temporada. */
export interface SeasonDetailPayload {
  readonly kind: 'season'
  readonly id: string
  readonly canonicalUrl: string
  readonly series: EntityRef
  readonly seasonNumber: number
  readonly name: string | null
  readonly overview: string | null
  readonly airDate: string | null
  readonly episodes: readonly EpisodeRef[]
  readonly media: MediaPayload
  readonly seo: SeoPayload
}

/** Payload da pagina de episodio. */
export interface EpisodeDetailPayload {
  readonly kind: 'episode'
  readonly id: string
  readonly canonicalUrl: string
  readonly series: EntityRef
  readonly seasonNumber: number
  readonly episodeNumber: number
  readonly name: string | null
  readonly overview: string | null
  readonly airDate: string | null
  readonly runtimeMinutes: number | null
  readonly media: MediaPayload
  readonly seo: SeoPayload
}

/** Payload da pagina de pessoa. */
export interface PersonDetailPayload {
  readonly kind: 'person'
  readonly id: string
  readonly canonicalUrl: string
  readonly name: string
  readonly roleLabel: string | null
  readonly birthday: string | null
  readonly deathday: string | null
  readonly placeOfBirth: string | null
  readonly biography: string | null
  readonly credits: readonly Credit[]
  readonly media: MediaPayload
  readonly seo: SeoPayload
}

// ---------------------------------------------------------------------------
// Validadores
// ---------------------------------------------------------------------------

function stringArrayErrors(value: unknown, label: string): string[] {
  return requireArray(value, label, (item, i) =>
    typeof item === 'string' ? [] : [`${label}[${i}]: esperado string`],
  )
}

/** Campos comuns de todo payload de detalhe (kind/id/url/media/seo). */
function commonDetailErrors(value: Record<string, unknown>, kind: string): string[] {
  return [
    ...requireEnum(value.kind, 'kind', [kind]),
    ...requireString(value.id, 'id'),
    ...requireString(value.canonicalUrl, 'canonicalUrl'),
    ...mediaPayloadErrors(value.media, 'media'),
    ...seoPayloadErrors(value.seo, 'seo'),
  ]
}

/** Valida um MovieDetailPayload. */
export function validateMovieDetail(input: unknown): ValidationResult<MovieDetailPayload> {
  if (!isRecord(input)) return fail(['esperado objeto'])
  const errors = [
    ...commonDetailErrors(input, 'movie'),
    ...requireString(input.title, 'title'),
    ...optionalString(input.originalTitle, 'originalTitle'),
    ...stringArrayErrors(input.aliases, 'aliases'),
    ...requireNumberOrNull(input.year, 'year'),
    ...requireArray(input.genres, 'genres', (i, n) => entityRefErrors(i, `genres[${n}]`)),
    ...requireArray(input.cast, 'cast', (i, n) => creditErrors(i, `cast[${n}]`)),
    ...requireArray(input.crew, 'crew', (i, n) => creditErrors(i, `crew[${n}]`)),
  ]
  if (input.collection !== null) errors.push(...entityRefErrors(input.collection, 'collection'))
  return errors.length === 0 ? ok(input as unknown as MovieDetailPayload) : fail(errors)
}

/** Valida um TvDetailPayload. */
export function validateTvDetail(input: unknown): ValidationResult<TvDetailPayload> {
  if (!isRecord(input)) return fail(['esperado objeto'])
  const errors = [
    ...commonDetailErrors(input, 'tv'),
    ...requireString(input.title, 'title'),
    ...stringArrayErrors(input.aliases, 'aliases'),
    ...requireArray(input.genres, 'genres', (i, n) => entityRefErrors(i, `genres[${n}]`)),
    ...requireArray(input.cast, 'cast', (i, n) => creditErrors(i, `cast[${n}]`)),
    ...requireArray(input.seasons, 'seasons', (item, n) => {
      if (!isRecord(item)) return [`seasons[${n}]: esperado objeto`]
      return [
        ...requireString(item.id, `seasons[${n}].id`),
        ...requireNumberOrNull(item.seasonNumber, `seasons[${n}].seasonNumber`),
      ]
    }),
  ]
  return errors.length === 0 ? ok(input as unknown as TvDetailPayload) : fail(errors)
}

/** Valida um SeasonDetailPayload. */
export function validateSeasonDetail(input: unknown): ValidationResult<SeasonDetailPayload> {
  if (!isRecord(input)) return fail(['esperado objeto'])
  const errors = [
    ...commonDetailErrors(input, 'season'),
    ...entityRefErrors(input.series, 'series'),
    ...requireNumberOrNull(input.seasonNumber, 'seasonNumber'),
    ...requireArray(input.episodes, 'episodes', (item, n) => {
      if (!isRecord(item)) return [`episodes[${n}]: esperado objeto`]
      return [
        ...requireString(item.id, `episodes[${n}].id`),
        ...requireNumberOrNull(item.episodeNumber, `episodes[${n}].episodeNumber`),
      ]
    }),
  ]
  return errors.length === 0 ? ok(input as unknown as SeasonDetailPayload) : fail(errors)
}

/** Valida um EpisodeDetailPayload. */
export function validateEpisodeDetail(input: unknown): ValidationResult<EpisodeDetailPayload> {
  if (!isRecord(input)) return fail(['esperado objeto'])
  const errors = [
    ...commonDetailErrors(input, 'episode'),
    ...entityRefErrors(input.series, 'series'),
    ...requireNumberOrNull(input.seasonNumber, 'seasonNumber'),
    ...requireNumberOrNull(input.episodeNumber, 'episodeNumber'),
  ]
  return errors.length === 0 ? ok(input as unknown as EpisodeDetailPayload) : fail(errors)
}

/** Valida um PersonDetailPayload. */
export function validatePersonDetail(input: unknown): ValidationResult<PersonDetailPayload> {
  if (!isRecord(input)) return fail(['esperado objeto'])
  const errors = [
    ...commonDetailErrors(input, 'person'),
    ...requireString(input.name, 'name'),
    ...optionalString(input.roleLabel, 'roleLabel'),
    ...requireArray(input.credits, 'credits', (i, n) => creditErrors(i, `credits[${n}]`)),
  ]
  return errors.length === 0 ? ok(input as unknown as PersonDetailPayload) : fail(errors)
}
