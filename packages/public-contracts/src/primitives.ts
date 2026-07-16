/**
 * primitives.ts — Blocos compartilhados dos contratos publicos.
 *
 * EntityRef, midia (PublicMediaAsset/PublicVideo/MediaPayload — invariante 6:
 * `displayAllowed` obrigatorio, raw nunca exposto), credito e SEO. Todos
 * SERIALIZAVEIS (ids como string, datas como ISO string) e sem tipos Prisma.
 */

import { SUPPORTED_LOCALES } from '@screena/config'
import {
  isRecord,
  optionalString,
  requireArray,
  requireBoolean,
  requireEnum,
  requireNumberOrNull,
  requireString,
  type ValidationResult,
  fail,
  ok,
} from './validation.js'

/** Tipo de entidade renderavel (espelha EntityType do banco). */
export type PublicEntityKind = 'movie' | 'tv' | 'season' | 'episode' | 'person'

/** Conjunto canonico dos tipos renderaveis. */
export const PUBLIC_ENTITY_KINDS: readonly PublicEntityKind[] = [
  'movie',
  'tv',
  'season',
  'episode',
  'person',
] as const

/** Locales suportados (reexportado da fonte unica @screena/config). */
export { SUPPORTED_LOCALES }

/** Referencia leve a uma entidade (link para a pagina publica). */
export interface EntityRef {
  readonly kind: PublicEntityKind
  readonly id: string
  readonly title: string
  readonly canonicalUrl: string | null
}

/** Tipo de asset de midia (espelha TmdbImage/TmdbVideo). */
export type MediaAssetKind = 'poster' | 'backdrop' | 'profile' | 'still' | 'logo' | 'video'

const MEDIA_ASSET_KINDS: readonly MediaAssetKind[] = [
  'poster',
  'backdrop',
  'profile',
  'still',
  'logo',
  'video',
]

/**
 * Asset de imagem publico. `displayAllowed` e a flag-mestra (invariante 6): o
 * render so exibe assets com `displayAllowed === true`. `url` ja e a URL final
 * (montada por buildTmdbImageUrl) — o file_path cru NUNCA vaza no contrato.
 */
export interface PublicMediaAsset {
  readonly id: string
  readonly kind: MediaAssetKind
  readonly language: string | null
  readonly width: number | null
  readonly height: number | null
  readonly aspectRatio: number | null
  readonly source: 'tmdb'
  readonly displayAllowed: boolean
  readonly url: string
  readonly alt: string
}

/** Tipo de video publico. */
export type PublicVideoType = 'trailer' | 'teaser' | 'clip' | 'featurette' | 'other'

const PUBLIC_VIDEO_TYPES: readonly PublicVideoType[] = [
  'trailer',
  'teaser',
  'clip',
  'featurette',
  'other',
]

/** Video publico (metadados; nunca embed pirata — invariante 8). */
export interface PublicVideo {
  readonly id: string
  readonly type: PublicVideoType
  readonly site: string
  readonly key: string
  readonly official: boolean
  readonly language: string | null
  readonly publishedAt: string | null
  readonly thumbnailUrl: string | null
  readonly embedUrl: string | null
}

/** Bloco de midia de uma pagina. */
export interface MediaPayload {
  readonly poster: PublicMediaAsset | null
  readonly backdrop: PublicMediaAsset | null
  readonly images: readonly PublicMediaAsset[]
  readonly videos: readonly PublicVideo[]
}

/** Credito (elenco/equipe) referenciando uma pessoa. */
export interface Credit {
  readonly person: EntityRef
  readonly character: string | null
  readonly job: string | null
  readonly department: string | null
}

/** Contrato de SEO da pagina (decidido pelos getters server-only). */
export interface SeoPayload {
  readonly canonicalUrl: string
  readonly index: boolean
  readonly robots: string
  readonly metaTitle: string | null
  readonly metaDescription: string | null
  readonly locale: string
}

// ---------------------------------------------------------------------------
// Validadores
// ---------------------------------------------------------------------------

/** Erros de um EntityRef (rotulados por `label`). */
export function entityRefErrors(value: unknown, label: string): string[] {
  if (!isRecord(value)) return [`${label}: esperado objeto`]
  return [
    ...requireEnum(value.kind, `${label}.kind`, PUBLIC_ENTITY_KINDS),
    ...requireString(value.id, `${label}.id`),
    ...requireString(value.title, `${label}.title`),
    ...optionalString(value.canonicalUrl, `${label}.canonicalUrl`),
  ]
}

/** Erros de um PublicMediaAsset. */
export function mediaAssetErrors(value: unknown, label: string): string[] {
  if (!isRecord(value)) return [`${label}: esperado objeto`]
  const errors = [
    ...requireString(value.id, `${label}.id`),
    ...requireEnum(value.kind, `${label}.kind`, MEDIA_ASSET_KINDS),
    ...optionalString(value.language, `${label}.language`),
    ...requireNumberOrNull(value.width, `${label}.width`),
    ...requireNumberOrNull(value.height, `${label}.height`),
    ...requireNumberOrNull(value.aspectRatio, `${label}.aspectRatio`),
    ...requireBoolean(value.displayAllowed, `${label}.displayAllowed`),
    ...requireString(value.url, `${label}.url`),
  ]
  if (value.source !== 'tmdb') errors.push(`${label}.source: esperado 'tmdb'`)
  if (typeof value.alt !== 'string') errors.push(`${label}.alt: esperado string`)
  return errors
}

/** Erros de um PublicVideo. */
export function publicVideoErrors(value: unknown, label: string): string[] {
  if (!isRecord(value)) return [`${label}: esperado objeto`]
  return [
    ...requireString(value.id, `${label}.id`),
    ...requireEnum(value.type, `${label}.type`, PUBLIC_VIDEO_TYPES),
    ...requireString(value.site, `${label}.site`),
    ...requireString(value.key, `${label}.key`),
    ...requireBoolean(value.official, `${label}.official`),
    ...optionalString(value.language, `${label}.language`),
    ...optionalString(value.publishedAt, `${label}.publishedAt`),
    ...optionalString(value.thumbnailUrl, `${label}.thumbnailUrl`),
    ...optionalString(value.embedUrl, `${label}.embedUrl`),
  ]
}

/** Erros de um MediaPayload. */
export function mediaPayloadErrors(value: unknown, label: string): string[] {
  if (!isRecord(value)) return [`${label}: esperado objeto`]
  const errors: string[] = []
  if (value.poster !== null) errors.push(...mediaAssetErrors(value.poster, `${label}.poster`))
  if (value.backdrop !== null) errors.push(...mediaAssetErrors(value.backdrop, `${label}.backdrop`))
  errors.push(
    ...requireArray(value.images, `${label}.images`, (item, i) =>
      mediaAssetErrors(item, `${label}.images[${i}]`),
    ),
  )
  errors.push(
    ...requireArray(value.videos, `${label}.videos`, (item, i) =>
      publicVideoErrors(item, `${label}.videos[${i}]`),
    ),
  )
  return errors
}

/** Erros de um Credit. */
export function creditErrors(value: unknown, label: string): string[] {
  if (!isRecord(value)) return [`${label}: esperado objeto`]
  return [
    ...entityRefErrors(value.person, `${label}.person`),
    ...optionalString(value.character, `${label}.character`),
    ...optionalString(value.job, `${label}.job`),
    ...optionalString(value.department, `${label}.department`),
  ]
}

/** Erros de um SeoPayload. */
export function seoPayloadErrors(value: unknown, label: string): string[] {
  if (!isRecord(value)) return [`${label}: esperado objeto`]
  return [
    ...requireString(value.canonicalUrl, `${label}.canonicalUrl`),
    ...requireBoolean(value.index, `${label}.index`),
    ...requireString(value.robots, `${label}.robots`),
    ...optionalString(value.metaTitle, `${label}.metaTitle`),
    ...optionalString(value.metaDescription, `${label}.metaDescription`),
    ...requireString(value.locale, `${label}.locale`),
  ]
}

/** Valida um MediaPayload isolado. */
export function validateMediaPayload(value: unknown): ValidationResult<MediaPayload> {
  const errors = mediaPayloadErrors(value, 'media')
  return errors.length === 0 ? ok(value as MediaPayload) : fail(errors)
}

/**
 * Filtra um bloco de midia mantendo SO assets com `displayAllowed === true`
 * (invariante 6). Retorna um MediaPayload seguro para render — poster/backdrop
 * viram null se nao permitidos, e videos oficiais permanecem (metadados sem
 * flag de display sao mantidos; a governanca de video vive no worker).
 */
export function filterDisplayAllowedMedia(media: MediaPayload): MediaPayload {
  const allowed = (asset: PublicMediaAsset | null): PublicMediaAsset | null =>
    asset !== null && asset.displayAllowed ? asset : null
  return {
    poster: allowed(media.poster),
    backdrop: allowed(media.backdrop),
    images: media.images.filter((a) => a.displayAllowed),
    videos: media.videos,
  }
}
